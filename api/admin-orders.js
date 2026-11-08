const { clients, checked } = require('../lib/backend');

const ALLOWED_STATUSES = [
  'paid',
  'processing',
  'shipped',
  'delivered',
  'canceled'
];

const STATUS_EMAILS = {
  processing: {
    subject: 'Your AltaPure Labs order is being prepared',
    heading: 'Your order is being prepared',
    message:
      'We received your order and are preparing it for shipment. We will notify you when it ships.'
  },
  shipped: {
    subject: 'Your AltaPure Labs order has shipped',
    heading: 'Your order has shipped',
    message:
      'Your order has shipped. Tracking information is included below when available.'
  },
  delivered: {
    subject: 'Your AltaPure Labs order was delivered',
    heading: 'Your order was delivered',
    message:
      'Your order has been marked as delivered. If you did not receive it, please contact us promptly.'
  },
  canceled: {
    subject: 'Your AltaPure Labs order was canceled',
    heading: 'Your order was canceled',
    message:
      'Your order has been canceled. If you believe this was a mistake, please contact us.'
  }
};

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  const adminPassword = process.env.ADMIN_ORDERS_PASSWORD;

  if (!adminPassword || adminPassword.length < 32) {
    return res.status(503).json({
      error: 'Admin orders are not configured.'
    });
  }

  const providedPassword =
    req.headers['x-admin-password'] ||
    new URLSearchParams(req.url.split('?')[1] || '').get('password');

  if (providedPassword !== adminPassword) {
    return res.status(401).json({
      error: 'Unauthorized.'
    });
  }

  if (req.method === 'GET') {
    try {
      const { db } = clients();

      const ordersResponse = await db
        .from('store_orders')
        .select(
          `
          id,
          order_number,
          created_at,
          customer_name,
          customer_email,
          organization,
          payment_status,
          fulfillment_status,
          subtotal_cents,
          shipping_cents,
          total_cents,
          currency,
          shipping_name,
          shipping_address,
          tracking_carrier,
          tracking_number,
          shipped_at,
          admin_notes,
          store_order_items (
            product_name,
            variant_size,
            quantity,
            unit_price_cents
          )
        `
        )
        .order('created_at', { ascending: false })
        .limit(100);

      const orders = checked(ordersResponse);

      return res.status(200).json({
        orders
      });
    } catch (error) {
      console.error('Admin orders lookup failed', error.message);

      return res.status(503).json({
        error: 'Orders unavailable.'
      });
    }
  }

  if (req.method === 'PATCH') {
    try {
      const body = await parseJson(req);

      const orderId = body.order_id;
      const fulfillmentStatus = body.fulfillment_status;
      const trackingCarrier = body.tracking_carrier || null;
      const trackingNumber = body.tracking_number || null;
      const adminNotes = body.admin_notes || null;

      if (
        typeof orderId !== 'string' ||
        orderId.length !== 36 ||
        !ALLOWED_STATUSES.includes(fulfillmentStatus)
      ) {
        return res.status(400).json({
          error: 'Invalid order update.'
        });
      }

      const { db } = clients();

      const previousOrderResponse = await db
        .from('store_orders')
        .select(
          'id,order_number,customer_email,customer_name,fulfillment_status,tracking_carrier,tracking_number,shipped_at,admin_notes'
        )
        .eq('id', orderId)
        .single();

      const previousOrder = checked(previousOrderResponse);

      const previousStatus = previousOrder.fulfillment_status;

      const updateData = {
        fulfillment_status: fulfillmentStatus,
        tracking_carrier: trackingCarrier,
        tracking_number: trackingNumber,
        admin_notes: adminNotes
      };

      if (fulfillmentStatus === 'shipped') {
        updateData.shipped_at = new Date().toISOString();
      }

      const response = await db
        .from('store_orders')
        .update(updateData)
        .eq('id', orderId)
        .select(
          'id,order_number,customer_email,customer_name,fulfillment_status,tracking_carrier,tracking_number,shipped_at,admin_notes'
        )
        .single();

      const updatedOrder = checked(response);

      if (
        previousStatus !== updatedOrder.fulfillment_status &&
        updatedOrder.customer_email
      ) {
        await sendStatusEmail(updatedOrder, updatedOrder.fulfillment_status);
      }

      return res.status(200).json({
        order: updatedOrder
      });
    } catch (error) {
      console.error('Admin order update failed', error.message);

      return res.status(500).json({
        error: 'Update failed.'
      });
    }
  }

  res.setHeader('Allow', 'GET, PATCH');
  return res.status(405).json({
    error: 'Method not allowed.'
  });
};

