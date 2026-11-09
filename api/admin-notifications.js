const crypto = require('node:crypto');
const { clients, checked } = require('../lib/backend');

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  const adminPassword = process.env.ADMIN_ORDERS_PASSWORD;

  if (
    typeof adminPassword !== 'string' ||
    adminPassword.length < 32
  ) {
    return res.status(503).json({
      error: 'Notification queue is not configured.'
    });
  }

  const providedPassword = req.headers['x-admin-password'];

  if (
    typeof providedPassword !== 'string' ||
    providedPassword.length > 4096 ||
    !passwordMatches(providedPassword, adminPassword)
  ) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');

    return res.status(405).json({
      error: 'Method not allowed.'
    });
  }

  try {
    const params = new URL(
      req.url,
      'https://admin.internal'
    ).searchParams;

    const statusFilter = params.get('status') || 'all';
    const search = (params.get('search') || '').trim();

    const allowedStatuses = [
      'all',
      'pending',
      'sent',
      'failed'
    ];

    if (!allowedStatuses.includes(statusFilter)) {
      return res.status(400).json({
        error: 'Invalid notification status.'
      });
    }

    const { db } = clients();

    let query = db
      .from('order_status_notifications')
      .select(
        `
        id,
        order_id,
        customer_email,
        notification_type,
        status,
        attempts,
        last_error,
        provider_message_id,
        created_at,
        updated_at,
        sent_at,
        store_orders (
          order_number,
          customer_name
        )
      `
      )
      .order('created_at', { ascending: false });

    if (statusFilter !== 'all') {
      query = query.eq('status', statusFilter);
    }

    if (search) {
      query = query.or(
        [
          `customer_email.ilike.%${search}%`,
          `store_orders.order_number.ilike.%${search}%`,
          `store_orders.customer_name.ilike.%${search}%`
        ].join(',')
      );
    }

    const limit = Math.min(100, Math.max(1, Number(params.get('limit')) || 50));
    const offset = Math.max(0, Number(params.get('offset')) || 0);
    const { data: pageRows, error: pageError, count } = await query
      .select(
        `
        id, order_id, customer_email, notification_type, status, attempts,
        last_error, provider_message_id, created_at, updated_at, sent_at,
        store_orders (order_number, customer_name)
        `,
        { count: 'exact' }
      )
      .range(offset, offset + limit - 1);
    if (pageError) throw pageError;
    const notifications = pageRows || [];
    const orderIds = [...new Set(notifications.map((item) => item.order_id).filter(Boolean))];
    let batchRows = [];
    if (orderIds.length) {
      batchRows = checked(await db.from('supplier_batch_items')
        .select('order_id,supplier_batches(id,name,status,archived_at)')
        .in('order_id', orderIds));
    }
    const batchesByOrder = new Map();
    for (const row of batchRows || []) {
      if (!row.supplier_batches) continue;
      const list = batchesByOrder.get(row.order_id) || [];
      if (!list.some((batch) => batch.id === row.supplier_batches.id)) list.push(row.supplier_batches);
      batchesByOrder.set(row.order_id, list);
    }
    for (const notification of notifications) {
      notification.batch_references = batchesByOrder.get(notification.order_id) || [];
    }

    return res.status(200).json({
      notifications,
      pagination: {
        offset,
        limit,
        total: count || 0,
        has_previous: offset > 0,
        has_next: offset + notifications.length < (count || 0)
      }
    });
  } catch (error) {
    console.error('Notification queue lookup failed', {
      name: error.name,
      code: error.code
    });

    return res.status(503).json({
      error: 'Notification queue unavailable.'
    });
  }
};

function passwordMatches(provided, expected) {
  const a = crypto.createHash('sha256').update(provided).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}
