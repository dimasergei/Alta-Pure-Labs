'use strict';
const {randomUUID,createHash}=require('node:crypto');
const cfg=require('./gateway-config'),provider=require('./gateway-providers');
const peptidepay=require('./peptidepay');
const {passwordMatches}=require('./admin-operations');
const {configuredOrigin,enforceRateLimit}=require('./checkout-security');
const {error}=cfg,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function checked(r){if(r.error){const code=r.error.code;if(['P0001','40001','23505','23514'].includes(code))throw error(409,'Payment state changed or an attempt already exists. Reload and reconcile before trying again.');if(['P0002','PGRST116'].includes(code))throw error(404,'Invoice or payment not found.');throw error(503,'Payment record could not be confirmed. Do not submit another charge.');}return r.data;}
function uuid(v){if(typeof v!=='string'||!UUID.test(v))throw error(400,'Invalid invoice or attempt reference.');return v;}
async function rawBody(req){if(Buffer.isBuffer(req.body)||typeof req.body==='string'){const raw=Buffer.isBuffer(req.body)?req.body:Buffer.from(req.body);if(raw.length>65536)throw error(413,'Request too large.');return raw;}if(req.body&&typeof req.body==='object')throw error(400,'Raw gateway body required.');let size=0,parts=[];for await(const chunk of req){size+=chunk.length;if(size>65536)throw error(413,'Request too large.');parts.push(chunk);}return Buffer.concat(parts);}
function jsonBody(raw){if(raw.length>16384)throw error(413,'Request too large.');let b;try{b=JSON.parse(raw.toString('utf8'));}catch{throw error(400,'Invalid JSON.');}if(!b||typeof b!=='object'||Array.isArray(b))throw error(400,'Invalid request.');return b;}
function scalarForm(raw,contentType){if(contentType.includes('application/json'))return jsonBody(raw);if(!contentType.includes('application/x-www-form-urlencoded'))throw error(415,'Unsupported callback format.');const p=new URLSearchParams(raw.toString('utf8')),result={};for(const [k,v]of p){if(Object.hasOwn(result,k)||k.length>60||v.length>4000)throw error(400,'Ambiguous callback fields.');result[k]=v;}return result;}
async function user(req,db){const token=/^Bearer ([A-Za-z0-9._~-]{20,8192})$/.exec(req.headers?.authorization||'');if(!token)throw error(401,'Sign in to view and pay your invoice.');const r=await db.auth.getUser(token[1]);if(r.error||!r.data?.user?.email_confirmed_at||!r.data.user.email)throw error(401,'Sign in again with a verified email.');return r.data.user;}
function admin(req,env){if(typeof env.ADMIN_ORDERS_PASSWORD!=='string'||env.ADMIN_ORDERS_PASSWORD.length<32||!passwordMatches(req.headers?.['x-admin-password'],env.ADMIN_ORDERS_PASSWORD))throw error(401,'Unauthorized.');}
async function account(db,invoice){const a=checked(await db.from('commerce_gateway_accounts').select('*').eq('method_id',invoice.method_id).maybeSingle());if(!a)throw error(409,'This invoice does not use a native gateway.');const m=checked(await db.from('commerce_payment_methods').select('*').eq('id',invoice.method_id).single());return{...a,method:m};}
async function invoiceFor(db,id,uid){let q=db.from('commerce_invoices').select('*').eq('id',uuid(id));if(uid)q=q.eq('customer_id',uid);const i=checked(await q.single());if(!i)throw error(404,'Invoice not found.');return i;}
function billing(body,email,countries){const result={email};for(const [key,max]of Object.entries({first_name:50,last_name:50,address1:100,city:50,state:50,zip:20,country:2})){const v=body?.[key];if(typeof v!=='string'||!v.trim()||v.length>max||/[\r\n\u0000]/.test(v))throw error(400,'Complete your card billing address.');result[key]=v.trim();}result.country=result.country.toUpperCase();if(!countries.includes(result.country))throw error(400,'This billing country is not supported by the gateway route.');return result;}
function threeDS(body,required){if(!body){if(required)throw error(400,'Complete cardholder authentication first.');return null;}if(!['verified','attempted'].includes(body.status)||typeof body.cavv!=='string'||! /^[A-Za-z0-9+/=]{8,50}$/.test(body.cavv))throw error(400,'Invalid cardholder authentication.');const out={status:body.status,cavv:body.cavv};for(const key of ['xid','three_ds_version','directory_server_id'])if(body[key]){if(typeof body[key]!=='string'||body[key].length>50)throw error(400,'Invalid authentication details.');out[key]=body[key];}return out;}
async function finish(db,attempt,event,result,env){const data=checked(await db.rpc('commerce_finish_gateway_attempt',{p_id:attempt.id,p_event:event,p_outcome:result.outcome,p_transaction:result.transaction||null,p_amount:result.amount??null,p_currency:result.currency||null,p_redirect:result.redirect||null,p_error:result.error||null}));if(['paid','refunded'].includes(data.state)){try{await require('./invoice-notifications').dispatch(db,{invoiceId:attempt.invoice_id,env,limit:2});}catch{}}return data;}
async function startPayment(db,i,a,c,body,u,env,fetchImpl,rateLimit){
 if(!a.method.active||c.account_tag!==a.account_tag||c.mode!==a.mode||!c.currencies.includes(i.currency))throw error(409,'This gateway account or currency is unavailable.');
 if(i.status!=='accepted'||Date.parse(i.expires_at)<=Date.now())throw error(409,'Accept a current final invoice before paying.');
 if(body.confirm_amount_cents!==i.total_cents||body.confirm_currency!==i.currency)throw error(409,'Review the current final amount before paying.');
 if(body.consent!==true)throw error(400,'Confirm the one-time charge.');
 if(a.provider==='peptidepay'&&(body.crypto_conversion_consent!==true||i.total_cents<100||i.total_cents>10000000))throw error(400,'Review the card-to-crypto payment disclosure and confirm the supported invoice amount.');
 let request;
 if(a.provider==='nmi'){const bill=billing(body.billing,u.email,a.countries);request=provider.nmiSaleBody({id:uuid(body.attempt_id),invoice_id:i.id,amount_cents:i.total_cents,currency:i.currency},body.payment_token,bill,threeDS(body.cardholder_auth,c.three_ds));}
 else if(!a.countries.includes(String(body.billing?.country||'').toUpperCase()))throw error(400,'Choose a supported billing country.');
 await rateLimit(db,'native-payment:'+u.id,env.CHECKOUT_RATE_LIMIT_SECRET);
 const attempt=checked(await db.rpc('commerce_begin_gateway_attempt',{p_id:uuid(body.attempt_id),p_invoice:i.id,p_customer:u.id,p_operation:'sale',p_account_tag:c.account_tag}));
 if(!attempt.claimed)return{attempt_id:attempt.id,state:attempt.state,redirect_url:attempt.state==='redirected'?attempt.redirect_url:null,already_started:true};
 let result;
 try{
  if(a.provider==='nmi')result=provider.nmiResult(await provider.nmiRequest('/sale','POST',request,env,fetchImpl),attempt);
  else if(a.provider==='peptidepay'){
   const session=await peptidepay.create(attempt,env,fetchImpl);
   const done=checked(await db.rpc('commerce_bind_peptidepay_session',{p_id:attempt.id,p_session:session.id,p_address:session.address,p_redirect:session.url}));
   return{...done,attempt_id:attempt.id,redirect_url:done.state==='redirected'?session.url:null};
  }
  else result={outcome:'redirected',redirect:await provider.payerCreate(attempt,i,env,fetchImpl)};
 }catch{result={outcome:'unknown',error:'provider_result_uncertain'};}
 const done=await finish(db,attempt,'response:'+attempt.id,result,env);
 return{...done,attempt_id:attempt.id,redirect_url:done.state==='redirected'?result.redirect:null};
}
async function webhook(db,kind,raw,req,env,fetchImpl){
 if(kind==='peptidepay-webhook'){
  const event=peptidepay.verify(raw,req.headers['x-peptidepay-signature'],env);
  if(event.event!=='order.paid')return{received:true,verified:true,ignored:true,live_payment_applied:false};
  // Provider simulator events never grant production entitlement, even with a valid signature.
  if(event.test===true||event.livemode===false||event.mode==='test'||String(event.session_id||'').startsWith('cs_test_'))return{received:true,verified:true,test:true,live_payment_applied:false};
  if(!UUID.test(event.order_id||''))return{received:true,verified:true,unmatched:true,live_payment_applied:false};
  const attempt=checked(await db.from('commerce_gateway_attempts').select('*').eq('id',event.order_id).eq('provider','peptidepay').maybeSingle());
  if(!attempt)return{received:true,verified:true,unmatched:true,live_payment_applied:false};
  const c=cfg.configuration('peptidepay',env);
  if(c.missing.length||c.mode!=='live'||attempt.mode!=='live'||attempt.account_tag!==c.account_tag)throw error(503,'PeptidePay settlement verification is not configured.');
  if(!attempt.provider_session_id)throw error(503,'PeptidePay session recording is not confirmed yet. Retry delivery.');
  if(event.session_id!==attempt.provider_session_id)throw error(409,'PeptidePay session does not match this invoice attempt.');
  const session=await peptidepay.retrieve(attempt,env,fetchImpl),result=peptidepay.result(session,attempt,event);
  if(result.outcome==='unknown')throw error(503,'PeptidePay settlement is not confirmed yet. Retry delivery.');
  const done=await finish(db,attempt,'peptidepay-paid:'+attempt.provider_session_id,result,env);
  return{received:true,verified:true,live_payment_applied:done.state==='paid',review:done.state==='review'};
 }
 if(kind==='nmi-webhook'){
  const c=cfg.configuration('nmi',env);if(c.missing.length||!['sandbox','live'].includes(c.mode))throw error(503,'NMI callback is not configured.');
  const event=provider.verifyNmi(raw,req.headers['webhook-signature'],env),body=event.event_body;
  if(!['transaction.sale.success','transaction.sale.failure','transaction.sale.unknown','transaction.refund.success','transaction.void.success'].includes(event.event_type))return{received:true,ignored:true};
  let attempt;if(UUID.test(body.order_id||''))attempt=checked(await db.from('commerce_gateway_attempts').select('*').eq('id',body.order_id).eq('provider','nmi').maybeSingle());
  if(!attempt)return{received:true,unmatched:true};
  if(attempt.account_tag!==c.account_tag||attempt.mode!==c.mode)throw error(401,'Gateway account mismatch.');
  const tx=String(body.transaction_id||'');if(!/^[A-Za-z0-9_-]{2,100}$/.test(tx))throw error(400,'Invalid transaction reference.');
  const originalSale=attempt;
  if(event.event_type.includes('refund')||event.event_type.includes('void')){
   const ref=checked(await db.from('commerce_gateway_attempts').select('*').eq('invoice_id',attempt.invoice_id).eq('operation','refund').maybeSingle());
   if(!ref){await finish(db,attempt,'nmi-event:'+event.event_id,{outcome:'review',transaction:tx,error:'external_reversal_requires_reconciliation'},env);return{received:true,review:true};}attempt=ref;
  }
  const transaction=await provider.nmiRequest('/'+encodeURIComponent(tx),'GET',null,env,fetchImpl);
  const result=provider.nmiResult(transaction,{...attempt,provider_transaction_id:attempt.provider_transaction_id||tx},attempt.operation,originalSale);await finish(db,attempt,'nmi-event:'+event.event_id,result,env);return{received:true};
 }
 const c=cfg.configuration('payerurl',env);if(c.missing.length||c.mode!=='live')throw error(503,'Crypto callback is not configured.');
 const body=scalarForm(raw,String(req.headers['content-type']||'')),result=provider.verifyPayer(body,req.headers.authorization,env);
 const attempt=checked(await db.from('commerce_gateway_attempts').select('*').eq('id',uuid(result.attempt_id)).eq('provider','payerurl').maybeSingle());
 if(!attempt)throw error(404,'Crypto order not found.');if(attempt.account_tag!==c.account_tag||attempt.mode!==c.mode)throw error(401,'Crypto account mismatch.');
 await finish(db,attempt,'payer-event:'+result.transaction+':'+String(body.status_code),result,env);return{status:2040,message:'Notification recorded'};
}
async function handle(req,res,params,deps={}){
 const env=deps.env||process.env,kind=params.get('native'),fetchImpl=deps.fetchImpl||fetch;
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
 try{
  if(!['customer','admin','nmi-webhook','payerurl-webhook','peptidepay-webhook'].includes(kind))throw error(404,'Unknown payment endpoint.');
  if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'Method not allowed.'});
  if(kind.endsWith('webhook')){if(req.method!=='POST')return res.status(405).json({error:'Use POST.'});const raw=await rawBody(req);const db=deps.db||require('./inventory-db').inventoryDb();return res.status(200).json(await webhook(db,kind,raw,req,env,fetchImpl));}
  if(kind==='admin')admin(req,env);
  const db=deps.db||require('./inventory-db').inventoryDb(),u=kind==='customer'?await user(req,db):null;
  if(req.method==='GET'){
   if(kind==='admin')return res.status(200).json({configuration:cfg.publicStatus(env),accounts:checked(await db.from('commerce_gateway_accounts').select('method_id,provider,mode,countries').order('created_at',{ascending:false})),methods:checked(await db.from('commerce_payment_methods').select('id,label,currency,active,version,payee,sale_scope,acceptance_reference,native_provider').in('native_provider',['nmi','payerurl','peptidepay'])),attempts:checked(await db.from('commerce_gateway_attempts').select('id,invoice_id,provider,mode,operation,state,amount_cents,currency,provider_transaction_id,provider_session_id,error_code,updated_at').order('created_at',{ascending:false}).limit(50)),events:checked(await db.from('commerce_gateway_events').select('*').eq('outcome','review').order('created_at',{ascending:false}).limit(20))});
   const i=await invoiceFor(db,params.get('invoice'),u.id),a=await account(db,i),c=cfg.configuration(a.provider,env);
   const attempts=checked(await db.from('commerce_gateway_attempts').select('id,state,operation,redirect_url,error_code').eq('invoice_id',i.id).order('created_at',{ascending:false}).limit(10))||[];
   return res.status(200).json({invoice:{id:i.id,status:i.status,amount_cents:i.total_cents,currency:i.currency,expires_at:i.expires_at,kind:i.kind},gateway:{provider:a.provider,mode:a.mode,ready:c.ready&&a.method.active&&c.account_tag===a.account_tag&&c.currencies.includes(i.currency),countries:a.countries,tokenization_key:a.provider==='nmi'&&c.ready?c.tokenization_key:undefined,three_ds:c.three_ds,wallets:c.wallets},attempts:attempts.map(x=>({...x,redirect_url:x.state==='redirected'?x.redirect_url:null})),customer:{email:u.email,name:i.customer_name,address:i.request_data.address||{}}});
  }
  if(req.headers.origin!==configuredOrigin(env.SITE_URL))throw error(403,'Origin not allowed.');
  if(!String(req.headers['content-type']||'').toLowerCase().startsWith('application/json'))throw error(415,'JSON required.');
  const body=jsonBody(await rawBody(req));
  if(kind==='customer'){
   if(body.action!=='pay')throw error(400,'Unsupported customer payment action.');
   const i=await invoiceFor(db,body.invoice_id,u.id),a=await account(db,i),c=cfg.assertReady(a.provider,env);
   return res.status(200).json(await startPayment(db,i,a,c,body,u,env,fetchImpl,deps.rateLimit||enforceRateLimit));
  }
  if(body.action==='configure'){
   const c=cfg.configuration(body.provider,env);if(!c.account_tag)throw error(409,'Configure your own gateway identity and server credentials first.');
   if(body.active===true&&!c.ready)throw error(409,'The gateway is not ready for activation. Complete its missing configuration and tests.');
   if(!c.currencies.includes(body.currency)||!['goods','membership','both'].includes(body.sale_scope)||body.confirmed!==true||!Number.isInteger(body.version)||body.version<0)throw error(400,'Confirm the actual approved currency and sale scope.');
   for(const [key,min,max]of [['label',3,80],['payee',2,180],['approval_reference',8,400]])if(typeof body[key]!=='string'||body[key].length<min||body[key].length>max)throw error(400,'Complete gateway identity and approval fields.');
   if(!Array.isArray(body.countries)||!body.countries.length||body.countries.length>60||body.countries.some(x=>typeof x!=='string'||! /^[A-Z]{2}$/.test(x)))throw error(400,'Enter approved two-letter country codes.');
   const data={...body,id:uuid(body.id||randomUUID()),mode:c.mode,account_tag:c.account_tag,active:body.active===true};
   return res.status(200).json(checked(await db.rpc('commerce_configure_native_gateway',{p_data:data,p_actor:'admin-native:'+randomUUID()})));
  }
  if(body.action==='reconcile'||body.action==='refund'){
   const i=await invoiceFor(db,body.invoice_id),a=await account(db,i),c=cfg.configuration(a.provider,env);
   if(a.provider==='peptidepay'){
    if(body.action==='refund')throw error(409,'PeptidePay has no refund API. Coordinate a verified refund destination and network with the customer/provider, then record the completed refund in the payment desk. Do not automatically return funds to an on-ramp source address.');
    if(c.missing.length||c.mode!=='live'||c.account_tag!==a.account_tag)throw error(409,'PeptidePay verification configuration is unavailable.');
    const attempt=checked(await db.from('commerce_gateway_attempts').select('*').eq('id',uuid(body.attempt_id)).eq('invoice_id',i.id).eq('provider','peptidepay').single());
    if(attempt.mode!=='live'||attempt.account_tag!==c.account_tag)throw error(409,'PeptidePay account mismatch.');
    const session=await peptidepay.retrieve(attempt,env,fetchImpl),result=peptidepay.result(session,attempt);
    return res.status(200).json(await finish(db,attempt,'peptidepay-query:'+randomUUID(),result,env));
   }
   if(a.provider!=='nmi'||c.missing.length||c.account_tag!==a.account_tag)throw error(409,'NMI reconciliation credentials are not available.');
   const sale=checked(await db.from('commerce_gateway_attempts').select('*').eq('invoice_id',i.id).eq('operation','sale').eq('state','paid').maybeSingle());
   let attempt;
   if(body.action==='reconcile')attempt=checked(await db.from('commerce_gateway_attempts').select('*').eq('id',uuid(body.attempt_id)).eq('invoice_id',i.id).single());
   else{
    if(body.confirm_refund!==true||body.confirm_amount_cents!==i.total_cents)throw error(400,'Explicitly confirm the full external refund amount.');
    cfg.assertReady('nmi',env);
    if(!sale?.provider_transaction_id)throw error(409,'Original successful NMI sale is required.');
    const original=await provider.nmiRequest('/'+encodeURIComponent(sale.provider_transaction_id),'GET',null,env,fetchImpl);
    if(provider.nmiResult(original,sale).outcome!=='approved')throw error(409,'The original sale could not be verified. Reconcile it before refunding.');
    if(c.mode==='live'&&!['complete','settled'].includes(String(original.status).toLowerCase()))throw error(409,'NMI only refunds settled transactions. This payment has not settled; review cancellation/void options in the gateway.');
    attempt=checked(await db.rpc('commerce_begin_gateway_attempt',{p_id:uuid(body.attempt_id),p_invoice:i.id,p_customer:i.customer_id,p_operation:'refund',p_account_tag:c.account_tag}));
    if(!attempt.claimed)return res.status(200).json({state:attempt.state,already_started:true});
   }
   let transactionId=body.action==='refund'?sale?.provider_transaction_id:(attempt.provider_transaction_id||body.transaction_id||(attempt.operation==='refund'?sale?.provider_transaction_id:null));
   if(typeof transactionId!=='string'||! /^[A-Za-z0-9_-]{2,100}$/.test(transactionId))throw error(400,'Use the exact transaction reference from your NMI account.');
   let result;try{
    if(body.action==='refund'){
     const submitted=await provider.nmiRequest('/'+encodeURIComponent(transactionId)+'/refund','POST',{amount:Number(provider.decimal(attempt.amount_cents))},env,fetchImpl);
     const refundId=String(submitted.id||'');if(!/^[A-Za-z0-9_-]{2,100}$/.test(refundId))throw error(502,'Refund response has no transaction reference. Reconcile before retrying.');
     transactionId=refundId;
     await finish(db,attempt,'refund-submitted:'+attempt.id,{outcome:'unknown',transaction:refundId,error:'refund_query_pending'},env);
    }
    result=provider.nmiResult(await provider.nmiRequest('/'+encodeURIComponent(transactionId),'GET',null,env,fetchImpl),{...attempt,provider_transaction_id:transactionId},attempt.operation,sale);
   }catch{result={outcome:'unknown',transaction:transactionId,error:'reconciliation_uncertain'};}
   return res.status(200).json(await finish(db,attempt,'admin-query:'+randomUUID(),result,env));
  }
  throw error(400,'Unknown native gateway action.');
 }catch(e){const status=[400,401,403,404,409,413,415,429,502,503].includes(e.status)?e.status:503;return res.status(status).json({error:status===503?'Payment confirmation is unavailable. Do not repeat a charge; check the invoice or contact support.':e.message});}
}
module.exports={handle,rawBody,jsonBody,billing,threeDS,startPayment,webhook,finish};
