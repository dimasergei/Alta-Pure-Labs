'use strict';
const storefrontTerms=require('./storefront-terms');
const {createHash,randomUUID}=require('node:crypto');
const fs=require('node:fs'),path=require('node:path');
const base=require('./manual-commerce'),config=require('../config/checkout.json'),terms=require('../config/launch-commercial-terms.json');
const {normalizeCoupon,applyPromotions}=require('./checkout-promotions');
const paymentPolicy=require('./pure-payment-policy');
const INTERAC_VERSION='checkout-interac-cad-2026-11-v2';
const membershipBenefits=require('./membership-benefits');
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
 await base.requestInvoice({rpc:async(name,args)=>{record=args.p_data;return{data:{}};}},user,{...body,terms_version:terms.version},catalog,{direct:true});
 if(record.kind==='goods')record.request.research_use_confirmed=true;
 if(body.bulk_order===true){if(record.kind!=='goods')fail(400,'Bulk orders require products.');record.request.bulk_order=true;}
 else if(body.bulk_order!==undefined&&body.bulk_order!==false)fail(400,'Invalid order type.');
 if(body.research_builder!==undefined&&body.research_builder!==false)fail(409,'Use the one-time Auto-Stack™ checkout. Automatic monthly billing is not connected.');
 record.request.checkout={version:config.version,method_id:body.method_id,points:body.points||0,credit_cents:body.credit_cents||0,coupon:normalizeCoupon(body.coupon),delivery:delivery.selection(body.delivery),
  sms_opt_in:body.sms_opt_in===true,billing_same:body.billing_same!==false};
 if(record.kind==='goods'&&typeof body.phone==='string'){
  const phone=body.phone.trim();if(phone.length>30||phone.length<7||!/^[0-9+(). -]+$/.test(phone))fail(400,'Enter a valid order contact telephone number.');
  record.request.phone=phone;
 }
 delete record.digest;record.digest=digest(record);return record;
}
function price(record,method,membership,balance,referral=null,deliveryOptions=delivery.defaults,fx=null){
 const goods=record.kind==='goods';
 if(!goods&&record.kind!=='membership'||record.request.research_builder===true||record.request.subscription===true)fail(409,'Automatic subscription payments are not connected.');
 if(!config.shipping_countries.includes(record.request.address.country))fail(400,'Checkout is unavailable for the selected country.');
 if(!options.allowedFor(method,record.kind))fail(409,'This payment method does not support this purchase.');
 if(!goods&&membership)fail(409,'Your membership is already active. You can purchase another term after it expires.');
 const interac=paymentPolicy.kind(method)==='interac';
 if(interac&&(!fx||!Number.isSafeInteger(fx.fx_ppm)||fx.fx_ppm<100000||fx.fx_ppm>10000000))fail(409,'The CAD exchange rate changed. Refresh the total before placing your order.');
 if(interac&&record.request.address.country!=='CA')fail(409,'Interac is available for Canadian addresses only.');
 const cad=amount=>Math.round(amount*fx.fx_ppm/1000000);
 const pricing=base.priceLines(record.request.items,'member',interac?'CAD':'USD',interac?fx.fx_ppm:1000000);
 const points=record.request.checkout.points,credit=record.request.checkout.credit_cents;
 if(!integer(points)||!integer(credit))fail(400,'Invalid account redemption.');
 if(!goods&&(points||credit||record.request.checkout.coupon))fail(400,'Membership fees cannot use coupons, points or store credit.');
 if(interac&&(points!==0||credit!==0))fail(409,'USD points and store credit cannot be applied to a CAD Interac payment. Your balances remain unchanged.');
 if(points&&(points<config.minimum_points_redemption||points>Math.max(0,balance.points)))fail(409,'Use at least 100 points, up to your available points balance.');
 if(credit>balance.credit_cents)fail(409,'The requested store credit exceeds your available balance.');
 let deliveryQuote=null,usdBasis=null;
 if(goods){
  membershipBenefits.apply(pricing,membership,record.request.checkout.coupon);
  paymentPolicy.applyDiscount(pricing,method);
  if(referral)pricing.referral={partner_id:referral.customer_id,code:referral.code,first_order:referral.first_order};
  if(interac){
   const usd=base.priceLines(record.request.items,'member');membershipBenefits.apply(usd,membership,record.request.checkout.coupon);
   usdBasis={currency:'USD',subtotal_cents:usd.subtotal_cents,coupon_discount_cents:usd.coupon_discount_cents,membership_discount_cents:usd.membership_discount_cents,merchandise_cents:usd.subtotal_cents-usd.discount_cents};
   pricing.usd_basis=usdBasis;
  }
  const quoteDelivery=()=>membershipBenefits.deliveryQuote(delivery.price(record.request.checkout.delivery,
   (usdBasis?.merchandise_cents??(pricing.subtotal_cents-pricing.discount_cents))>=config.free_shipping_threshold_cents,
   deliveryOptions,record.request.address.country),membership);
  deliveryQuote=quoteDelivery();
  if(pricing.crypto_discount_eligible&&points+credit>=pricing.subtotal_cents-pricing.discount_cents+deliveryQuote.total_cents){
   membershipBenefits.apply(pricing,membership,record.request.checkout.coupon);
   paymentPolicy.applyDiscount(pricing,method,{suppressForBalance:true});deliveryQuote=quoteDelivery();
  }
  if(interac){
   const extras=deliveryQuote.extras.map(item=>({...item,amount_cents:cad(item.amount_cents)}));
   const shipping=cad(deliveryQuote.shipping_cents),extrasCents=extras.reduce((sum,item)=>sum+item.amount_cents,0);
   deliveryQuote={...deliveryQuote,currency:'CAD',shipping_cents:shipping,extras,extras_cents:extrasCents,total_cents:shipping+extrasCents};
  }
  if(conversion.planFor(membership).free_bac_water_3ml)pricing.bundled_items=[{id:'gift-bac-3',name:'Complimentary BAC Water',size:'3 mL',qty:1,unit_price_cents:0,line_total_cents:0}];
 }else{
  // Memberships are individual prepaid fees; product and payment incentives never reduce them.
  pricing.lines=pricing.lines.map(line=>({...line,bogo_free_units:0,coupon_discount_cents:0,membership_discount_cents:0,crypto_discount_cents:0}));
  Object.assign(pricing,{coupon_code:'',coupon_discount_cents:0,membership_discount_cents:0,membership_discount_bps:0,membership_plan:null,
   membership_benefits:{free_shipping:false,priority_fulfillment:false,free_bac_water_3ml:false},bogo_free_units:0,crypto_discount_cents:0,
   crypto_discount_eligible:false,crypto_discount_suppressed_for_balance:false,payment_discount_version:paymentPolicy.VERSION,discount_source:'none',
   billing_mode:'prepaid',automatic_renewal:false});
 }
 if(interac){const {token,...metadata}=fx;pricing.fx=metadata;}
 const merchandise=pricing.subtotal_cents-pricing.discount_cents,shipping=deliveryQuote?.total_cents||0;
 pricing.delivery=deliveryQuote;
 if(points>merchandise||points+credit>merchandise+shipping)fail(400,'Redeemed value cannot exceed the order amount. Points apply to merchandise only.');
 const earningsBasis=goods?Math.max(0,(usdBasis?.merchandise_cents??merchandise)-points-credit):0;
 pricing.usd_earned_points_basis_cents=earningsBasis;
 pricing.checkout_version=interac?INTERAC_VERSION:config.version;pricing.billing_period=goods?null:record.request.billing_period;
 pricing.conversion_version=conversion.config.version;pricing.redeemed_points=points;pricing.credit_cents=credit;
 pricing.shipping_note=goods?(deliveryQuote.membership_shipping?'Your membership includes this US delivery service.':config.shipping_note):null;
 return {pricing,subtotal_cents:pricing.subtotal_cents,discount_cents:pricing.discount_cents,shipping_cents:shipping,tax_cents:0,total_cents:merchandise+shipping-points-credit,
  points_redeemed:points,credit_redeemed_cents:credit,earned_points:goods?conversion.earnings(earningsBasis,membership):0,
  membership_invoice_id:goods?membership?.invoice_id||null:null,method_version:method.version,currency:interac?'CAD':'USD',method_id:method.id,
  ...(interac?{payment_currency:'CAD',manual_transfer:true,fx_quote:fx.token}:{})};
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
   const [available,b,events,membership,pending]=await Promise.all([methods(db,env),balances(db,user.id),db.from('commerce_balance_events').select('id,invoice_id,asset,delta,reason,created_at').eq('customer_id',user.id).order('created_at',{ascending:false}).limit(100),membershipBenefits.active(db,user.id),membershipBenefits.pending(db,user.id)]);
   return res.status(200).json({config,terms:storefrontTerms(),delivery_options:await delivery.load(db),shipping_zones:delivery.zones,capabilities:capabilities(available,env),nmi:nmiPublicConfig(available,env),methods:publicMethods(available),payment_options:paymentPolicy.choices(available),membership:membershipBenefits.publicMembership(membership),membership_pending:pending,balances:b,events:checked(events)||[]});
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
   existing=checked(await db.from('commerce_invoices').select('id,status,request_digest,checkout_version,request_data,currency,total_cents').eq('id',record.id).eq('customer_id',user.id).maybeSingle());
   if(existing?.checkout_version===INTERAC_VERSION){
    if(existing.request_data?.checkout?.input_digest!==record.digest)fail(409,'This checkout reference is already in use.');
    return res.status(200).json({id:existing.id,status:existing.status,currency:existing.currency,total_cents:existing.total_cents,replayed:true,manual_transfer:true});
   }
   if(existing?.checkout_version){if(existing.request_digest!==record.digest||existing.checkout_version!==config.version)fail(409,'This checkout reference is already in use.');return res.status(200).json({id:existing.id,status:existing.status,replayed:true});}
  }
  const m=(await methods(db,env,record.request.address.country)).find(m=>m.id===body.method_id);if(!m)fail(409,'This payment method is currently unavailable.');
  const interac=paymentPolicy.kind(m)==='interac';
  if(interac){
   record.request.checkout.input_digest=record.digest;
   record.request.preferred_payment={method_id:m.id,provider_key:'interac',label:m.label,currency:'CAD'};
   record.request.checkout.payment_kind='interac';record.request.checkout.payment_method_version=m.version;
   delete record.digest;record.digest=digest(record);
  }
  if(existing)fail(409,'This checkout reference is already in use.');
  const [balance,membership]=await Promise.all([balances(db,user.id),membershipBenefits.active(db,user.id)]);
  const referral=record.kind==='goods'?await partners.referral(db,user.id,partners.readCookie(req.headers.cookie,env.CHECKOUT_RATE_LIMIT_SECRET),user.email):null;
  const fx=interac?await (deps.interacFx||require('./interac-fx')).resolve({token:body.fx_quote,strict:body.action==='place',env,fetchImpl:deps.fetchImpl,now:deps.now}):null;
  const result=price(record,m,membership,balance,referral,await delivery.load(db),fx);
  const quote=digest({...result,record_digest:record.digest});
  if(body.action==='quote')return res.status(200).json({...result,quote,config});
  if(body.quote!==quote)fail(409,'The total or account balance changed. Review the updated checkout.');
  if(interac){
   const current=(await methods(db,env,record.request.address.country)).find(method=>method.id===m.id);
   if(!current||paymentPolicy.kind(current)!=='interac'||current.version!==m.version||current.label!==m.label)fail(409,'The Interac receiving method changed. Review the updated checkout.');
   const out=checked(await db.rpc('commerce_place_interac_checkout',{p_data:{...record,...result,checkout_version:INTERAC_VERSION}}));
   try{await require('./invoice-notifications').dispatch(db,{invoiceId:out.id,env,limit:2,fetchImpl:deps.fetchImpl});}catch{}
   return res.status(out.replayed?200:201).json(out);
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
 let user=null,membership=null;
 if(req.headers.authorization){const token=/^Bearer ([A-Za-z0-9._~-]{20,8192})$/.exec(req.headers.authorization);if(!token)fail(401,'Sign in again.');const a=await db.auth.getUser(token[1]);if(a.error||!a.data?.user?.email_confirmed_at)fail(401,'Sign in again.');user=a.data.user;membership=await membershipBenefits.active(db,user.id);}
 const method=user&&body.method_id?available.find(m=>m.id===body.method_id):quoteOnly;
 if(!method)fail(409,'This payment method is unavailable for the selected destination.');
 if(body.research_builder===true||body.subscription===true||body.kind&&body.kind!=='goods'||body.plan||body.billing_period)fail(409,'Use the membership checkout for a paid term. Automatic monthly research billing is not connected.');
 const coupon=normalizeCoupon(body.coupon);
 if(body.bulk_order!==undefined&&typeof body.bulk_order!=='boolean')fail(400,'Invalid order type.');
 const record={kind:'goods',request:{items:lines,bulk_order:body.bulk_order===true,address:{country:body.country||'US'},checkout:{coupon,points:0,credit_cents:0,delivery:delivery.selection(body.delivery)}}};
 const fx=paymentPolicy.kind(method)==='interac'?await (deps.interacFx||require('./interac-fx')).resolve({token:body.fx_quote,strict:false,env,fetchImpl:deps.fetchImpl,now:deps.now}):null;
 const deliveryOptions=await delivery.load(db),q=price(record,method,membership,{points:0,credit_cents:0},null,deliveryOptions,fx);
 const membershipOffer=membership?null:{currency:q.currency,plans:Object.fromEntries(['vip','elite'].map(plan=>{
  const withMembership=price(record,method,{plan,invoice_id:null},{points:0,credit_cents:0},null,deliveryOptions,fx);
  return [plan,{name:conversion.config.plans[plan].name,merchandise_savings_cents:Math.max(0,withMembership.discount_cents-q.discount_cents),
   shipping_savings_cents:Math.max(0,q.shipping_cents-withMembership.shipping_cents),total_savings_cents:Math.max(0,q.total_cents-withMembership.total_cents),
   earned_points:withMembership.earned_points}];
 }))};
 const threshold=fx?Math.round(config.free_shipping_threshold_cents*fx.fx_ppm/1000000):config.free_shipping_threshold_cents;
 return res.status(200).json({...q,method_label:method.id?paymentPolicy.publicMethod(method).label:method.label,free_shipping_threshold_cents:threshold,free_shipping_remaining_cents:Math.max(0,threshold-(q.subtotal_cents-q.discount_cents)),shipping_note:q.pricing.shipping_note,estimate:true,sign_in_for_benefits:!user,wallets:capabilities(available,env),membership:membershipBenefits.publicMembership(membership),membership_offer:membershipOffer,membership_savings_cents:q.pricing.membership_discount_cents,delivery_options:deliveryOptions});
}
module.exports={handle,price,normalize,member:membershipBenefits.active,usable,cartPreview,capabilities,nmiPublicConfig,methods,publicMethods,INTERAC_VERSION};
