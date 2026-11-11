'use strict';
const {randomBytes, createHmac, timingSafeEqual} = require('node:crypto');
const config = require('../config/conversion.json').partner;
const {parseBody, configuredOrigin, enforceRateLimit} = require('./checkout-security');
const CODE = /^AP-[A-Z2-9]{12}$/;
function checked(result) { if(result.error) throw Object.assign(Error('Partner records are temporarily unavailable.'),{status:503}); return result.data; }
function cookieToken(code, secret, now = Date.now()) {
  const payload = code+'.'+Math.floor(now/1000);
  return payload+'.'+createHmac('sha256', secret).update(payload).digest('hex');
}
function readCookie(header, secret, now = Date.now()) {
  if (!secret) return null;
  const raw = String(header||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('ap_ref='))?.slice(7);
  if (!raw || !/^AP-[A-Z2-9]{12}\.\d{10}\.[a-f0-9]{64}$/.test(raw)) return null;
  const [code, stamp, signature] = raw.split('.'), age = Math.floor(now/1000)-Number(stamp);
  const expected = createHmac('sha256',secret).update(code+'.'+stamp).digest('hex');
  return age>=0 && age<=config.cookie_days*86400 && timingSafeEqual(Buffer.from(signature),Buffer.from(expected)) ? code : null;
}
async function lookup(db, code, userId) {
  if (!CODE.test(code||'')) return null;
  const partner = checked(await db.from('commerce_partners').select('customer_id,code,status').eq('code',code).eq('status','active').maybeSingle());
  return partner && partner.customer_id!==userId ? partner : null;
}
async function referral(db, userId, code, email) {
  const existing = checked(await db.from('commerce_referrals').select('partner_id').eq('customer_id',userId).maybeSingle());
  if (existing) {
    const p=checked(await db.from('commerce_partners').select('customer_id,code,status').eq('customer_id',existing.partner_id).eq('status','active').maybeSingle());
    return p ? {...p, first_order:false} : null;
  }
  const partner=await lookup(db,code,userId); if(!partner)return null;
  if(email){const historical=checked(await db.from('store_orders').select('id').ilike('customer_email',email.replace(/[%_]/g,'\\$&')).in('payment_status',['paid','partially_refunded','refunded']).limit(1));if(historical?.length)return null;}
  const past=checked(await db.from('commerce_invoices').select('id').eq('customer_id',userId).eq('kind','goods').in('status',['paid','processing','shipped','delivered','refunded']).limit(1));
  return past?.length ? null : {...partner,first_order:true};
}
async function handle(req,res,params,deps={}) {
  const env=deps.env||process.env,db=deps.db||require('./inventory-db').inventoryDb();
  res.setHeader('Cache-Control','no-store');res.setHeader('Vary','Authorization');
  try {
    if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'Method not allowed.'});
    if(req.method==='POST' && (req.headers.origin!==configuredOrigin(env.SITE_URL)||String(req.headers['content-type']||'').split(';')[0]!=='application/json'))return res.status(403).json({error:'Request not allowed.'});
    const body=req.method==='POST'?parseBody(req.body):null;
    if(body?.action==='visit') {
      const p=await lookup(db,String(body.code||'').toUpperCase());
      if(p && env.CHECKOUT_RATE_LIMIT_SECRET)res.setHeader('Set-Cookie','ap_ref='+cookieToken(p.code,env.CHECKOUT_RATE_LIMIT_SECRET)+'; Max-Age='+config.cookie_days*86400+'; Path=/; Secure; HttpOnly; SameSite=Lax');
      return res.status(200).json({recorded:!!p});
    }
    if(params.get('partner')==='admin') {
      const {passwordMatches}=require('./admin-operations');
      if(typeof env.ADMIN_ORDERS_PASSWORD!=='string'||env.ADMIN_ORDERS_PASSWORD.length<32||!passwordMatches(req.headers['x-admin-password'],env.ADMIN_ORDERS_PASSWORD))return res.status(401).json({error:'Unauthorized.'});
      if(req.method==='POST') {
        if(body.action!=='record_payout'||body.funds_sent!==true)return res.status(400).json({error:'Confirm the external payout was sent.'});
        const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
        if(!uuid.test(body.id)||!uuid.test(body.partner_id)||!Number.isSafeInteger(body.amount_cents)||body.amount_cents<10000||typeof body.reference!=='string'||body.reference.length<8||body.reference.length>180)return res.status(400).json({error:'Invalid payout record.'});
        return res.status(200).json(checked(await db.rpc('commerce_record_partner_payout',{p_id:body.id,p_partner:body.partner_id,p_amount:body.amount_cents,p_reference:body.reference,p_actor:'admin-payout'})));
      }
      const rows=checked(await db.from('commerce_partners').select('customer_id,code,status,created_at').order('created_at',{ascending:false}).limit(200));
      const items=[];for(const p of rows){checked(await db.rpc('commerce_refresh_partner',{p_customer:p.customer_id}));items.push({...p,summary:checked(await db.rpc('commerce_partner_summary',{p_customer:p.customer_id}))});}
      return res.status(200).json({partners:items});
    }
    const token=/^Bearer ([A-Za-z0-9._~-]{20,8192})$/.exec(req.headers.authorization||'');
    if(!token)return res.status(401).json({error:'Sign in to access your partner dashboard.'});
    const a=await db.auth.getUser(token[1]),u=a.data?.user;
    if(a.error||!u?.email_confirmed_at)return res.status(401).json({error:'Verify your email to join.'});
    if(req.method==='POST') {
      if(body.action!=='join'||body.accepted!==true||body.terms_version!==config.version)return res.status(400).json({error:'Review and accept the partner terms.'});
      await (deps.rateLimit||enforceRateLimit)(db,'partner-join:'+u.id,env.CHECKOUT_RATE_LIMIT_SECRET);
      const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      const code='AP-'+Array.from(randomBytes(12),x=>alphabet[x%alphabet.length]).join('');
      return res.status(200).json(checked(await db.rpc('commerce_join_partner',{p_customer:u.id,p_code:code,p_terms:config.version})));
    }
    checked(await db.rpc('commerce_refresh_partner',{p_customer:u.id}));
    const partner=checked(await db.from('commerce_partners').select('code,status,created_at,terms_version').eq('customer_id',u.id).maybeSingle());
    const events=partner?checked(await db.from('commerce_partner_commissions').select('id,invoice_id,basis_cents,rate_bps,amount_cents,status,eligible_at,created_at,payout_reference').eq('partner_id',u.id).order('created_at',{ascending:false}).limit(200)):[];
    const summary=partner?checked(await db.rpc('commerce_partner_summary',{p_customer:u.id})):null;
    return res.status(200).json({partner,events,summary,terms:config});
  }catch(e){return res.status(e.status||503).json({error:e.status===429?e.message:'Partner records could not be loaded. Please retry.'});}
}
module.exports={handle,referral,lookup,readCookie,cookieToken,CODE};
