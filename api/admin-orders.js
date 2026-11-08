const { clients, checked } = require('../lib/backend');

const ALLOWED_STATUSES = [
  'paid',
  'processing',
  'shipped',
  'delivered',
  'canceled',
];

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
        .select('id,fulfillment_status,tracking_carrier,tracking_number,shipped_at,admin_notes')
        .single();

      const updatedOrder = checked(response);

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
