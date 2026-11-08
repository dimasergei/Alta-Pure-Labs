const crypto = require('crypto');
const { clients, checked } = require('../lib/backend');
const { buildStatusEmail } = require('../lib/customer-order-email');

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
            customer_name,
            customer_email,
            payment_status,
            fulfillment_status,
            currency,
            subtotal_cents,
            shipping_cents,
            total_cents,
            shipping_name,
            shipping_address,
            tracking_carrier,
            tracking_number,
            store_order_items (
              product_name,
              variant_size,
              quantity,
              unit_price_cents
            )
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
      const email = buildStatusEmail({
        order,
        notificationType: notification.notification_type
      });
      const result = await sendEmail({
        to: order.customer_email || notification.customer_email,
        from: process.env.ORDER_CONFIRMATION_FROM || 'AltaPure Labs <orders@altapurelabs.com>',
        replyTo: process.env.ADMIN_ORDER_EMAIL || 'altapurelabs@protonmail.com',
        subject: email.subject,
        html: email.html,
        text: email.text
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

async function sendEmail({ to, from, subject, html, text, replyTo }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY is missing.');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    signal: AbortSignal.timeout(10000),
    headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, html, text, ...(replyTo ? { reply_to: replyTo } : {}) })
  });
  if (!response.ok) throw new Error('Resend rejected the request (' + response.status + ').');
  return await response.json();
}
