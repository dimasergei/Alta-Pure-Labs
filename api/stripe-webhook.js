const { clients, checked } = require('../lib/backend');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end();
  }

  let event;
  let stripe;
  let db;

  try {
    ({ stripe, db } = clients());

    const chunks = [];
    let length = 0;

    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      length += buffer.length;

      if (length > 1048576) {
        return res.status(413).end();
      }

      chunks.push(buffer);
    }

    event = stripe.webhooks.constructEvent(
      Buffer.concat(chunks),
      req.headers['stripe-signature'],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (error) {
    console.error('Stripe webhook verification failed', error.message);
    return res.status(400).send('Invalid signature or webhook configuration.');
  }

  const allowedEvents = [
    'checkout.session.completed',
    'checkout.session.async_payment_succeeded',
    'checkout.session.async_payment_failed',
    'checkout.session.expired',
  ];

  if (!allowedEvents.includes(event.type)) {
    return res.status(200).json({
      received: true,
      ignored: true,
    });
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(
      event.data.object.id,
      {
        expand: ['payment_intent'],
      }
    );

    const orderId = session.metadata?.order_id;

    if (!orderId) {
      return res.status(200).json({
        received: true,
        ignored: true,
      });
    }

    const shipping =
      session.collected_information?.shipping_details ??
      session.shipping_details;

    const alreadyProcessed = await db
      .from('store_payment_events')
      .select('stripe_event_id')
      .eq('stripe_event_id', event.id)
      .maybeSingle();

    if (alreadyProcessed.data) {
      return res.status(200).json({
        received: true,
        alreadyProcessed: true,
      });
    }

    checked(
      await db.rpc('apply_store_checkout_event', {
        p_event_id: event.id,
        p_event_type: event.type,
        p_order_id: orderId,
        p_session_id: session.id,
        p_payment_intent:
          typeof session.payment_intent === 'string'
            ? session.payment_intent
            : session.payment_intent?.id || null,
        p_paid: session.payment_status === 'paid',
        p_currency: session.currency,
        p_subtotal: session.amount_subtotal,
        p_shipping: session.total_details?.amount_shipping || 0,
        p_tax: session.total_details?.amount_tax || 0,
        p_total: session.amount_total,
        p_shipping_name: shipping?.name || null,
        p_shipping_address: shipping?.address || null,
      })
    );

    if (
      event.type === 'checkout.session.completed' ||
      event.type === 'checkout.session.async_payment_succeeded'
    ) {
      if (session.payment_status === 'paid') {
        await sendOrderEmails(db, orderId, session);
      }
    }

    return res.status(200).json({
      received: true,
    });
  } catch (error) {
    console.error('Stripe webhook processing failed', {
      name: error.name,
      code: error.code,
      message: error.message,
    });

    return res.status(500).send('Processing failed; retry.');
  }
};

async function sendOrderEmails(db, orderId, session) {
  const orderResponse = await db
    .from('store_orders')
    .select('*')
    .eq('id', orderId)
    .single();

  const order = orderResponse.data;

  if (!order) {
    throw new Error('Order not found after payment.');
  }

  const itemsResponse = await db
    .from('store_order_items')
    .select('*')
    .eq('order_id', orderId)
    .order('created_at', { ascending: true });

  const items = itemsResponse.data || [];

  const customerEmail = order.customer_email;
  const adminEmail = process.env.ADMIN_ORDER_EMAIL;
  const fromEmail =
    process.env.ORDER_CONFIRMATION_FROM || 'AltaPure Labs <orders@altapurelabs.com>';

  if (!customerEmail) {
    throw new Error('Customer email is missing.');
  }

  const emailData = buildEmailData(order, items, session);

  await sendEmail({
    to: customerEmail,
    from: fromEmail,
    subject: `Your AltaPure Labs order is confirmed — ${emailData.orderNumber}`,
    html: customerEmailHtml(emailData),
  });

  if (adminEmail) {
    await sendEmail({
      to: adminEmail,
      from: fromEmail,
      replyTo: customerEmail,
      subject: `New paid order — ${emailData.orderNumber}`,
      html: adminEmailHtml(emailData),
    });
  }
}

function buildEmailData(order, items, session) {
  const formatMoney = (cents) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(cents / 100);

  const itemRows = items
    .map(
      (item) => `
        <tr>
          <td style="padding:12px 0;border-bottom:1px solid #e5e7eb;">
            <strong>${escapeHtml(item.product_name)}</strong><br>
            <span style="color:#6b7280;font-size:13px;">${escapeHtml(item.variant_size)} × ${item.quantity}</span>
          </td>
          <td style="padding:12px 0;border-bottom:1px solid #e5e7eb;text-align:right;white-space:nowrap;">
            ${formatMoney(item.quantity * item.unit_price_cents)}
          </td>
        </tr>`
    )
    .join('');

  const shippingAddress = order.shipping_address || {};
  const addressLines = [
    shippingAddress.line1,
    shippingAddress.line2,
    [
      shippingAddress.city,
      shippingAddress.state,
      shippingAddress.postal_code,
    ]
      .filter(Boolean)
      .join(', '),
    shippingAddress.country,
  ]
    .filter(Boolean)
    .join('<br>');

  return {
    orderNumber: order.id,
    customerName: order.customer_name,
    customerEmail: order.customer_email,
    organization: order.organization,
    items,
    itemRows,
    subtotal: formatMoney(order.subtotal_cents),
    shipping: formatMoney(order.shipping_cents),
    total: formatMoney(order.total_cents),
    shippingName: order.shipping_name || '',
    shippingAddress: addressLines,
    paymentStatus: order.payment_status,
    receiptUrl: session?.receipt_url || '',
  };
}

