const {randomUUID} = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const {clients, checked} = require('../lib/backend');
module.exports = async (req,res) => {
  res.setHeader('Cache-Control','no-store');
  if (req.method !== 'POST') { res.setHeader('Allow','POST'); return res.status(405).json({error:'Use POST.'}); }
  try {
    const site = new URL(process.env.SITE_URL).origin;
    if (req.headers.origin !== site) return res.status(403).json({error:'Origin not allowed.'});
    if (!String(req.headers['content-type']||'').startsWith('application/json')) return res.status(415).json({error:'JSON required.'});
    const b = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const fail = msg => { const e=new Error(msg); e.validation=true; throw e; };
    if (!b || !Array.isArray(b.items) || !b.items.length || b.items.length>100) fail('Invalid cart.');
    if (b.research !== true) fail('Research confirmation required.');
    for (const k of ['name','email','org']) if (typeof b[k]!=='string' || !b[k].trim() || b[k].length>254) fail('Name, email and organization are required.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email)) fail('Invalid email.');
    const catalog=JSON.parse(fs.readFileSync(path.join(process.cwd(),'lib/catalog.json'),'utf8'));
    const seen=new Set();
    const items=b.items.map(line=>{
      const p=catalog.find(p=>p.id===line.id), v=p?.variants.find(v=>v.size===line.size);
      if (!v || !Number.isSafeInteger(line.qty) || line.qty<1 || line.qty>100) fail('Invalid product, size or quantity.');
      const key=p.id+':'+v.size;
      if (seen.has(key)) fail('Duplicate cart lines.'); seen.add(key);
      return {product_id:p.id, product_name:p.name, variant_size:v.size, quantity:line.qty, unit_price_cents:Math.round(v.price*100)};
    });
    const shipping=Number(process.env.SHIPPING_FLAT_RATE_CENTS);
    if (shipping!==2500) throw new Error('Shipping must be configured as 2500 cents.');
    const subtotal=items.reduce((s,i)=>s+i.quantity*i.unit_price_cents,0);
    if (subtotal+shipping>99999999) fail('Order exceeds checkout limit.');
    const {stripe,db}=clients();
    const id=randomUUID();
    checked(await db.from('store_orders').insert({id,customer_email:b.email.trim(),customer_name:b.name.trim(),organization:b.org.trim(),currency:'usd',subtotal_cents:subtotal,shipping_cents:shipping,total_cents:subtotal+shipping,research_confirmation_at:new Date().toISOString()}));
    checked(await db.from('store_order_items').insert(items.map(i=>({...i,order_id:id}))));
    const session=await stripe.checkout.sessions.create({
      adaptive_pricing: { enabled: false },
      mode:'payment',payment_method_types:['card'],customer_email:b.email.trim(),
      client_reference_id:id,metadata:{order_id:id},payment_intent_data:{metadata:{order_id:id}},
      line_items:items.map(i=>({quantity:i.quantity,price_data:{currency:'usd',unit_amount:i.unit_price_cents,product_data:{name:i.product_name+' — '+i.variant_size}}})),
      shipping_address_collection:{allowed_countries:['US']},
      shipping_options:[{shipping_rate_data:{type:'fixed_amount',fixed_amount:{amount:shipping,currency:'usd'},display_name:'US flat-rate shipping'}}],
      success_url:site+'/checkout-result.html?session_id={CHECKOUT_SESSION_ID}',cancel_url:site+'/?checkout=canceled#shop'
    },{idempotencyKey:'order-'+id});
    checked(await db.from('store_orders').update({stripe_checkout_session_id:session.id}).eq('id',id));
    return res.status(200).json({url:session.url});
  } catch(e) {
    const safeMessage = String(e.message || 'Unknown error')
  .replace(
    /(?:sk|rk)_(?:test|live)_[A-Za-z0-9_]+|whsec_[A-Za-z0-9_]+|sb_secret_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
    '[REDACTED]'
  )
  .slice(0, 600);

console.error('checkout failed', {
  name: e.name,
  code: e.code,
  type: e.type,
  message: safeMessage,
});
    return res.status(e.validation?400:500).json({error:e.validation?e.message:'Checkout unavailable. Check Vercel function logs and configuration.'});
  }
};