async function parseJson(req) {
  let raw = '';

  for await (const chunk of req) {
    raw += chunk;
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('Invalid JSON.');
  }
}

async function sendStatusEmail(order, status) {
  const statusCopy = STATUS_EMAILS[status];

  if (!statusCopy) {
    return;
  }

  await sendEmail({
    to: order.customer_email,
    from:
      process.env.ORDER_CONFIRMATION_FROM ||
      'AltaPure Labs <orders@altapurelabs.com>',
    replyTo: process.env.ADMIN_ORDER_EMAIL,
    subject: statusCopy.subject,
    html: statusEmailHtml({
      order,
      statusCopy
    })
  });
}

function statusEmailHtml({ order, statusCopy }) {
  const tracking =
    order.tracking_carrier || order.tracking_number
      ? `
        <div style="margin-top:24px;padding:18px;background:#f3f5f5;border-radius:10px;">
          <p style="margin:0 0 8px;"><strong>Tracking information</strong></p>
          ${
            order.tracking_carrier
              ? `<p style="margin:0 0 6px;">Carrier: ${escapeHtml(order.tracking_carrier)}</p>`
              : ''
          }
          ${
            order.tracking_number
              ? `<p style="margin:0;">Tracking number: ${escapeHtml(order.tracking_number)}</p>`
              : ''
          }
        </div>`
      : '';

  return `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:620px;margin:0 auto;color:#111314;">
      <div style="background:#143832;color:#ffffff;padding:28px 32px;border-radius:12px 12px 0 0;">
        <h1 style="margin:0;font-size:22px;letter-spacing:.08em;">ALTA<span style="font-weight:500;">PURE LABS</span></h1>
        <p style="margin:10px 0 0;color:#cfe3de;font-size:14px;">Order update</p>
      </div>

      <div style="background:#ffffff;padding:32px;border:1px solid #e5e7eb;border-top:0;">
        <h2 style="margin:0 0 12px;font-size:24px;">${escapeHtml(statusCopy.heading)}</h2>
        <p style="margin:0 0 24px;color:#4e5556;">${escapeHtml(statusCopy.message)}</p>

        <div style="background:#f3f5f5;padding:18px;border-radius:10px;">
          <p style="margin:0 0 8px;"><strong>Order number:</strong> ${escapeHtml(order.order_number || order.id)}</p>
          <p style="margin:0;"><strong>Status:</strong> ${escapeHtml(formatStatus(order.fulfillment_status))}</p>
        </div>

        ${tracking}

        <div style="margin-top:32px;padding:18px;background:#f8f4e8;border-radius:10px;">
          <p style="margin:0;font-size:13px;color:#5f5638;">
            <strong>Research use only.</strong> Products are supplied for controlled laboratory
            research and are not for human or veterinary use, ingestion, injection, diagnosis,
            treatment, or consumption.
          </p>
        </div>
      </div>

      <div style="padding:20px 32px;color:#6b7280;font-size:12px;">
        AltaPure Labs · Research use only · Not for human consumption
      </div>
    </div>`;
}

async function sendEmail({ to, from, subject, html, replyTo }) {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    console.error('RESEND_API_KEY is missing; status email was not sent.');
    return;
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      html,
      ...(replyTo ? { reply_to: replyTo } : {})
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Resend status email failed: ${response.status} ${errorText}`
    );
  }
}

function formatStatus(status) {
  const labels = {
    paid: 'Paid',
    processing: 'Processing',
    shipped: 'Shipped',
    delivered: 'Delivered',
    canceled: 'Canceled'
  };

  return labels[status] || status;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