function customerEmailHtml(data) {
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:620px;margin:0 auto;color:#111314;">
      <div style="background:#143832;color:#ffffff;padding:28px 32px;border-radius:12px 12px 0 0;">
        <h1 style="margin:0;font-size:22px;letter-spacing:.08em;">ALTA<span style="font-weight:500;">PURE LABS</span></h1>
        <p style="margin:10px 0 0;color:#cfe3de;font-size:14px;">Order confirmation</p>
      </div>

      <div style="background:#ffffff;padding:32px;border:1px solid #e5e7eb;border-top:0;">
        <h2 style="margin:0 0 12px;font-size:24px;">Thank you, ${escapeHtml(data.customerName)}.</h2>
        <p style="margin:0 0 24px;color:#4e5556;">
          Your payment was successful. This email confirms your order
          <strong>${escapeHtml(data.orderNumber)}</strong>.
        </p>

        <div style="background:#f3f5f5;padding:18px;border-radius:10px;margin-bottom:24px;">
          <p style="margin:0 0 8px;"><strong>Order number:</strong> ${escapeHtml(data.orderNumber)}</p>
          <p style="margin:0;"><strong>Payment status:</strong> ${escapeHtml(data.paymentStatus)}</p>
        </div>

        <h3 style="margin:0 0 12px;font-size:18px;">Order details</h3>
        <table style="width:100%;border-collapse:collapse;">
          ${data.itemRows}
        </table>

        <div style="margin-top:20px;padding-top:16px;border-top:1px solid #e5e7eb;">
          <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
            <span>Subtotal</span>
            <strong>${data.subtotal}</strong>
          </div>
          <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
            <span>Shipping</span>
            <strong>${data.shipping}</strong>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:18px;">
            <span>Total</span>
            <strong>${data.total}</strong>
          </div>
        </div>

        ${
          data.shippingAddress
            ? `
        <h3 style="margin:28px 0 12px;font-size:18px;">Shipping address</h3>
        <p style="margin:0;color:#4e5556;">
          ${escapeHtml(data.shippingName)}<br>
          ${data.shippingAddress}
        </p>`
            : ''
        }

        <div style="margin-top:32px;padding:18px;background:#f8f4e8;border-radius:10px;">
          <p style="margin:0;font-size:13px;color:#5f5638;">
            <strong>Research use only.</strong> Products are supplied for controlled laboratory
            research and are not for human or veterinary use, ingestion, injection, diagnosis,
            treatment, or consumption.
          </p>
        </div>

        ${
          data.receiptUrl
            ? `<p style="margin:24px 0 0;">
                <a href="${data.receiptUrl}" style="color:#1c7a73;">View your Stripe receipt</a>
              </p>`
            : ''
        }
      </div>

      <div style="padding:20px 32px;color:#6b7280;font-size:12px;">
        AltaPure Labs · Research use only · Not for human consumption
      </div>
    </div>`;
}

function adminEmailHtml(data) {
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:620px;margin:0 auto;color:#111314;">
      <h2 style="margin:0 0 16px;">New paid order</h2>

      <p><strong>Order number:</strong> ${escapeHtml(data.orderNumber)}</p>
      <p><strong>Customer:</strong> ${escapeHtml(data.customerName)}</p>
      <p><strong>Email:</strong> ${escapeHtml(data.customerEmail)}</p>
      <p><strong>Organization:</strong> ${escapeHtml(data.organization)}</p>
      <p><strong>Payment status:</strong> ${escapeHtml(data.paymentStatus)}</p>

      <h3 style="margin:24px 0 10px;">Items</h3>
      <table style="width:100%;border-collapse:collapse;">
        ${data.itemRows}
      </table>

      <div style="margin-top:20px;padding-top:16px;border-top:1px solid #e5e7eb;">
        <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
          <span>Subtotal</span>
          <strong>${data.subtotal}</strong>
        </div>
        <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
          <span>Shipping</span>
          <strong>${data.shipping}</strong>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:18px;">
          <span>Total</span>
          <strong>${data.total}</strong>
        </div>
      </div>

      ${
        data.shippingAddress
          ? `
      <h3 style="margin:24px 0 10px;">Shipping address</h3>
      <p style="margin:0;color:#4e5556;">
        ${escapeHtml(data.shippingName)}<br>
        ${data.shippingAddress}
      </p>`
          : ''
      }
    </div>`;
}

async function sendEmail({ to, from, subject, html, replyTo }) {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    console.error('RESEND_API_KEY is missing; email was not sent.');
    return;
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      html,
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Resend email failed: ${response.status} ${errorText}`);
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

module.exports.config = {
  api: {
    bodyParser: false,
  },
};
