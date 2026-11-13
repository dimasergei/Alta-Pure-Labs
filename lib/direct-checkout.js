'use strict';
const {createHash,randomUUID}=require('node:crypto');
const fs=require('node:fs'),path=require('node:path');
const base=require('./manual-commerce'),config=require('../config/checkout.json'),terms=require('../config/launch-commercial-terms.json');
const {applyBankDiscount}=require('./bank-transfer-discount');
const {normalizeCoupon,applyPromotions}=require('./checkout-promotions');
const conversion=require('./conversion-pricing'),partners=require('./partner-program'),delivery=require('./delivery-options');
function capabilities(available,env){const card=available.find(m=>m.native_provider==='nmi'),wallet=card?gateway.configuration('nmi',env).wallets:{};return {card:!!card,card_method_id:card?.id||null,apple_pay:!!card&&!!wallet.apple,google_pay:!!card&&!!wallet.google};}
const gateway=require('./gateway-config'),options=require('./payment-provider-options');
const {parseBody,configuredOrigin,enforceRateLimit}=require('./checkout-security');
const {passwordMatches}=require('./admin-operations');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
const checked=r=>{if(r.error){if(['P0001','23505','40001','23514','22023'].includes(r.error.code))fail(409,'The order, available balance or payment method changed. Refresh and review checkout again.');if(['P0002','PGRST116'].includes(r.error.code))fail(404,'Order not found.');fail(503,'Checkout is temporarily unavailable.');}return r.data;};
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const integer=v=>Number.isSafeInteger(v)&&v>=0&&v<=100000000;
function usable(m,env){return m.active&&m.currency==='USD'&&(m.native_provider?gateway.configuration(m.native_provider,env).ready&&gateway.configuration(m.native_provider,env).mode==='live':m.kind==='bank_transfer');}
async function methods(db,env){
 const rows=(checked(await db.from('commerce_payment_methods').select('*').order('display_order',{ascending:true}))||[]).filter(m=>usable(m,env));
 if(!rows.some(m=>m.native_provider))return rows;
 const accounts=checked(await db.from('commerce_gateway_accounts').select('method_id,mode,account_tag,countries'))||[];
 return rows.filter(m=>!m.native_provider||accounts.some(a=>a.method_id===m.id&&a.mode==='live'&&a.account_tag===gateway.configuration(m.native_provider,env).account_tag&&a.countries.includes('US')));
}
async function member(db,uid){const rows=checked(await db.from('commerce_memberships').select('invoice_id,plan,starts_at,expires_at').eq('customer_id',uid).is('revoked_at',null).lte('starts_at',new Date().toISOString()).gt('expires_at',new Date().toISOString()))||[];return rows.sort((a,b)=>(terms.memberships[b.plan]?.discount_bps||0)-(terms.memberships[a.plan]?.discount_bps||0))[0]||null;}
async function balances(db,uid){return checked(await db.from('commerce_balance_accounts').select('points,credit_cents').eq('customer_id',uid).maybeSingle())||{points:0,credit_cents:0};}
async function normalize(db,user,body,catalog){
 if(body.checkout_version!==config.version||!UUID.test(body.method_id||'')||!integer(body.points??0)||!integer(body.credit_cents??0))fail(400,'Review the current checkout options.');
 let record;
 // The catalog/address validator is shared with historical orders; this facade never writes a request.
 await base.requestInvoice({rpc:async(name,args)=>{record=args.p_data;return{data:{}};}},user,{...body,terms_version:terms.version},catalog);
 if(record.kind==='goods')record.request.research_use_confirmed=true;
 record.request.checkout={version:config.version,method_id:body.method_id,points:body.points||0,credit_cents:body.credit_cents||0,coupon:normalizeCoupon(body.coupon),delivery:delivery.selection(body.delivery)};
 if(record.kind==='membership'){record.request.billing_period=conversion.billingPeriod(body.billing_period);record.request.items=[conversion.membershipItem(record.plan,record.request.billing_period)];}
 delete record.digest;record.digest=digest(record);return record;
}
function price(record,method,membership,balance,referral=null,deliveryOptions=delivery.defaults){
 const goods=record.kind==='goods';
 if(goods&&!config.shipping_countries.includes(record.request.address.country))fail(400,'Online checkout currently supports US delivery. Contact us for other destinations.');
 if(!options.allowedFor(method,record.kind))fail(409,'This payment method does not support this purchase.');
 if(!goods&&membership)fail(409,'You already have an active pass. Contact us about changing your membership.');
 const pricing=base.priceLines(record.request.items,goods?(membership?.plan||'member'):'member');const coupon=record.request.checkout.coupon;const referralCoupon=!!referral&&referral.code===coupon;
 if(referralCoupon&&(!referral?.first_order||referral.code!==coupon))fail(400,'This referral code is available for a new customer’s first order.');
 applyPromotions(pricing,record.kind,referralCoupon?'':coupon);
 if(goods&&referralCoupon){for(const line of pricing.lines){const off=Math.floor((line.gross_cents-line.discount_cents)*conversion.config.partner.customer_discount_bps/10000);line.discount_cents+=off;line.line_total_cents-=off;}pricing.discount_cents=pricing.lines.reduce((n,x)=>n+x.discount_cents,0);pricing.coupon_code=coupon;pricing.referral_discount=true;}
 applyBankDiscount(pricing,method,record.kind);
 if(goods&&referral)pricing.referral={partner_id:referral.customer_id,code:referral.code,first_order:referral.first_order};
 const points=record.request.checkout.points,credit=record.request.checkout.credit_cents;
 if(!goods&&(points||credit))fail(400,'Points and store credit apply to products, not membership fees.');
 if(points&&(points<config.minimum_points_redemption||points>Math.max(0,balance.points)))fail(409,'Use at least 100 points, up to your available points balance.');
 if(credit>balance.credit_cents)fail(409,'The requested store credit exceeds your available balance.');
 const merchandise=pricing.subtotal_cents-pricing.discount_cents,deliveryQuote=goods?delivery.price(record.request.checkout.delivery,conversion.shipping(merchandise,membership)===0,deliveryOptions):null,shipping=deliveryQuote?.total_cents||0;
 pricing.delivery=deliveryQuote;
 if(points>merchandise||points+credit>merchandise+shipping)fail(400,'Redeemed value cannot exceed the order amount. Points apply to merchandise only.');
 const total=merchandise+shipping-points-credit;
 if(method.native_provider==='peptidepay'&&total>0&&total<100)fail(400,'PeptidePay requires at least US$1 remaining to pay. Reduce the redeemed value.');
 pricing.checkout_version=config.version;pricing.billing_period=record.request.billing_period||null;pricing.conversion_version=conversion.config.version;pricing.redeemed_points=points;pricing.credit_cents=credit;pricing.shipping_note=goods?config.shipping_note:null;
 return {pricing,subtotal_cents:pricing.subtotal_cents,discount_cents:pricing.discount_cents,shipping_cents:shipping,tax_cents:0,total_cents:total,
  points_redeemed:points,credit_redeemed_cents:credit,earned_points:goods?conversion.earnings(merchandise-points-credit,membership):0,
  membership_invoice_id:membership?.invoice_id||null,method_version:method.version,currency:'USD',method_id:method.id};
}
async function handle(req,res,params,deps={}){
 const env=deps.env||process.env;res.setHeader('Cache-Control','no-store');res.setHeader('Vary','Authorization');res.setHeader('X-Content-Type-Options','nosniff');
 try{
  if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');fail(405,'Method not allowed.');}
  const db=deps.db||require('./inventory-db').inventoryDb();
  if(params.get('checkout')==='public'&&req.method==='GET'){const available=await methods(db,env);return res.status(200).json({config,terms:{...terms,conversion:conversion.config},delivery_options:await delivery.load(db),capabilities:capabilities(available,env),methods:options.publicMethods(available).map(m=>({...m,label:conversion.bankLabel(m),native_provider:available.find(a=>a.id===m.id)?.native_provider||null}))});}
  if(req.method==='POST'){
   if(req.headers.origin!==configuredOrigin(env.SITE_URL))fail(403,'Origin not allowed.');
   if(String(req.headers['content-type']||'').split(';')[0]!=='application/json')fail(415,'JSON required.');
  }
  if(params.get('checkout')==='cart'&&req.method==='POST')return await cartPreview(req,res,db,env,deps);
  if(params.get('checkout')==='admin'){
   if(typeof env.ADMIN_ORDERS_PASSWORD!=='string'||env.ADMIN_ORDERS_PASSWORD.length<32||!passwordMatches(req.headers['x-admin-password'],env.ADMIN_ORDERS_PASSWORD))fail(401,'Unauthorized.');
   if(req.method!=='POST')fail(405,'Use POST.');const b=parseBody(req.body);
   if(b.action==='refund_balance'){
    if(!UUID.test(b.id||'')||!Number.isSafeInteger(b.version)||b.version<1||b.confirmed!==true)fail(400,'Confirm the full account-balance refund.');
    const result=checked(await db.rpc('commerce_refund_balance_order',{p_id:b.id,p_version:b.version,p_actor:'admin:'+randomUUID()}));
    try{await require('./invoice-notifications').dispatch(db,{invoiceId:b.id,env,limit:2,fetchImpl:deps.fetchImpl});}catch{}
    return res.status(200).json(result);
   }
   if(b.action!=='issue_credit'||!UUID.test(b.id||'')||!UUID.test(b.customer_id||'')||!Number.isSafeInteger(b.amount_cents)||b.amount_cents<1||b.amount_cents>100000||typeof b.reason!=='string'||b.reason.trim().length<12||b.reason.length>500)fail(400,'Enter a customer ID, an amount up to US$1,000 and an audit reason.');
   return res.status(200).json(checked(await db.rpc('commerce_issue_credit',{p_id:b.id,p_customer:b.customer_id,p_amount:b.amount_cents,p_reason:b.reason.trim(),p_actor:'admin:'+randomUUID()})));
  }
  const token=/^Bearer ([A-Za-z0-9._~-]{20,8192})$/.exec(req.headers.authorization||'');if(!token)fail(401,'Sign in to check out.');
  const auth=await db.auth.getUser(token[1]),user=auth.data?.user;if(auth.error||!user?.email_confirmed_at||!user.email)fail(401,'Sign in with a verified email.');
  if(req.method==='GET'){
   const [available,m,b,events]=await Promise.all([methods(db,env),member(db,user.id),balances(db,user.id),db.from('commerce_balance_events').select('id,invoice_id,asset,delta,reason,created_at').eq('customer_id',user.id).order('created_at',{ascending:false}).limit(100)]);
   return res.status(200).json({config,terms:{...terms,conversion:conversion.config},delivery_options:await delivery.load(db),capabilities:capabilities(available,env),methods:options.publicMethods(available).map(m=>({...m,label:conversion.bankLabel(m),native_provider:available.find(a=>a.id===m.id)?.native_provider||null})),membership:m,balances:b,events:checked(events)||[]});
  }
  const body=parseBody(req.body);
  if(body.action==='cancel'){
   if(!UUID.test(body.id||'')||body.no_payment_sent!==true)fail(400,'Confirm that this order is unpaid before canceling.');
   const invoice=checked(await db.from('commerce_invoices').select('id,status,currency,total_cents').eq('id',body.id).eq('customer_id',user.id).maybeSingle());
   if(!invoice)fail(404,'Order not found.');
   if(invoice.status==='void')return res.status(200).json({id:body.id,status:'void',already_canceled:true});
   const check=await require('./commerce-cancellation').verifyUnpaid(db,invoice,{env,fetchImpl:deps.fetchImpl||fetch});
   const done=checked(await db.rpc('commerce_cancel_checkout',{p_id:body.id,p_customer:user.id}));
   try{await require('./invoice-notifications').dispatch(db,{invoiceId:body.id,env,limit:2,fetchImpl:deps.fetchImpl});}catch{}
   return res.status(200).json({...done,provider_link_may_remain_live:check.provider_link_may_remain_live||done.provider_link_may_remain_live});
  }
  if(!['quote','place'].includes(body.action))fail(400,'Unknown checkout action.');
  await (deps.rateLimit||enforceRateLimit)(db,'direct-checkout:'+user.id,env.CHECKOUT_RATE_LIMIT_SECRET);
  const catalog=deps.catalog||JSON.parse(fs.readFileSync(path.join(process.cwd(),'lib/catalog.json'),'utf8'));
  const record=await normalize(db,user,body,catalog);
  if(body.action==='place'){
   const existing=checked(await db.from('commerce_invoices').select('id,status,request_digest,checkout_version').eq('id',record.id).eq('customer_id',user.id).maybeSingle());
   if(existing){if(existing.request_digest!==record.digest||existing.checkout_version!==config.version)fail(409,'This checkout reference is already in use.');return res.status(200).json({id:existing.id,status:existing.status,replayed:true});}
  }
  const m=(await methods(db,env)).find(m=>m.id===body.method_id);if(!m)fail(409,'This payment method is currently unavailable.');
  const [membership,balance]=await Promise.all([member(db,user.id),balances(db,user.id)]);
  const code=partners.isReferralCode(record.request.checkout.coupon)?record.request.checkout.coupon:partners.readCookie(req.headers.cookie,env.CHECKOUT_RATE_LIMIT_SECRET);
  const referral=record.kind==='goods'?await partners.referral(db,user.id,code,user.email):null;
  const result=price(record,m,membership,balance,referral,await delivery.load(db)),quote=digest({...result,record_digest:record.digest});
  if(body.action==='quote')return res.status(200).json({...result,quote,config});
  if(body.quote!==quote)fail(409,'The total or account balance changed. Review the updated checkout.');
  const out=checked(await db.rpc('commerce_place_checkout',{p_data:{...record,...result,checkout_version:config.version}}));
  try{await require('./invoice-notifications').dispatch(db,{invoiceId:out.id,env,limit:2,fetchImpl:deps.fetchImpl});}catch{}
  return res.status(201).json(out);
 }catch(e){const status=[400,401,403,404,405,409,413,415,429].includes(e.status)?e.status:503;return res.status(status).json({error:status===503?'Checkout could not be confirmed. Keep your order reference and check your orders before retrying.':e.message});}
}
async function cartPreview(req,res,db,env,deps){
 const body=parseBody(req.body),catalog=deps.catalog||JSON.parse(fs.readFileSync(path.join(process.cwd(),'lib/catalog.json'),'utf8'));
 const lines=base.itemsFromCatalog(body.items,catalog),available=await methods(db,env);
 const method=available.find(m=>m.id===body.method_id)||available[0];if(!method)fail(409,'Checkout is temporarily unavailable.');
 let membership=null,user=null;
 if(req.headers.authorization){const token=/^Bearer ([A-Za-z0-9._~-]{20,8192})$/.exec(req.headers.authorization);if(!token)fail(401,'Sign in again.');const a=await db.auth.getUser(token[1]);if(a.error||!a.data?.user?.email_confirmed_at)fail(401,'Sign in again.');user=a.data.user;membership=await member(db,user.id);}
 const coupon=normalizeCoupon(body.coupon),p=partners.isReferralCode(coupon)?await partners.lookup(db,coupon,user?.id):null;
 const referral=p?(user?await partners.referral(db,user.id,coupon,user.email):{...p,first_order:true}):null;
 const record={kind:'goods',request:{items:lines,address:{country:'US'},checkout:{coupon,points:0,credit_cents:0,delivery:delivery.selection(body.delivery)}}};
 const deliveryOptions=await delivery.load(db),q=price(record,method,membership,{points:0,credit_cents:0},referral,deliveryOptions);
 const gold=!membership?price(record,method,{plan:'vip'},{points:0,credit_cents:0},referral,deliveryOptions):null;
 return res.status(200).json({...q,method_label:conversion.bankLabel(method),free_shipping_threshold_cents:conversion.config.free_shipping_threshold_cents,free_shipping_remaining_cents:q.shipping_cents?Math.max(0,conversion.config.free_shipping_threshold_cents-(q.subtotal_cents-q.discount_cents)):0,shipping_note:config.shipping_note,estimate:true,sign_in_for_benefits:!user,wallets:capabilities(available,env),membership_savings_cents:gold?Math.max(0,q.total_cents-gold.total_cents):0,delivery_options:deliveryOptions});
}
module.exports={handle,price,normalize,usable,cartPreview,capabilities};
