'use strict';
const {createHmac,timingSafeEqual,createHash}=require('node:crypto');
const error=(status,message)=>Object.assign(Error(message),{status});
const SESSION=/^cs_[A-Za-z0-9_-]{6,120}$/,ADDRESS=/^0x[a-f0-9]{40}$/i,TX=/^0x[a-f0-9]{64}$/i;
const API='https://peptide-pay.com/api/v1';
function configuration(env=process.env){
 const missing=[];
 for(const key of ['PEPTIDEPAY_API_KEY','PEPTIDEPAY_WEBHOOK_SECRET','PEPTIDEPAY_WALLET_ADDRESS'])if(!env[key])missing.push(key);
 if(env.PEPTIDEPAY_API_KEY&&!/^sk_live_[A-Za-z0-9_-]+$/.test(env.PEPTIDEPAY_API_KEY))missing.push('PEPTIDEPAY_API_KEY must be the live account key');
 if(env.PEPTIDEPAY_WALLET_ADDRESS&&!ADDRESS.test(env.PEPTIDEPAY_WALLET_ADDRESS))missing.push('valid PEPTIDEPAY_WALLET_ADDRESS');
 const currencies=(env.PEPTIDEPAY_CURRENCIES||'').split(',').filter(x=>['USD','CAD'].includes(x));
 if(!currencies.length)missing.push('PEPTIDEPAY_CURRENCIES');
 if(env.PEPTIDEPAY_VERIFIED!=='true')missing.push('PEPTIDEPAY_VERIFIED (account activation, merchant terms, test/live isolation and settlement tested)');
 const mode=env.PEPTIDEPAY_MODE||'disabled',enabled=env.PEPTIDEPAY_ENABLED==='true'&&mode==='live';
 return{provider:'peptidepay',mode,enabled,ready:enabled&&!missing.length,missing,currencies,
 account_tag:ADDRESS.test(env.PEPTIDEPAY_WALLET_ADDRESS||'')?createHash('sha256').update('peptidepay:'+mode+':'+env.PEPTIDEPAY_WALLET_ADDRESS.toLowerCase()).digest('hex'):null,
 three_ds:false,wallets:{apple:false,google:false}};
}
async function request(path,method,body,env,fetchImpl=fetch,idempotency){
 const r=await fetchImpl(API+path,{method,headers:{Authorization:'Bearer '+env.PEPTIDEPAY_API_KEY,'Content-Type':'application/json',...(idempotency?{'Idempotency-Key':idempotency}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(method==='POST'?18000:3500),redirect:'error'});
 const data=await r.json().catch(()=>null);
 if(!r.ok||!data||typeof data!=='object'||Array.isArray(data))throw error(502,'PeptidePay confirmation unavailable. Do not submit another payment.');
 return data;
}
function checkoutUrl(value,id){
 let u;try{u=new URL(value);}catch{throw error(502,'Invalid PeptidePay checkout destination.');}
 if(!SESSION.test(id||'')||u.protocol!=='https:'||!['peptide-pay.com','www.peptide-pay.com'].includes(u.hostname)||u.port||u.username||u.password||u.search||u.hash||u.pathname!=='/session/'+id)throw error(502,'Invalid PeptidePay checkout destination.');
 return u.href;
}
async function create(attempt,env,fetchImpl){
 if(!Number.isSafeInteger(attempt.amount_cents)||attempt.amount_cents<100||attempt.amount_cents>10000000)throw error(400,'Invoice amount is outside PeptidePay limits.');
 const returnUrl='https://altapurelabs.com/pay.html?invoice='+attempt.invoice_id;
 const data=await request('/checkout/init','POST',{amount_cents:attempt.amount_cents,currency:attempt.currency,success_url:returnUrl,cancel_url:returnUrl,
 webhook_url:'https://altapurelabs.com/api/checkout?native=peptidepay-webhook',product_name:'AltaPure invoice '+attempt.invoice_id,metadata:{order_id:attempt.id}},env,fetchImpl,attempt.id);
 const url=checkoutUrl(data.url,data.id);
 if(data.status!=='pending'||data.amount!==attempt.amount_cents||data.currency!==attempt.currency||!ADDRESS.test(data.tracking_number||'')||data.livemode===false||data.test===true||data.mode==='test'||data.id.startsWith('cs_test_'))throw error(502,'PeptidePay session does not match the live invoice.');
 return{id:data.id,url,address:data.tracking_number.toLowerCase()};
}
function verify(raw,header,env,now=Date.now()){
 if(!env.PEPTIDEPAY_WEBHOOK_SECRET)throw error(503,'PeptidePay webhook secret is not configured.');
 if(typeof header!=='string'||header.length>256)throw error(401,'Invalid PeptidePay signature.');
 const entries=header.split(',').map(x=>x.trim().split('='));
 if(entries.length!==2||entries.some(x=>x.length!==2)||new Set(entries.map(x=>x[0])).size!==2)throw error(401,'Invalid PeptidePay signature.');
 const sig=Object.fromEntries(entries);
 if(!/^\d{10}$/.test(sig.t||'')||!/^\w{64}$/.test(sig.v1||'')||! /^[a-f0-9]{64}$/i.test(sig.v1)||Math.abs(now/1000-Number(sig.t))>300)throw error(401,'Invalid or stale PeptidePay signature.');
 const expected=createHmac('sha256',env.PEPTIDEPAY_WEBHOOK_SECRET).update(sig.t+'.').update(raw).digest();
 if(!timingSafeEqual(expected,Buffer.from(sig.v1,'hex')))throw error(401,'Invalid PeptidePay signature.');
 let event;try{event=JSON.parse(raw.toString('utf8'));}catch{throw error(400,'Invalid PeptidePay event.');}
 if(!event||typeof event!=='object'||Array.isArray(event))throw error(400,'Invalid PeptidePay event.');
 return event;
}
function result(data,attempt,event){
 const fail=reason=>({outcome:'review',error:'peptidepay_'+reason});
 if(!attempt.provider_session_id||data.id!==attempt.provider_session_id)return fail('session_mismatch');
 if(data.livemode===false||data.test===true||data.mode==='test'||data.id.startsWith('cs_test_'))return fail('test_event');
 if(data.amount!==attempt.amount_cents||data.currency!==attempt.currency)return fail('amount_currency_mismatch');
 if(data.status==='pending')return{outcome:'unknown',error:'peptidepay_pending'};
 // Expired/failed sessions may contain late on-chain transfers; do not open a second charge automatically.
 if(data.status!=='paid'||!TX.test(data.txid||'')||!Number.isFinite(Date.parse(data.paid_at)))return fail('settlement_unconfirmed');
 if(event&&(event.event!=='order.paid'||event.status!=='paid'||event.session_id!==attempt.provider_session_id||event.order_id!==attempt.id||String(event.address_in).toLowerCase()!==attempt.settlement_address||event.amount!==attempt.amount_cents||event.currency!==attempt.currency||event.txid!==data.txid))return fail('callback_mismatch');
 return{outcome:'approved',transaction:data.txid.toLowerCase(),amount:attempt.amount_cents,currency:attempt.currency};
}
async function retrieve(attempt,env,fetchImpl){
 if(!SESSION.test(attempt.provider_session_id||''))throw error(409,'The original PeptidePay session was not recorded. Ask the provider to reconcile the original attempt; do not create another charge.');
 return request('/sessions/'+encodeURIComponent(attempt.provider_session_id),'GET',null,env,fetchImpl);
}
module.exports={configuration,create,verify,result,retrieve,checkoutUrl};
