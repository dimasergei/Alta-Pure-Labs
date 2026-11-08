const crypto = require('crypto');
const { clients, checked } = require('../lib/backend');

const {
  markNotificationSent,
  markNotificationFailed
} = require('../lib/order-notifications');

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function passwordMatches(provided, expected) {
  const a = crypto.createHash('sha256').update(String(provided)).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  const adminPassword = process.env.ADMIN_ORDERS_PASSWORD;

  if (typeof adminPassword !== 'string' || adminPassword.length < 32) {
    return res.status(503).json({
      error: 'Notification retry is not configured.'
    });
  }

  const providedPassword = req.headers['x-admin-password'];

  if (!providedPassword || !passwordMatches(providedPassword, adminPassword)) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  try {
    const contentType = String(
      req.headers['content-type'] || ''
    ).split(';')[0].trim().toLowerCase();

    if (contentType !== 'application/json') {
      return res.status(415).json({ error: 'JSON required.' });
    }

    let body;

    try {
      body = await parseJson(req);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }

    const notificationId = body.notification_id;

    if (
      typeof notificationId !== 'string' ||
      !UUID_PATTERN.test(notificationId)
    ) {
      return res.status(400).json({ error: 'Invalid notification.' });
    }

    const { db } = clients();

    const notification = checked(
      await db
        .from('order_status_notifications')
        .select(
          `
          id,
          order_id,
          customer_email,
          notification_type,
          status,
          attempts,
          store_orders (
            id,
            order_number,
            fulfillment_status,
            tracking_carrier,
            tracking_number
          )
        `
        )
        .eq('id', notificationId)
        .maybeSingle()
    );

    if (!notification) {
      return res.status(404).json({ error: 'Notification not found.' });
    }

    if (notification.status === 'sent') {
      return res.status(200).json({
        status: 'already_sent',
        notification_id: notification.id
      });
    }

    if (notification.status !== 'failed') {
      return res.status(409).json({
        error: 'Only failed notifications can be retried.'
      });
    }

    const order = notification.store_orders;

    if (!order) {
      return res.status(404).json({ error: 'Order no longer exists.' });
    }

    /*
     * Claim the retry atomically (failed -> pending). The mark helpers only
     * act on pending rows, and this also stops two clicks from both sending.
     */
    const claimed = checked(
      await db
        .from('order_status_notifications')
        .update({
          status: 'pending',
          updated_at: new Date().toISOString()
        })
        .eq('id', notification.id)
        .eq('status', 'failed')
        .select('id')
        .maybeSingle()
    );

    if (!claimed) {
      return res.status(409).json({
        error: 'This notification is already being retried.'
      });
    }

    try {
      const result = await sendEmail({
        to: notification.customer_email,
        from:
          process.env.ORDER_CONFIRMATION_FROM ||
          'AltaPure Labs <orders@altapurelabs.com>',
        replyTo:
          process.env.ADMIN_ORDER_EMAIL ||
          'altapurelabs@protonmail.com',
        subject: statusSubject(
          notification.notification_type,
          order.order_number || order.id
        ),
        html: statusHtml({
          order,
          notificationType: notification.notification_type
        }),
        text: statusText({
          order,
          notificationType: notification.notification_type
        })
      });

      await markNotificationSent({
        notificationId: notification.id,
        providerMessageId: result?.id || null
      });

      return res.status(200).json({
        status: 'accepted',
        notification_id: notification.id,
        provider_id: result?.id || null
      });
    } catch (error) {
      await markNotificationFailed({
        notificationId: notification.id,
        error: error.message,
        attempts: (Number(notification.attempts) || 0) + 1
      });

      return res.status(502).json({
        error:
          'Retry attempted, but the email was not confirmed as accepted.'
      });
    }
  } catch (error) {
    console.error('Notification retry failed', {
      name: error.name,
      code: error.code
    });

    return res.status(500).json({ error: 'Notification retry failed.' });
  }
};

async function parseJson(req) {
  const chunks = [];
  let bytes = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);

    bytes += buffer.length;

    if (bytes > 32768) {
      throw new Error('Request too large.');
    }

    chunks.push(buffer);
  }

  let body;

  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('Invalid JSON.');
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('A JSON object is required.');
  }

  return body;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function statusSubject(type, orderNumber) {
  const copy = {
    processing: 'Your AltaPure Labs order is being prepared',
    partially_shipped: 'Part of your AltaPure Labs order has shipped',
    shipped: 'Your AltaPure Labs order has shipped',
    delivered: 'Your AltaPure Labs order was delivered',
    canceled: 'Your AltaPure Labs order was canceled'
  };

  return `${copy[type]} — ${orderNumber}`;
}

function statusText({ order, notificationType }) {
  const messages = {
    processing: 'We received your order and are preparing it for shipment.',
    partially_shipped: 'Part of your order has shipped.',
    shipped: 'Your order has shipped.',
    delivered: 'Your order has been marked as delivered.',
    canceled: 'Your order has been canceled.'
  };

  return [
    'AltaPure Labs',
    '',
    messages[notificationType],
    `Order number: ${order.order_number || order.id}`,
    `Status: ${order.fulfillment_status}`,
    '',
    'Research use only. Not for human or veterinary use, ingestion, injection, diagnosis, treatment, or consumption.'
  ].join('\n');
}

function statusHtml({ order, notificationType }) {
  const messages = {
    processing: 'Your order is being prepared',
    partially_shipped: 'Part of your order has shipped',
    shipped: 'Your order has shipped',
    delivered: 'Your order was delivered',
    canceled: 'Your order was canceled'
  };

  return `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:620px;margin:0 auto;color:#111314;">
      <div style="background:#143832;color:#fff;padding:28px 32px;border-radius:12px 12px 0 0;">
        <h1 style="margin:0;font-size:22px;letter-spacing:.08em;">
          ALTAPURE LABS
        </h1>
      </div>

      <div style="background:#fff;padding:32px;border:1px solid #e5e7eb;border-top:0;">
        <h2 style="margin:0 0 12px;font-size:24px;">
          ${messages[notificationType]}
        </h2>

        <p style="margin:0 0 24px;color:#4e5556;">
          Order number:
          ${escapeHtml(order.order_number || order.id)}
        </p>

        <p style="margin:0;font-size:13px;color:#5f5638;">
          Research use only. Not for human or veterinary use, ingestion, injection, diagnosis, treatment, or consumption.
        </p>
      </div>
    </div>
  `;
}

async function sendEmail({ to, from, subject, html, text, replyTo }) {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    throw new Error('RESEND_API_KEY is missing.');
  }

  const response = await fetch('https://api.resend.com/emails', {
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
  });

  if (!response.ok) {
    throw new Error(`Resend rejected the request (${response.status}).`);
  }

  return await response.json();
}
