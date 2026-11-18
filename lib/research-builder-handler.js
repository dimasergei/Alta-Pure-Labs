'use strict';

module.exports = async (req, res, deps={}) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Vary', 'Authorization');
  if (req.method === 'GET') {
    if (req.query?.scope === 'admin') {
      if (!(await require('./admin-auth').requireAdmin(req, res))) return;
      try {
        const db = deps.db || require('./inventory-db').inventoryDb();
        const {data,error} = await db.from('research_subscriptions')
          .select('id,customer_email,status,lines,monthly_cents,paid_cycles,minimum_paid_cycles,next_billing_at,first_delivery_shipped_at,created_at')
          .order('created_at',{ascending:false}).limit(100);
        if (error) throw error;
        return res.status(200).json({subscriptions:data||[]});
      } catch {return res.status(503).json({error:'Subscription records are temporarily unavailable.'});}
    }
    if (req.query?.scope !== 'mine') {
      const pricing=require('./research-builder-pricing');
      const source=deps.catalog||JSON.parse(require('node:fs').readFileSync(require('node:path').join(process.cwd(),'lib/catalog.json'),'utf8'));
      return res.status(200).json({catalog:pricing.catalog(source),terms:pricing.terms,subscription_available:false,one_time_available:true,
        reason:'Automatic monthly billing is not connected yet.'});
    }
    const match = /^Bearer ([A-Za-z0-9._~-]{20,8192})$/.exec(req.headers.authorization || '');
    if (!match) return res.status(401).json({ error: 'Sign in to view your subscriptions.' });
    try {
      const db = deps.db || require('./inventory-db').inventoryDb();
      const auth = await db.auth.getUser(match[1]);
      if (auth.error || !auth.data?.user?.email_confirmed_at) return res.status(401).json({ error: 'Sign in with a verified email.' });
      const { data, error } = await db.from('research_subscriptions')
        .select('id,status,lines,retail_cents,discount_cents,monthly_cents,shipping_cents,bundled_item,minimum_paid_cycles,paid_cycles,first_delivery_shipped_at,next_billing_at,canceled_at,created_at,research_subscription_cycles(cycle_number,amount_cents,status,paid_at,shipped_at,tracking_number)')
        .eq('customer_id', auth.data.user.id).order('created_at', { ascending: false }).limit(30);
      if (error) throw error;
      return res.status(200).json({ subscriptions:(data||[]).map(item=>({...item,currency:'USD',actions:[]})),subscription_available:false,one_time_available:true,
        reason:'Automatic monthly billing is not connected yet. No renewal is scheduled by this checkout.' });
    } catch { return res.status(503).json({ error: 'Subscriptions are temporarily unavailable.' }); }
  }
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({error:'Method not allowed.'}); }
  try{
    const {parseBody,isAllowedOrigin}=require('./checkout-security'),env=deps.env||process.env;
    if(!isAllowedOrigin(req.headers.origin,env.SITE_URL))return res.status(403).json({error:'Origin not allowed.'});
    if(String(req.headers['content-type']||'').split(';')[0]!=='application/json')return res.status(415).json({error:'JSON required.'});
    const body=parseBody(req.body);
    if(body.action!=='quote')return res.status(409).json({error:'Automatic monthly billing is not connected. You can build a one-time order and pay at checkout.'});
    let membership=null;
    if(req.headers.authorization){
      const match=/^Bearer ([A-Za-z0-9._~-]{20,8192})$/.exec(req.headers.authorization);
      if(!match)return res.status(401).json({error:'Sign in again to verify your membership.'});
      const db=deps.db||require('./inventory-db').inventoryDb(),auth=await db.auth.getUser(match[1]);
      if(auth.error||!auth.data?.user?.email_confirmed_at)return res.status(401).json({error:'Sign in with a verified email.'});
      membership=await require('./membership-benefits').active(db,auth.data.user.id);
    }
    const source=deps.catalog||JSON.parse(require('node:fs').readFileSync(require('node:path').join(process.cwd(),'lib/catalog.json'),'utf8'));
    return res.status(200).json(require('./research-builder-pricing').quote(body.items,source,{mode:body.mode,membership,coupon:body.coupon||''}));
  }catch(error){const status=[400,401,403,409,413,415].includes(error.status)?error.status:503;return res.status(status).json({error:status===503?'Auto-Stack™ pricing is temporarily unavailable. Try again before checking out.':error.message});}
};
