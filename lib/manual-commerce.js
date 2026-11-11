'use strict';
const fs=require('node:fs'),path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const {parseBody,configuredOrigin,enforceRateLimit}=require('./checkout-security');
const {passwordMatches}=require('./admin-operations');
const terms=require('../config/launch-commercial-terms.json');
const deliveryTax=require('./invoice-delivery-tax');
const {applyBankDiscount}=require('./bank-transfer-discount');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const safeColumns='checkout_version,points_redeemed,credit_redeemed_cents,earned_points,id,kind,plan,status,version,currency,pricing,subtotal_cents,discount_cents,shipping_cents,tax_cents,total_cents,expires_at,accepted_at,paid_at,tracking_carrier,tracking_number,created_at,terms_version';
const err=(status,message)=>Object.assign(Error(message),{status});
function text(v,min,max,label){if(typeof v!=='string'||v.trim().length<min||v.trim().length>max||/[\u0000-\u0008]/.test(v))throw err(400,'Check '+label+'.');return v.trim();}
function integer(v,min,max,label){if(!Number.isSafeInteger(v)||v<min||v>max)throw err(400,'Check '+label+'.');return v;}
function checked(r){if(r.error){const c=r.error.code;if(c==='23505')throw err(409,'Duplicate request or transaction reference. Reload and reconcile the existing record.');if(c==='40001')throw err(409,'This record changed. Reload before saving.');if(c==='P0002'||c==='PGRST116')throw err(404,'Record not found.');if(['22023','P0001','23514'].includes(c))throw err(409,'The requested transition was rejected. Check the invoice status, amount, currency and confirmations.');throw err(503,'Payment records are unavailable.');}return r.data;}
function itemsFromCatalog(items,catalog){if(!Array.isArray(items)||!items.length||items.length>60)throw err(400,'Choose between 1 and 60 product sizes.');const seen=new Set();return items.map(x=>{const p=catalog.find(p=>p.id===x?.id),v=p?.variants.find(v=>v.size===x?.size);if(!v)throw err(400,'Unknown product size.');const key=p.id+':'+v.size;if(seen.has(key))throw err(400,'Duplicate product size.');seen.add(key);return {id:p.id,name:p.name,size:v.size,qty:integer(x.qty,1,100,'quantity'),unit_price_usd_cents:Math.round(v.price*100)};});}
function priceLines(lines,membership='member',currency='USD',fxPpm=1000000){integer(fxPpm,100000,10000000,'exchange rate');if(currency==='USD'&&fxPpm!==1000000)throw err(400,'USD exchange rate must be one.');const memberBps=terms.memberships[membership]?.discount_bps||0;const priced=lines.map(x=>{const volumeBps=terms.volume_tiers.find(t=>x.qty>=t.quantity)?.discount_bps||0,bps=Math.max(memberBps,volumeBps),unit=Math.round(x.unit_price_usd_cents*fxPpm/1000000),gross=unit*x.qty,discount=Math.floor(gross*bps/10000);return {...x,unit_price_cents:unit,gross_cents:gross,discount_cents:discount,discount_bps:bps,discount_reason:memberBps>=volumeBps&&memberBps?membership:volumeBps?'volume':'none',line_total_cents:gross-discount};});return {lines:priced,subtotal_cents:priced.reduce((n,x)=>n+x.gross_cents,0),discount_cents:priced.reduce((n,x)=>n+x.discount_cents,0),currency,fx_ppm:fxPpm,terms_version:terms.version};}
function validateMethod(body,{draft=false}={}){
 const p={id:body.id||randomUUID(),version:integer(body.version??0,0,1000000,'version'),kind:body.kind,label:text(body.label,3,80,'label'),currency:body.currency,payee:text(body.payee,2,180,'payee'),instructions:text(body.instructions,12,3000,'receiving instructions'),allowed_host:'',acceptance_reference:text(body.acceptance_reference,8,400,'business-use confirmation/reference'),active:body.active===true,business_confirmed:body.business_confirmed,catalog_accepted:body.catalog_accepted};
 if(!UUID.test(p.id)||!['bank_transfer','interac','hosted_link'].includes(p.kind)||!['USD','CAD'].includes(p.currency)||(!draft&&(p.business_confirmed!==true||p.catalog_accepted!==true)))throw err(400,'Verify the business receiving route and permitted product use.');
 if(draft&&(p.active||!['bank_transfer','interac'].includes(p.kind)))throw err(400,'Drafts must be inactive bank or Interac receiving methods.');
 if(/PRIVATE KEY|seed phrase|sk_live_|sk_test_|xprv|password\s*[:=]/i.test(p.instructions))throw err(400,'Enter public receiving instructions only, never passwords, private keys or API secrets.');
 if(p.kind==='interac'&&(p.currency!=='CAD'||!/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(p.instructions)))throw err(400,'Interac needs CAD and your registered business receiving email.');
 if(p.kind==='hosted_link'){const h=text(body.allowed_host,4,253,'approved hosted-payment hostname').toLowerCase();if(!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(h)||h==='localhost')throw err(400,'Enter an exact public hostname, not a URL or wildcard.');p.allowed_host=h;}
 return p;
}
function hostedUrl(value,method){if(method.kind!=='hosted_link')return null;let u;try{u=new URL(value);}catch{throw err(400,'Paste the provider-created payment link for this exact invoice.');}if(u.protocol!=='https:'||u.hostname!==method.allowed_host||u.username||u.password||u.port||u.hash)throw err(400,'The payment link must use the approved exact hostname.');return u.href;}
async function userFrom(req,db){const m=/^Bearer ([A-Za-z0-9._~-]{20,8192})$/.exec(req.headers.authorization||'');if(!m)throw err(401,'Sign in to request or view an invoice.');const r=await db.auth.getUser(m[1]);if(r.error||!r.data?.user?.email_confirmed_at||!r.data.user.email)throw err(401,'Sign in again with a verified email.');return r.data.user;}
async function memberFor(db,userId){const rows=checked(await db.from('commerce_memberships').select('invoice_id,plan,starts_at,expires_at').eq('customer_id',userId).is('revoked_at',null).gt('expires_at',new Date().toISOString()).order('expires_at',{ascending:false}).limit(10))||[];return rows.sort((a,b)=>terms.memberships[b.plan].discount_bps-terms.memberships[a.plan].discount_bps)[0]||null;}
async function requestInvoice(db,user,body,catalog){
 if(!UUID.test(body.id||'')||!['goods','membership'].includes(body.kind)||body.consent!==true||body.terms_version!==terms.version)throw err(400,'Review and accept the current invoice terms.');
 const name=text(body.name||user.user_metadata?.full_name||'',1,120,'name');const request={name,organization:text(body.organization||'',0,180,'organization'),note:text(body.note||'',0,1000,'note')};
 let plan=null;
 if(body.kind==='goods'){
  request.items=itemsFromCatalog(body.items,catalog);const a=body.address||{};request.address={line1:text(a.line1,3,180,'street'),line2:text(a.line2||'',0,180,'address line 2'),city:text(a.city,2,80,'city'),region:text(a.region,1,80,'province/state'),postal_code:text(a.postal_code,2,20,'postal code'),country:text(a.country,2,2,'two-letter country').toUpperCase()};
  if(!/^[A-Z]{2}$/.test(request.address.country)||body.research_use!==true)throw err(400,'Confirm laboratory research use and enter a valid country code.');
 }else{plan=body.plan;if(!['vip','elite'].includes(plan))throw err(400,'Choose VIP or Elite.');request.items=[{id:'membership-'+plan,name:terms.memberships[plan].name,size:'365-day nonrenewing pass',qty:1,unit_price_usd_cents:terms.memberships[plan].price_cents}];}
 const record={id:body.id,customer_id:user.id,customer_email:user.email.toLowerCase().trim(),customer_name:name,kind:body.kind,plan,request,consent:true,terms_version:terms.version};record.digest=createHash('sha256').update(JSON.stringify(record)).digest('hex');
 return checked(await db.rpc('commerce_request_invoice',{p_data:record}));
}
async function issueInvoice(db,body){
 const isPreview=body.action==='preview';
 const r=checked(await db.from('commerce_invoices').select('*').eq('id',body.id).single());
 const method=checked(await db.from('commerce_payment_methods').select('*').eq('id',body.method_id).single());if(!method.active)throw err(409,'Enable a verified business receiving route first.');
 if(r.status!=='requested'||r.version!==body.version)throw err(409,'Invoice changed. Reload it before issuing.');
 if(r.kind==='membership'&&!['bank_transfer','interac','hosted_link'].includes(method.kind))throw err(409,'Method does not support prepaid membership.');
 const fx=integer(body.fx_ppm??1000000,100000,10000000,'fixed exchange rate'),member=await memberFor(db,r.customer_id);
 const pricing=priceLines(r.request_data.items,r.kind==='goods'?(member?.plan||'member'):'member',method.currency,fx);
 if(r.kind==='membership')pricing.discount_cents=0;
 applyBankDiscount(pricing,method,r.kind);
 const shipping=integer(body.shipping_cents,0,10000000,'shipping amount');
 pricing.delivery_tax=deliveryTax.review(r,pricing,body);
 const tax=pricing.delivery_tax.tax_cents;
 if(r.kind==='membership'&&shipping!==0)throw err(400,'Membership has no shipping charge.');
 const review=text(body.review_note,12,2000,'shipping/tax and fulfillment review');
 if(body.fulfillment_confirmed!==true)throw err(400,'Confirm you can fulfill these exact items and destination, and reviewed the final tax/shipping amounts.');
 const now=Date.now();let expires=now+terms.invoice_expiry_hours*3600000;if(r.kind==='goods'&&member)expires=Math.min(expires,Date.parse(member.expires_at));
 if(pricing.delivery_tax.delivery)expires=Math.min(expires,Date.parse(pricing.delivery_tax.delivery.quote_expires_at));
 const payload={id:r.id,version:integer(body.version,1,1000000,'version'),method_id:method.id,...pricing,pricing,shipping_cents:shipping,tax_cents:tax,review_note:review,fulfillment_confirmed:true,payment_url:isPreview?null:hostedUrl(body.payment_url,method),expires_at:new Date(expires).toISOString()};
 payload.total_cents=integer(pricing.subtotal_cents-pricing.discount_cents+shipping+tax,1,100000000,'invoice total');
 if(!isPreview&&body.expected_total_cents!==payload.total_cents)throw err(409,'The final total changed. Preview the invoice again.');
 if(!isPreview&&method.kind==='hosted_link'&&body.provider_amount_confirmed!==true)throw err(400,'Confirm the provider-created invoice matches the exact final amount and currency.');
 return payload;
}
async function handle(req,res,params,deps={}){
 const env=deps.env||process.env;res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Vary','Authorization');
 try{
  const mode=params.get('commerce'),admin=mode==='admin';
  if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');return res.status(405).json({error:'Method not allowed.'});}
  if(admin){if(typeof env.ADMIN_ORDERS_PASSWORD!=='string'||env.ADMIN_ORDERS_PASSWORD.length<32)throw err(503,'Admin unavailable.');if(!passwordMatches(req.headers['x-admin-password'],env.ADMIN_ORDERS_PASSWORD))throw err(401,'Unauthorized.');}
  const db=deps.db||require('./inventory-db').inventoryDb();
  if(mode==='public'&&req.method==='GET'){const list=checked(await db.from('commerce_payment_methods').select('id,label,kind,currency').eq('active',true))||[];return res.status(200).json({invoice_requests:true,payment_methods:list,card_processor_connected:false,terms});}
  const user=admin?null:await userFrom(req,db);
  if(req.method==='GET'){
   if(admin){const view=params.get('view')||'invoices';if(view==='methods')return res.status(200).json({methods:checked(await db.from('commerce_payment_methods').select('*').order('created_at',{ascending:false}))||[],terms});
    if(view==='detail'){const id=params.get('id');if(!UUID.test(id||''))throw err(400,'Invalid invoice.');const invoice=checked(await db.from('commerce_invoices').select('*').eq('id',id).single());const events=checked(await db.from('commerce_events').select('*').eq('invoice_id',id).order('created_at',{ascending:false}).limit(100));return res.status(200).json({invoice,events});}
    return res.status(200).json({invoices:checked(await db.from('commerce_invoices').select('id,customer_name,customer_email,kind,plan,status,version,total_cents,currency,created_at').order('created_at',{ascending:false}).limit(100))||[]});
   }
   let q=db.from('commerce_invoices').select(safeColumns+',request_data,payment_snapshot,method_id').eq('customer_id',user.id);
   if(params.has('id')){if(!UUID.test(params.get('id')))throw err(400,'Invalid invoice.');q=q.eq('id',params.get('id'));}
   const list=checked(await q.order('created_at',{ascending:false}).limit(100))||[];
   const methods=checked(await db.from('commerce_payment_methods').select('id,active'))||[];
   const invoices=list.map(r=>{const usable=['issued','accepted'].includes(r.status)&&Date.parse(r.expires_at)>Date.now()&&methods.some(m=>m.id===r.method_id&&m.active);return {...r,pricing:deliveryTax.publicPricing(r.pricing),payment_snapshot:r.status==='accepted'&&usable?r.payment_snapshot:null,payable:usable,method_id:undefined};});
   return res.status(200).json({invoices,membership:await memberFor(db,user.id),terms});
  }
  if(req.headers.origin!==configuredOrigin(env.SITE_URL))throw err(403,'Origin not allowed.');
  if(String(req.headers['content-type']||'').split(';')[0].toLowerCase()!=='application/json')throw err(415,'JSON required.');const body=parseBody(req.body);
  if(admin){const actor='admin-shared-key:'+randomUUID();let action=body.action,payload=body;
   if(action==='save_method')payload=validateMethod(body);
   else{if(!UUID.test(body.id||''))throw err(400,'Invalid invoice.');integer(body.version,1,1000000,'version');
    if(action==='preview')return res.status(200).json(await issueInvoice(db,body));
    if(action==='issue')payload=await issueInvoice(db,body);
    else if(['record_payment','record_refund'].includes(action)){if(!UUID.test(body.receipt_id||''))throw err(400,'A receipt request ID is required.');integer(body.amount_cents,1,100000000,'received/refunded amount');text(body.external_reference,6,180,'bank/provider transaction reference');if(!['USD','CAD'].includes(body.currency)||body.funds_confirmed!==true)throw err(400,'Verify the actual completed payment in your bank/provider account first.');}
    else if(action==='status'){text(body.note,8,2000,'fulfillment note');if(body.tracking_carrier)text(body.tracking_carrier,2,100,'carrier');if(body.tracking_number)text(body.tracking_number,4,160,'tracking');}
    else throw err(400,'Unknown action.');
   }
   return res.status(200).json(checked(await db.rpc('commerce_admin_command',{p_action:action,p_data:payload,p_actor:actor})));
  }
  if(body.action==='request'){
   await (deps.rateLimit||enforceRateLimit)(db,'manual-invoice:'+user.id,env.CHECKOUT_RATE_LIMIT_SECRET);
   const catalog=deps.catalog||JSON.parse(fs.readFileSync(path.join(process.cwd(),'lib/catalog.json'),'utf8'));
   return res.status(201).json(await requestInvoice(db,user,body,catalog));
  }
  if(body.action==='accept'){if(!UUID.test(body.id||'')||body.consent!==true)throw err(400,'Review and accept the final invoice.');return res.status(200).json(checked(await db.rpc('commerce_accept_invoice',{p_id:body.id,p_customer:user.id,p_version:integer(body.version,1,1000000,'version'),p_terms:body.terms_version})));}
  throw err(400,'Unknown customer action.');
 }catch(e){const status=[400,401,403,404,409,413,415,429,503].includes(e.status)?e.status:503;return res.status(status).json({error:status===503?'Invoice service unavailable. Contact the team; do not send money without an issued invoice.':e.message});}
}
module.exports={handle,priceLines,itemsFromCatalog,validateMethod,hostedUrl,issueInvoice,requestInvoice};
