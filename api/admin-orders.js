const {
  createHash,
  timingSafeEqual
} = require('node:crypto');

const { clients, checked } = require('../lib/backend');

const {
  listAdminOrders
} = require('../lib/admin-order-query');

const ALLOWED_STATUSES = [
  'unfulfilled',
  'processing',
  'awaiting_supplier',
  'partially_shipped',
  'shipped',
  'delivered',
  'canceled'
];

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ORDER_UPDATE_SELECT = [
  'id',
  'order_number',
  'customer_email',
  'customer_name',
  'payment_status',
  'fulfillment_status',
  'supplier_status',
  'priority',
  'tracking_carrier',
  'tracking_number',
  'shipped_at',
  'admin_notes',
  'internal_status_history'
].join(',');

const STATUS_EMAILS = {
  processing: {
    subject: 'Your AltaPure Labs order is being prepared',
    heading: 'Your order is being prepared',
    message:
      'We received your order and are preparing it for shipment. We will notify you when it ships.'
  },

  partially_shipped: {
    subject: 'Part of your AltaPure Labs order has shipped',
    heading: 'Part of your order has shipped',
    message:
      'Part of your order has shipped. Any remaining items will be shipped separately. Available tracking information is included below.'
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
      'Your order has been canceled. This notice does not confirm a refund. Please contact us if you have questions about your payment.'
  }
};

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  const adminPassword = process.env.ADMIN_ORDERS_PASSWORD;

  if (
    typeof adminPassword !== 'string' ||
    adminPassword.length < 32
  ) {
    return res.status(503).json({
      error: 'Admin orders are not configured.'
    });
  }

  const providedPassword = req.headers['x-admin-password'];

  if (!passwordMatches(providedPassword, adminPassword)) {
    return res.status(401).json({
      error: 'Unauthorized.'
    });
  }

  if (!['GET', 'PATCH'].includes(req.method)) {
    res.setHeader('Allow', 'GET, PATCH');

    return res.status(405).json({
      error: 'Method not allowed.'
    });
  }

  try {
    if (req.method === 'GET') {
      const { db } = clients();

      const params = new URL(
        req.url,
        'https://admin.internal'
      ).searchParams;

      const result = await listAdminOrders(db, params);

      return res.status(200).json(result);
    }

    const contentType = String(
      req.headers['content-type'] || ''
    ).split(';')[0].trim().toLowerCase();

    if (contentType !== 'application/json') {
      throw httpError(415, 'JSON required.');
    }

    const body = await parseJson(req);

    if (
      body.action === 'archive' ||
      body.action === 'unarchive'
    ) {
      return await updateArchiveStatus(res, body);
    }

    if (
      body.action !== undefined &&
      body.action !== 'update'
    ) {
      throw httpError(400, 'Unknown order action.');
    }

    return await updateOrder(res, body);
  } catch (error) {
    const allowedErrorStatuses = [
      400,
      404,
      409,
      413,
      415
    ];

    const status = allowedErrorStatuses.includes(error.status)
      ? error.status
      : req.method === 'GET'
        ? 503
        : 500;

    console.error('Admin orders request failed', {
      method: req.method,
      name: error.name,
      code: error.code,
      status
    });

    return res.status(status).json({
      error:
        status < 500
          ? error.message
          : req.method === 'GET'
            ? 'Orders unavailable.'
            : 'Update failed. Refresh the order before retrying.'
    });
  }
};

function passwordMatches(provided, expected) {
  if (
    typeof provided !== 'string' ||
    provided.length > 4096
  ) {
    return false;
  }

  const providedHash = createHash('sha256')
    .update(provided)
    .digest();

  const expectedHash = createHash('sha256')
    .update(expected)
    .digest();

  return timingSafeEqual(providedHash, expectedHash);
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function optionalText(value, maximumLength, label) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    throw httpError(400, `${label} must be text.`);
  }

  const text = value.trim();

  if (text.length > maximumLength) {
    throw httpError(
      400,
      `${label} is too long. Maximum ${maximumLength} characters.`
    );
  }

  return text || null;
}

async function parseJson(req) {
  const maximumBytes = 32768;
  let raw;

  if (req.body !== undefined && req.body !== null) {
    if (Buffer.isBuffer(req.body)) {
      raw = req.body.toString('utf8');
    } else if (typeof req.body === 'string') {
      raw = req.body;
    } else {
      raw = JSON.stringify(req.body);
    }
  } else {
    const chunks = [];
    let bytes = 0;

    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(chunk);

      bytes += buffer.length;

      if (bytes > maximumBytes) {
        throw httpError(413, 'Request too large.');
      }

      chunks.push(buffer);
    }

    raw = Buffer.concat(chunks).toString('utf8');
  }

  if (
    typeof raw !== 'string' ||
    Buffer.byteLength(raw, 'utf8') > maximumBytes
  ) {
    throw httpError(413, 'Request too large.');
  }

  let body;

  try {
    body = JSON.parse(raw);
  } catch {
    throw httpError(400, 'Invalid JSON.');
  }

  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body)
  ) {
    throw httpError(400, 'A JSON object is required.');
  }

  return body;
}

