'use strict';
const { quote, catalog } = require('./research-builder-pricing');
const { parseBody, isAllowedOrigin } = require('./checkout-security');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Vary', 'Authorization');
  if (req.method === 'GET') {
    if (req.query?.scope === 'admin') {
      const { passwordMatches } = require('./admin-operations');
      const password = process.env.ADMIN_ORDERS_PASSWORD;
      if (typeof password !== 'string' || password.length < 32 || !passwordMatches(req.headers['x-admin-password'], password))
        return res.status(401).json({ error: 'Unauthorized.' });
      try {
        const db = require('./inventory-db').inventoryDb();
        const {data,error} = await db.from('research_subscriptions')
          .select('id,customer_email,status,lines,monthly_cents,paid_cycles,minimum_paid_cycles,next_billing_at,first_delivery_shipped_at,created_at')
          .order('created_at',{ascending:false}).limit(100);
        if (error) throw error;
        return res.status(200).json({subscriptions:data||[]});
      } catch {return res.status(503).json({error:'Subscription records are temporarily unavailable.'});}
    }
    if (req.query?.scope !== 'mine') return res.status(200).json({ subscription_available: false,
      reason: 'A recurring-payment provider is not connected. No monthly billing or delivery is scheduled.' });
    const match = /^Bearer ([A-Za-z0-9._~-]{20,8192})$/.exec(req.headers.authorization || '');
    if (!match) return res.status(401).json({ error: 'Sign in to view your subscriptions.' });
    try {
      const db = require('./inventory-db').inventoryDb();
      const auth = await db.auth.getUser(match[1]);
      if (auth.error || !auth.data?.user?.email_confirmed_at) return res.status(401).json({ error: 'Sign in with a verified email.' });
      const { data, error } = await db.from('research_subscriptions')
        .select('id,status,lines,retail_cents,discount_cents,monthly_cents,shipping_cents,bundled_item,minimum_paid_cycles,paid_cycles,first_delivery_shipped_at,next_billing_at,canceled_at,created_at,research_subscription_cycles(cycle_number,amount_cents,status,paid_at,shipped_at,tracking_number)')
        .eq('customer_id', auth.data.user.id).order('created_at', { ascending: false }).limit(30);
      if (error) throw error;
      return res.status(200).json({ subscriptions: data || [] });
    } catch { return res.status(503).json({ error: 'Subscriptions are temporarily unavailable.' }); }
  }
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ error: 'Method not allowed.' }); }
  if (!isAllowedOrigin(req.headers.origin,process.env.SITE_URL)) return res.status(403).json({ error: 'Origin not allowed.' });
  if (String(req.headers['content-type'] || '').split(';')[0] !== 'application/json') return res.status(415).json({ error: 'JSON required.' });
  try {
    const body = parseBody(req.body);
    if (body.action !== 'quote') return res.status(409).json({ error: 'Recurring checkout is unavailable. No subscription was created.' });
    return res.status(200).json({ ...quote(body.lines, catalog()), minimum_paid_cycles: 3,
      change_after_first_shipment: true, cancellation_after_third_delivery: true,
      reason: 'Recurring payment setup is pending. No order or subscription can be placed yet.' });
  } catch (error) { return res.status(error.status === 413 ? 413 : 400).json({ error: error.message }); }
};
