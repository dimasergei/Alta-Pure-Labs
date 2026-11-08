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

  if (!providedPassword) {
    return res.status(401).json({
      error: 'Unauthorized.'
    });
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
      .order('created_at', { ascending: false })
      .limit(100);

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

    const notifications = checked(await query);

    return res.status(200).json({
      notifications
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