async function updateArchiveStatus(res, body) {
  const orderIds = body.order_ids;

  if (
    !Array.isArray(orderIds) ||
    !orderIds.length ||
    orderIds.length > 200 ||
    orderIds.some(
      (id) =>
        typeof id !== 'string' ||
        !UUID_PATTERN.test(id)
    )
  ) {
    throw httpError(
      400,
      'Select between 1 and 200 valid orders.'
    );
  }

  const uniqueIds = [...new Set(orderIds)];
  const { db } = clients();
  const archived = body.action === 'archive';

  const updatedOrders = checked(
    await db
      .from('store_orders')
      .update({
        archived,
        archived_at: archived
          ? new Date().toISOString()
          : null
      })
      .in('id', uniqueIds)
      .select(
        'id,order_number,archived,archived_at'
      )
  );

  return res.status(200).json({
    updated: updatedOrders.length,
    orders: updatedOrders
  });
}

async function updateOrder(res, body) {
  const orderId = body.order_id;
  const fulfillmentStatus = body.fulfillment_status;

  if (
    typeof orderId !== 'string' ||
    !UUID_PATTERN.test(orderId) ||
    !ALLOWED_STATUSES.includes(fulfillmentStatus)
  ) {
    throw httpError(400, 'Invalid order update.');
  }

  const { db } = clients();

  const previousOrder = checked(
    await db
      .from('store_orders')
      .select(ORDER_UPDATE_SELECT)
      .eq('id', orderId)
      .maybeSingle()
  );

  if (!previousOrder) {
    throw httpError(404, 'Order not found.');
  }

  const priority =
    body.priority === undefined
      ? previousOrder.priority || 'normal'
      : body.priority;

  if (!['low', 'normal', 'high'].includes(priority)) {
    throw httpError(400, 'Invalid priority.');
  }

  const supplierStatus = optionalText(
    body.supplier_status === undefined
      ? previousOrder.supplier_status
      : body.supplier_status,
    254,
    'Supplier status'
  );

  const trackingCarrier = optionalText(
    body.tracking_carrier === undefined
      ? previousOrder.tracking_carrier
      : body.tracking_carrier,
    100,
    'Carrier'
  );

  const trackingNumber = optionalText(
    body.tracking_number === undefined
      ? previousOrder.tracking_number
      : body.tracking_number,
    254,
    'Tracking number'
  );

  const adminNotes = optionalText(
    body.admin_notes === undefined
      ? previousOrder.admin_notes
      : body.admin_notes,
    10000,
    'Internal notes'
  );

  const previousStatus =
    previousOrder.fulfillment_status;

  const statusChanged =
    previousStatus !== fulfillmentStatus;

  const requiresPaidOrder = [
    'processing',
    'awaiting_supplier',
    'partially_shipped',
    'shipped',
    'delivered'
  ].includes(fulfillmentStatus);

  if (
    statusChanged &&
    requiresPaidOrder &&
    !['paid', 'partially_refunded'].includes(
      previousOrder.payment_status
    )
  ) {
    throw httpError(
      409,
      'This fulfillment action requires a paid order.'
    );
  }

  const now = new Date().toISOString();

  const history = Array.isArray(
    previousOrder.internal_status_history
  )
    ? [...previousOrder.internal_status_history]
    : [];

  if (statusChanged) {
    history.push({
      from: previousStatus,
      to: fulfillmentStatus,
      at: now
    });
  }

  const updateData = {
    fulfillment_status: fulfillmentStatus,
    supplier_status: supplierStatus,
    priority,
    tracking_carrier: trackingCarrier,
    tracking_number: trackingNumber,
    admin_notes: adminNotes,
    internal_status_history: history
  };

  if (
    ['partially_shipped', 'shipped'].includes(
      fulfillmentStatus
    ) &&
    !previousOrder.shipped_at
  ) {
    updateData.shipped_at = now;
  }

  /*
   * Guard against another request changing fulfillment status
   * between our read and update.
   *
   * Full transactional auditing and concurrency control will
   * replace this in the workflow-service stage.
   */
  const updatedOrder = checked(
    await db
      .from('store_orders')
      .update(updateData)
      .eq('id', orderId)
      .eq('fulfillment_status', previousStatus)
      .select(ORDER_UPDATE_SELECT)
      .maybeSingle()
  );

  if (!updatedOrder) {
    throw httpError(
      409,
      'The order changed while you were editing. Refresh and try again.'
    );
  }

  let notification = {
    status: 'not_required'
  };

  if (
    statusChanged &&
    STATUS_EMAILS[fulfillmentStatus]
  ) {
    if (!updatedOrder.customer_email) {
      notification = {
        status: 'failed',
        error: 'Customer email is missing.'
      };
    } else {
      try {
        const result = await sendStatusEmail(
          updatedOrder,
          fulfillmentStatus
        );

        notification = {
          status: 'accepted',
          provider_id: result.id || null
        };
      } catch (error) {
        console.error('Status notification failed', {
          order_id: orderId,
          name: error.name
        });

        notification = {
          status: 'failed',
          error:
            'Order saved, but the customer email was not confirmed as accepted. Check Resend before resending.'
        };
      }
    }
  }

  return res.status(200).json({
    order: updatedOrder,
    notification
  });
}

