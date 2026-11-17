'use strict';

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Vary', 'Authorization');
  if (req.method === 'GET') {
    if (req.query?.scope === 'admin') {
      if (!(await require('./admin-auth').requireAdmin(req, res))) return;
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
      reason: 'Research Builder and subscriptions are unavailable.' });
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
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET'); return res.status(405).json({error:'Method not allowed.'}); }
  return res.status(409).json({error:'Research Builder and subscription purchases are unavailable.'});
};
