'use strict';
// Rampex transport and validation. No retries on payment-link creation.
const { createHash } = require('node:crypto');
const protocol = require('./rampex-protocol');
const API = 'https://api.rampex.io';
const RAILS = ['hosted','stripe','rampnetwork','robinhood','topper','unlimit','bitnovo','simpleswap','mercuryo','revolut','transak','cryptix','guardarian','moonpay','banxa','alchemypay','sardine','particle','wert','simplex','utorg','transfi'];
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const LINK = /^[A-Za-z0-9_-]{1,160}$/;
const TX = /^0x[a-fA-F0-9]{64}$/;
const error = (status,message) => Object.assign(Error(message),{status});
function configuration(env=process.env) {
 const missing=[];
 if(typeof env.RAMPEX_API_KEY!=='string'||!env.RAMPEX_API_KEY.trim()||/[\s\x00-\x1f]/.test(env.RAMPEX_API_KEY))missing.push('RAMPEX_API_KEY');
 if(typeof env.RAMPEX_WEBHOOK_SECRET!=='string'||env.RAMPEX_WEBHOOK_SECRET.length<16)missing.push('RAMPEX_WEBHOOK_SECRET');
 const mode=env.RAMPEX_MODE||'live';
 if(mode!=='live')missing.push('RAMPEX_MODE=live (provider has no sandbox)');
 const enabled=env.RAMPEX_ENABLED==='true'&&mode==='live';
 return{provider:'rampex',mode,enabled,ready:enabled&&!missing.length,missing,currencies:['USD'],
  account_tag:env.RAMPEX_API_KEY?createHash('sha256').update('rampex:live:'+env.RAMPEX_API_KEY).digest('hex'):null,
  three_ds:false,wallets:{apple:false,google:false}};
}
function assertRail(value){if(!RAILS.includes(value))throw error(400,'Select a supported Rampex provider or Multi Hosted Providers.');return value;}
async function request(path,method,body,env,fetchImpl=fetch,publicRead=false){
 let response,data;
 try{
  response=await fetchImpl(API+path,{method,redirect:'error',headers:{Accept:'application/json',...(!publicRead?{'X-API-Key':env.RAMPEX_API_KEY}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(method==='POST'?18000:5000)});
  const length=response.headers?.get?.('content-length');if(length&&Number(length)>65536)throw Error('response limit');
  let text='';
  if(response.body?.getReader){const reader=response.body.getReader(),parts=[];let size=0;try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>65536){await reader.cancel();throw Error('response limit');}parts.push(Buffer.from(part.value));}text=Buffer.concat(parts).toString('utf8');}finally{reader.releaseLock();}}
  else{text=await response.text();if(Buffer.byteLength(text)>65536)throw Error('response limit');}
  data=JSON.parse(text);
 }catch{throw error(502,'Rampex response is unavailable. Do not repeat a payment.');}
 if(!response.ok||data?.success!==true||!data.data||typeof data.data!=='object'||Array.isArray(data.data))throw error(502,'Rampex confirmation is unavailable. Do not repeat a payment.');
 return data.data;
}
async function providerStatus(rail,amount,fetchImpl=fetch){
 assertRail(rail);
 const data=await request('/provider-status','GET',null,{},fetchImpl,true);
 const all=Array.isArray(data.providers)?data.providers:[];
 if(rail==='hosted'){
  if(!Number.isSafeInteger(amount)||amount<1||amount>5000000)throw error(400,'Invalid hosted payment amount.');
  const eligible=all.filter(p=>{
   if(!p||p.status!=='active'||p.minimum_currency!=='USD'||typeof p.id!=='string'||! /^[a-z0-9_-]{1,60}$/.test(p.id)||p.id==='hosted')return false;
   try{return protocol.toCents(p.minimum_amount)<=amount;}catch{return false;}
  });
  if(!eligible.length)throw error(503,'No hosted provider is currently available for this USD amount.');
  return{id:'hosted',status:'active',minimum_currency:'USD',minimum_amount:Math.min(...eligible.map(p=>protocol.toCents(p.minimum_amount)))/100,eligible_providers:eligible.map(p=>p.id)};
 }
 const rows=all.filter(p=>p?.id===rail);
 if(rows.length!==1||rows[0].status!=='active'||rows[0].minimum_currency!=='USD')throw error(503,'This card-to-crypto provider is not currently available in USD.');
 let minimum;try{minimum=protocol.toCents(rows[0].minimum_amount);}catch{throw error(503,'Provider limits could not be verified.');}
 if(!Number.isSafeInteger(amount)||amount<minimum)throw error(400,'This provider requires at least US$'+(minimum/100).toFixed(2)+' remaining to pay.');
 return rows[0];
}
function checkoutUrl(value,rail){
 if(typeof value!=='string'||value.length>2000||/[\s\x00-\x1f\\]/.test(value))throw error(502,'Invalid Rampex checkout destination.');
 let u;try{u=new URL(value);}catch{throw error(502,'Invalid Rampex checkout destination.');}
 if(u.origin!=='https://checkout.rampex.io'||u.username||u.password||u.hash||u.pathname==='/')throw error(502,'Invalid Rampex checkout destination.');
 const providers=u.searchParams.getAll('provider');
 if(providers.length>1||(providers.length===1&&providers[0]!==rail))throw error(502,'Rampex returned a different payment provider.');
 return u.href;
}
function createBody(attempt,email){
 assertRail(attempt.rampex_provider);
 if(!UUID.test(attempt.id||'')||!UUID.test(attempt.invoice_id||'')||!Number.isSafeInteger(attempt.amount_cents)||attempt.amount_cents<1||attempt.amount_cents>5000000||attempt.currency!=='USD')throw error(400,'Invalid server-calculated Rampex payment.');
 if(typeof email!=='string'||email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw error(400,'Verified customer email required.');
 return{amount:attempt.amount_cents/100,currency:'USD',customer_email:email,provider:attempt.rampex_provider,
  description:'AltaPure Labs research-use goods invoice '+attempt.invoice_id,
  woo_order_id:attempt.id,woo_store_url:'https://altapurelabs.com',payment_url:'https://altapurelabs.com/pay.html?invoice='+attempt.invoice_id};
}
async function create(attempt,email,env,fetchImpl){
 const data=await request('/api-create-payment-link','POST',createBody(attempt,email),env,fetchImpl);
 let amount;try{amount=protocol.toCents(data.amount);}catch{throw error(502,'Rampex payment amount could not be verified.');}
 if(!LINK.test(data.link_id||'')||data.status!=='active'||data.currency!=='USD'||amount!==attempt.amount_cents||data.customer_email!==email||data.test===true||data.livemode===false||data.mode==='test'||(data.provider!==undefined&&data.provider!==attempt.rampex_provider))throw error(502,'Rampex link does not match this invoice. Do not create another payment.');
 return{id:data.link_id,url:checkoutUrl(data.redirect_url,attempt.rampex_provider)};
}
async function retrieve(attempt,env,fetchImpl){
 if(!LINK.test(attempt.rampex_link_id||''))throw error(409,'Rampex link has not been recorded. Do not start another payment.');
 return request('/api-get-payment-status?link_id='+encodeURIComponent(attempt.rampex_link_id),'GET',null,env,fetchImpl);
}
function confirmation(data,attempt,event){
 if(!attempt||attempt.provider!=='rampex'||attempt.mode!=='live'||!UUID.test(attempt.id||'')||!LINK.test(attempt.rampex_link_id||''))throw error(409,'Stored Rampex payment is invalid.');
 assertRail(attempt.rampex_provider);
 if(!data||data.test===true||data.livemode===false||data.mode==='test')throw error(409,'Test results cannot confirm a customer payment.');
 if(data.link_id!==attempt.rampex_link_id||data.currency!==attempt.currency||protocol.toCents(data.amount)!==attempt.amount_cents)throw error(409,'Rampex amount, currency or order does not match.');
 if(data.status!=='completed')return{confirmed:false,status:['active','expired'].includes(data.status)?data.status:'unknown'};
 if(protocol.toCents(data.received_amount)!==attempt.amount_cents||!TX.test(data.transaction_hash||'')||!Number.isFinite(Date.parse(data.paid_at||'')))throw error(409,'Rampex payment needs manual reconciliation.');
 if(data.provider!==undefined){
  if(typeof data.provider!=='string'||! /^[a-z0-9_-]{1,60}$/.test(data.provider))throw error(409,'Invalid Rampex provider reference.');
  if(attempt.rampex_provider!=='hosted'&&data.provider!==attempt.rampex_provider)throw error(409,'Rampex provider mismatch.');
 }
 if(event?.provider!==undefined){
  if(typeof event.provider!=='string'||! /^[a-z0-9_-]{1,60}$/.test(event.provider))throw error(409,'Invalid callback provider reference.');
  if(attempt.rampex_provider!=='hosted'&&event.provider!==attempt.rampex_provider)throw error(409,'Rampex callback provider mismatch.');
  if(data.provider&&data.provider!=='hosted'&&event.provider!=='hosted'&&data.provider!==event.provider)throw error(409,'Rampex payment and callback providers disagree.');
 }
 if(typeof data.payout_amount!=='number'||!Number.isFinite(data.payout_amount)||data.payout_amount<=0||data.payout_currency!=='USDC')throw error(409,'Expected USDC payout is not confirmed by Rampex.');
 if(event){
  const completion=protocol.validateCompletion(event,{provider:'rampex',mode:'live',link_id:attempt.rampex_link_id,amount_cents:attempt.amount_cents,currency:attempt.currency,order_id:attempt.id});
  if(!completion.eligible)throw error(409,'Non-completion event cannot confirm payment.');
  if(event.payout_currency!=='USDC'||event.payout_network!=='polygon'||!TX.test(event.txid_out||''))throw error(409,'Expected Polygon USDC payout is not confirmed by the callback.');
 }
 // transaction_hash is a provider-confirmed reference; no claim that it is the outbound wallet transaction.
 return{confirmed:true,transaction:data.transaction_hash.toLowerCase(),amount:attempt.amount_cents,received:attempt.amount_cents,currency:attempt.currency};
}
module.exports={configuration,assertRail,RAILS,providerStatus,checkoutUrl,createBody,create,retrieve,confirmation};