async function sendStatusEmail(order, status) {
  const statusCopy = STATUS_EMAILS[status];

  if (!statusCopy) {
    return {};
  }

  const orderNumber =
    order.order_number || order.id;

  return await sendEmail({
    to: order.customer_email,
    from:
      process.env.ORDER_CONFIRMATION_FROM ||
      'AltaPure Labs <orders@altapurelabs.com>',
    replyTo:
      process.env.ADMIN_ORDER_EMAIL ||
      'altapurelabs@protonmail.com',
    subject: `${statusCopy.subject} — ${orderNumber}`,
    html: statusEmailHtml({
      order,
      statusCopy
    }),
    text: statusEmailText({
      order,
      statusCopy
    })
  });
}

function shouldIncludeTracking(order) {
  return [
    'partially_shipped',
    'shipped',
    'delivered'
  ].includes(order.fulfillment_status);
}

function statusEmailText({ order, statusCopy }) {
  const lines = [
    'AltaPure Labs',
    '',
    statusCopy.heading,
    statusCopy.message,
    '',
    `Order number: ${order.order_number || order.id}`,
    `Status: ${formatStatus(order.fulfillment_status)}`
  ];

  if (shouldIncludeTracking(order)) {
    if (order.tracking_carrier) {
      lines.push(`Carrier: ${order.tracking_carrier}`);
    }

    if (order.tracking_number) {
      lines.push(
        `Tracking number: ${order.tracking_number}`
      );
    }
  }

  lines.push(
    '',
    'Research use only. Not for human or veterinary use, ingestion, injection, diagnosis, treatment, or consumption.'
  );

  return lines.join('\n');
}

function statusEmailHtml({ order, statusCopy }) {
  const orderNumber =
    order.order_number || order.id;

  const tracking =
    shouldIncludeTracking(order) &&
    (order.tracking_carrier || order.tracking_number)
      ? `
        <div style="margin-top:24px;padding:18px;background:#f3f5f5;border-radius:10px;">
          <p style="margin:0 0 8px;">
            <strong>Tracking information</strong>
          </p>

          ${
            order.tracking_carrier
              ? `
                <p style="margin:0 0 6px;">
                  Carrier:
                  ${escapeHtml(order.tracking_carrier)}
                </p>
              `
              : ''
          }

          ${
            order.tracking_number
              ? `
                <p style="margin:0;">
                  Tracking number:
                  ${escapeHtml(order.tracking_number)}
                </p>
              `
              : ''
          }
        </div>
      `
      : '';

  return `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:620px;margin:0 auto;color:#111314;">
      <div style="background:#143832;color:#fff;padding:28px 32px;border-radius:12px 12px 0 0;">
        <h1 style="margin:0;font-size:22px;letter-spacing:.08em;">
          ALTAPURE LABS
        </h1>

        <p style="margin:10px 0 0;color:#cfe3de;font-size:14px;">
          Order update
        </p>
      </div>

      <div style="background:#fff;padding:32px;border:1px solid #e5e7eb;border-top:0;">
        <h2 style="margin:0 0 12px;font-size:24px;">
          ${escapeHtml(statusCopy.heading)}
        </h2>

        <p style="margin:0 0 24px;color:#4e5556;">
          ${escapeHtml(statusCopy.message)}
        </p>

        <div style="background:#f3f5f5;padding:18px;border-radius:10px;">
          <p style="margin:0 0 8px;">
            <strong>Order number:</strong>
            ${escapeHtml(orderNumber)}
          </p>

          <p style="margin:0;">
            <strong>Status:</strong>
            ${escapeHtml(
              formatStatus(order.fulfillment_status)
            )}
          </p>
        </div>

        ${tracking}

        <div style="margin-top:32px;padding:18px;background:#f8f4e8;border-radius:10px;">
          <p style="margin:0;font-size:13px;color:#5f5638;">
            <strong>Research use only.</strong>
            Products are supplied for controlled laboratory research
            and are not for human or veterinary use, ingestion,
            injection, diagnosis, treatment, or consumption.
          </p>
        </div>
      </div>

      <div style="padding:20px 32px;color:#6b7280;font-size:12px;">
        AltaPure Labs · Research use only
      </div>
    </div>
  `;
}

async function sendEmail({
  to,
  from,
  subject,
  html,
  text,
  replyTo
}) {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    throw new Error('RESEND_API_KEY is missing.');
  }

  const response = await fetch(
    'https://api.resend.com/emails',
    {
      method: 'POST',
      signal: AbortSignal.timeout(10000),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        html,
        text,
        ...(replyTo ? { reply_to: replyTo } : {})
      })
    }
  );

  if (!response.ok) {
    throw new Error(
      `Resend rejected the request (${response.status}).`
    );
  }

  return await response.json();
}

function formatStatus(status) {
  const labels = {
    unfulfilled: 'Unfulfilled',
    processing: 'Processing',
    awaiting_supplier: 'Awaiting Supplier',
    partially_shipped: 'Partially Shipped',
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
