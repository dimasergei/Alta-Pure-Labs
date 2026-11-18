'use strict';
const storefrontTerms=require('./storefront-terms');
const {createHash,randomUUID}=require('node:crypto');
const fs=require('node:fs'),path=require('node:path');
const base=require('./manual-commerce'),config=require('../config/checkout.json'),terms=require('../config/launch-commercial-terms.json');
const {normalizeCoupon,applyPromotions}=require('./checkout-promotions');
const paymentPolicy=require('./pure-payment-policy');
const conversion=require('./conversion-pricing'),partners=require('./partner-program'),delivery=require('./delivery-options');
function capabilities(available,env){
 const method=available.find(m=>m.native_provider==='nmi');
 const c=method?gateway.configuration('nmi',env):null,ready=!!method&&!!c?.ready&&c.mode==='live';
 return{card:ready,card_method_id:ready?method.id:null,apple_pay:ready&&!!c.wallets.apple,google_pay:ready&&!!c.wallets.google};
}
function nmiPublicConfig(available,env){
 const method=available.find(m=>m.native_provider==='nmi');
 if(!method)return null;
 const c=gateway.configuration('nmi',env);
 return c.ready&&c.mode==='live'&&typeof c.tokenization_key==='string'
  ?{ready:true,method_id:method.id,tokenization_key:c.tokenization_key,three_ds:c.three_ds,wallets:{...c.wallets}}:null;
}
const gateway=require('./gateway-config'),options=require('./payment-provider-options');
const {parseBody,isAllowedOrigin,enforceRateLimit}=require('./checkout-security');
const {assertAdmin}=require('./admin-auth');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
const checked=r=>{if(r.error){if(['P0001','23505','40001','23514','22023'].includes(r.error.code))fail(409,'The order, available balance or payment method changed. Refresh and review checkout again.');if(['P0002','PGRST116'].includes(r.error.code))fail(404,'Order not found.');fail(503,'Checkout is temporarily unavailable.');}return r.data;};
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const integer=v=>Number.isSafeInteger(v)&&v>=0&&v<=100000000;
function usable(m,env){
 if(m.kind==='interac'||m.provider_key==='interac')return m.active&&paymentPolicy.kind(m)==='interac';
 return m.active&&m.currency==='USD'&&['rampex','polygon_usdc'].includes(m.native_provider)
  &&gateway.configuration(m.native_provider,env).ready&&gateway.configuration(m.native_provider,env).mode==='live';
}
async function methods(db,env,country=null){
 const rows=(checked(await db.from('commerce_payment_methods').select('*').order('display_order',{ascending:true}))||[]).filter(m=>usable(m,env)&&options.allowedFor(m,'goods'));
 if(!rows.length)return [];
 const accounts=rows.some(m=>paymentPolicy.kind(m)!=='interac')
  ?checked(await db.from('commerce_gateway_accounts').select('method_id,provider,mode,account_tag,countries,rampex_provider'))||[]:[];
 const available=[];
 for(const method of rows){
  if(paymentPolicy.kind(method)==='interac'){
   if((!country||country==='CA')&&!available.some(m=>paymentPolicy.kind(m)==='interac'))available.push({...method,countries:['CA']});
   continue;
  }
  const account=accounts.find(a=>a.method_id===method.id&&a.provider===method.native_provider&&a.mode==='live'&&a.account_tag===gateway.configuration(method.native_provider,env).account_tag);
  if(!account||!Array.isArray(account.countries)||!account.countries.length||country&&!account.countries.includes(country))continue;
  const item={...method,countries:account.countries,rampex_provider:account.rampex_provider};
  const paymentKind=paymentPolicy.kind(item);
  if(paymentKind&&!available.some(m=>paymentPolicy.kind(m)===paymentKind))available.push(item);
 }
 const order={card:0,crypto:1,interac:2};
 return available.sort((a,b)=>order[paymentPolicy.kind(a)]-order[paymentPolicy.kind(b)]);
}
function publicMethods(available){return available.map(paymentPolicy.publicMethod);}
async function balances(db,uid){return checked(await db.from('commerce_balance_accounts').select('points,credit_cents').eq('customer_id',uid).maybeSingle())||{points:0,credit_cents:0};}
async function normalize(db,user,body,catalog){
 if(body.checkout_version!==config.version||!UUID.test(body.method_id||'')||!integer(body.points??0)||!integer(body.credit_cents??0))fail(400,'Review the current checkout options.');
 let record;
 // The catalog/address validator is shared with historical orders; this facade never writes a request.
 await base.requestInvoice({rpc:async(name,args)=>{record=args.p_data;return{data:{}};}},user,{...body,terms_version:terms.version},catalog);
 if(record.kind==='goods')record.request.research_use_confirmed=true;
 if(body.bulk_order===true){if(record.kind!=='goods')fail(400,'Bulk orders require products.');record.request.bulk_order=true;}
 else if(body.bulk_order!==undefined&&body.bulk_order!==false)fail(400,'Invalid order type.');
 if(body.research_builder!==undefined&&body.research_builder!==false)fail(409,'Research Builder is unavailable.');
 record.request.checkout={version:config.version,method_id:body.method_id,points:body.points||0,credit_cents:body.credit_cents||0,coupon:normalizeCoupon(body.coupon),delivery:delivery.selection(body.delivery),
  sms_opt_in:body.sms_opt_in===true,billing_same:body.billing_same!==false};
 if(record.kind==='goods'&&typeof body.phone==='string'){
  const phone=body.phone.trim();if(phone.length>30||phone.length<7||!/^[0-9+(). -]+$/.test(phone))fail(400,'Enter a valid order contact telephone number.');
  record.request.phone=phone;
 }
 delete record.digest;record.digest=digest(record);return record;
}
function price(record,method,membership,balance,referral=null,deliveryOptions=delivery.defaults){
 if(record.kind!=='goods'||record.request.research_builder===true||record.request.subscription===true)fail(409,'Memberships, subscriptions and Research Builder purchases are unavailable.');
 if(!config.shipping_countries.includes(record.request.address.country))fail(400,'Shipping is unavailable for the selected destination.');
 if(!options.allowedFor(method,'goods'))fail(409,'This payment method does not support this purchase.');
 const pricing=base.priceLines(record.request.items,'member');
 applyPromotions(pricing,'goods',record.request.checkout.coupon);
 paymentPolicy.applyDiscount(pricing,method);
 if(referral)pricing.referral={partner_id:referral.customer_id,code:referral.code,first_order:referral.first_order};
 const points=record.request.checkout.points,credit=record.request.checkout.credit_cents;
 if(!integer(points)||!integer(credit))fail(400,'Invalid account redemption.');
 const interac=paymentPolicy.kind(method)==='interac';
 if(interac&&record.request.address.country!=='CA')fail(409,'Interac invoices are available for Canadian delivery addresses only.');
 if(interac&&(points!==0||credit!==0))fail(409,'USD points and store credit cannot be applied to a reviewed CAD Interac invoice. Your balances remain unchanged.');
 if(points&&(points<config.minimum_points_redemption||points>Math.max(0,balance.points)))fail(409,'Use at least 100 points, up to your available points balance.');
 if(credit>balance.credit_cents)fail(409,'The requested store credit exceeds your available balance.');
 let merchandise=pricing.subtotal_cents-pricing.discount_cents;
 let deliveryQuote=delivery.price(record.request.checkout.delivery,merchandise>=config.free_shipping_threshold_cents,deliveryOptions,record.request.address.country);
 // A method-specific incentive requires a remaining crypto payment. An explicit
 // coupon remains valid for balance-funded orders; the automatic crypto saving does not.
 if(pricing.crypto_discount_eligible&&points+credit>=merchandise+deliveryQuote.total_cents){
  applyPromotions(pricing,'goods',record.request.checkout.coupon);
  paymentPolicy.applyDiscount(pricing,method,{suppressForBalance:true});
  merchandise=pricing.subtotal_cents-pricing.discount_cents;
  deliveryQuote=delivery.price(record.request.checkout.delivery,merchandise>=config.free_shipping_threshold_cents,deliveryOptions,record.request.address.country);
 }
 const shipping=deliveryQuote.total_cents;pricing.delivery=deliveryQuote;
 if(points>merchandise||points+credit>merchandise+shipping)fail(400,'Redeemed value cannot exceed the order amount. Points apply to merchandise only.');
 const total=merchandise+shipping-points-credit;
 if(method.native_provider==='peptidepay'&&total>0&&total<100)fail(400,'PeptidePay requires at least US$1 remaining to pay. Reduce the redeemed value.');
 pricing.checkout_version=config.version;pricing.billing_period=null;pricing.conversion_version=conversion.config.version;pricing.redeemed_points=points;pricing.credit_cents=credit;pricing.shipping_note=config.shipping_note;
 return {pricing,subtotal_cents:pricing.subtotal_cents,discount_cents:pricing.discount_cents,shipping_cents:shipping,tax_cents:0,total_cents:total,
  points_redeemed:points,credit_redeemed_cents:credit,earned_points:0,
  membership_invoice_id:null,method_version:method.version,currency:'USD',method_id:method.id,
  ...(interac?{request_only:true,payment_currency:'CAD'}:{})};
}
async function handle(req,res,params,deps={}){
 const env=deps.env||process.env;res.setHeader('Cache-Control','no-store');res.setHeader('Vary','Authorization');res.setHeader('X-Content-Type-Options','nosniff');
 try{
  if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');fail(405,'Method not allowed.');}
  const db=deps.db||require('./inventory-db').inventoryDb();
  if(params.get('checkout')==='public'&&req.method==='GET'){const available=await methods(db,env);return res.status(200).json({config,terms:storefrontTerms(),delivery_options:await delivery.load(db),shipping_zones:delivery.zones,capabilities:capabilities(available,env),nmi:nmiPublicConfig(available,env),methods:publicMethods(available),payment_options:paymentPolicy.choices(available)});}
  if(req.method==='POST'){
   if(!isAllowedOrigin(req.headers.origin,env.SITE_URL))fail(403,'Origin not allowed.');
   if(String(req.headers['content-type']||'').split(';')[0]!=='application/json')fail(415,'JSON required.');
  }
  if(params.get('checkout')==='cart'&&req.method==='POST')return await cartPreview(req,res,db,env,deps);
  if(params.get('checkout')==='admin'){
   await assertAdmin(req,{...deps,env,db});
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
   const [available,b,events]=await Promise.all([methods(db,env),balances(db,user.id),db.from('commerce_balance_events').select('id,invoice_id,asset,delta,reason,created_at').eq('customer_id',user.id).order('created_at',{ascending:false}).limit(100)]);
   return res.status(200).json({config,terms:storefrontTerms(),delivery_options:await delivery.load(db),shipping_zones:delivery.zones,capabilities:capabilities(available,env),nmi:nmiPublicConfig(available,env),methods:publicMethods(available),payment_options:paymentPolicy.choices(available),membership:null,balances:b,events:checked(events)||[]});
  }
  const body=parseBody(req.body);
  if(body.action==='cancel'){
   if(!UUID.test(body.id||'')||body.no_payment_sent!==true)fail(400,'Confirm that this order is unpaid before canceling.');
   const invoice=checked(await db.from('commerce_invoices').select('id,status,currency,total_cents').eq('id',body.id).eq('customer_id',user.id).maybeSingle());
   if(!invoice)fail(404,'Order not found.');
   if(invoice.status==='void')return res.status(200).json({id:body.id,status:'void',already_canceled:true});
   const done=await require('./commerce-cancellation').cancelCheckout(db,invoice,{customerId:user.id,env,fetchImpl:deps.fetchImpl||fetch});
   try{await require('./invoice-notifications').dispatch(db,{invoiceId:body.id,env,limit:2,fetchImpl:deps.fetchImpl});}catch{}
   return res.status(200).json(done);
  }
  if(!['quote','place'].includes(body.action))fail(400,'Unknown checkout action.');
  await (deps.rateLimit||enforceRateLimit)(db,'direct-checkout:'+user.id,env.CHECKOUT_RATE_LIMIT_SECRET);
  const catalog=deps.catalog||JSON.parse(fs.readFileSync(path.join(process.cwd(),'lib/catalog.json'),'utf8'));
  const record=await normalize(db,user,body,catalog);
  let existing=null;
  if(body.action==='place'){
   existing=checked(await db.from('commerce_invoices').select('id,status,request_digest,checkout_version').eq('id',record.id).eq('customer_id',user.id).maybeSingle());
   if(existing?.checkout_version){if(existing.request_digest!==record.digest||existing.checkout_version!==config.version)fail(409,'This checkout reference is already in use.');return res.status(200).json({id:existing.id,status:existing.status,replayed:true});}
  }
  const m=(await methods(db,env,record.request.address.country)).find(m=>m.id===body.method_id);if(!m)fail(409,'This payment method is currently unavailable.');
  const interac=paymentPolicy.kind(m)==='interac';
  if(interac){
   // This records a non-payable estimate. Staff must issue a reviewed CAD invoice,
   // and the customer must accept that final amount before instructions are shown.
   record.request.preferred_payment={method_id:m.id,provider_key:'interac',label:m.label,currency:'CAD'};
   record.request.checkout.payment_kind='interac';record.request.checkout.request_only=true;record.request.checkout.payment_method_version=m.version;
  }
  if(existing&&!interac)fail(409,'This checkout reference is already in use.');
  const balance=await balances(db,user.id);
  const referral=await partners.referral(db,user.id,partners.readCookie(req.headers.cookie,env.CHECKOUT_RATE_LIMIT_SECRET),user.email);
  const result=price(record,m,null,balance,referral,await delivery.load(db));
  if(interac){
   record.request.checkout.usd_estimate={currency:'USD',subtotal_cents:result.subtotal_cents,discount_cents:result.discount_cents,
    coupon_discount_cents:result.pricing.coupon_discount_cents,shipping_cents:result.shipping_cents,tax_cents:result.tax_cents,total_cents:result.total_cents,delivery:result.pricing.delivery};
   delete record.digest;record.digest=digest(record);
  }
  if(existing){if(existing.request_digest!==record.digest)fail(409,'This checkout reference is already in use.');return res.status(200).json({id:existing.id,status:existing.status,replayed:true,request_only:true});}
  const quote=digest({...result,record_digest:record.digest});
  if(body.action==='quote')return res.status(200).json({...result,quote,config});
  if(body.quote!==quote)fail(409,'The total or account balance changed. Review the updated checkout.');
  if(interac){
   const current=(await methods(db,env,record.request.address.country)).find(method=>method.id===m.id);
   if(!current||paymentPolicy.kind(current)!=='interac'||current.version!==m.version||current.label!==m.label)fail(409,'The Interac receiving method changed. Review the updated checkout.');
   const out=checked(await db.rpc('commerce_request_invoice',{p_data:record}));
   if(out.status!=='requested')fail(409,'This invoice request changed. Review it in your account before continuing.');
   return res.status(out.created===false?200:201).json({...out,request_only:true});
  }
  const out=checked(await db.rpc('commerce_place_checkout',{p_data:{...record,...result,checkout_version:config.version}}));
  try{await require('./invoice-notifications').dispatch(db,{invoiceId:out.id,env,limit:2,fetchImpl:deps.fetchImpl});}catch{}
  return res.status(201).json(out);
 }catch(e){const status=[400,401,403,404,405,409,413,415,429].includes(e.status)?e.status:503;return res.status(status).json({error:status===503?'Checkout could not be confirmed. Keep your order reference and check your orders before retrying.':e.message});}
}
async function cartPreview(req,res,db,env,deps){
 const body=parseBody(req.body),catalog=deps.catalog||JSON.parse(fs.readFileSync(path.join(process.cwd(),'lib/catalog.json'),'utf8'));
 const lines=base.itemsFromCatalog(body.items,catalog),available=await methods(db,env,body.country||'US');
 // A public cart preview never grants a payment-specific discount. Only an explicit,
 // authenticated selection of an eligible configured route can change its price.
 const quoteOnly={id:null,kind:'hosted_link',currency:'USD',sale_scope:'goods',label:'Order estimate',native_provider:null};
 let user=null;
 if(req.headers.authorization){const token=/^Bearer ([A-Za-z0-9._~-]{20,8192})$/.exec(req.headers.authorization);if(!token)fail(401,'Sign in again.');const a=await db.auth.getUser(token[1]);if(a.error||!a.data?.user?.email_confirmed_at)fail(401,'Sign in again.');user=a.data.user;}
 const method=user&&body.method_id?available.find(m=>m.id===body.method_id):quoteOnly;
 if(!method)fail(409,'This payment method is unavailable for the selected destination.');
 if(body.research_builder===true||body.subscription===true||body.kind&&body.kind!=='goods'||body.plan||body.billing_period)fail(409,'Memberships, subscriptions and Research Builder purchases are unavailable.');
 const coupon=normalizeCoupon(body.coupon);
 if(body.bulk_order!==undefined&&typeof body.bulk_order!=='boolean')fail(400,'Invalid order type.');
 const record={kind:'goods',request:{items:lines,bulk_order:body.bulk_order===true,address:{country:body.country||'US'},checkout:{coupon,points:0,credit_cents:0,delivery:delivery.selection(body.delivery)}}};
 const deliveryOptions=await delivery.load(db),q=price(record,method,null,{points:0,credit_cents:0},null,deliveryOptions);
 return res.status(200).json({...q,method_label:method.id?paymentPolicy.publicMethod(method).label:method.label,free_shipping_threshold_cents:config.free_shipping_threshold_cents,free_shipping_remaining_cents:Math.max(0,config.free_shipping_threshold_cents-(q.subtotal_cents-q.discount_cents)),shipping_note:q.pricing.shipping_note,estimate:true,sign_in_for_benefits:false,wallets:capabilities(available,env),membership_savings_cents:0,delivery_options:deliveryOptions});
}
module.exports={handle,price,normalize,usable,cartPreview,capabilities,nmiPublicConfig,methods,publicMethods};
