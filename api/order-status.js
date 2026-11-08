const { clients, checked } = require('../lib/backend');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).end();
  }

  const sessionId = req.query.session_id;

  if (
    typeof sessionId !== 'string' ||
    !sessionId.startsWith('cs_test_') ||
    sessionId.length > 255
  ) {
    return res.status(400).json({
      error: 'Invalid session.'
    });
  }

  try {
    const { db } = clients();

    const response = checked(
      await db
        .from('store_orders')
        .select(
          'id,order_number,payment_status,fulfillment_status,total_cents,currency'
        )
        .eq('stripe_checkout_session_id', sessionId)
        .maybeSingle()
    );

    const order = response?.data || response;

    if (!order) {
      return res.status(200).json({
        status: 'pending'
      });
    }

    return res.status(200).json({
      status: order.payment_status,
      order_id: order.id,
      order_number: order.order_number || order.id,
      fulfillment_status: order.fulfillment_status || 'paid',
      total_cents: order.total_cents,
      currency: order.currency
    });
  } catch (error) {
    console.error('Order status lookup failed', error.message);

    return res.status(503).json({
      error: 'Status unavailable.'
    });
  }
};
