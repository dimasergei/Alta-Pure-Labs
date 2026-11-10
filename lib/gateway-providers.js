'use strict';
const {createHmac,timingSafeEqual}=require('node:crypto');
const {error}=require('./gateway-config');
function cents(value){const s=String(value);if(!/^\d{1,9}(?:\.\d{1,2})?$/.test(s))throw error(400,'Invalid provider amount.');const [whole,fraction='']=s.split('.');const result=Number(whole)*100+Number(fraction.padEnd(2,'0'));if(!Number.isSafeInteger(result)||result<1||result>100000000)throw error(400,'Invalid provider amount.');return result;}
const decimal=n=>(n/100).toFixed(2);
function safeEqual(a,b){if(typeof a!=='string'||typeof b!=='string')return false;const left=Buffer.from(a),right=Buffer.from(b);return left.length===right.length&&timingSafeEqual(left,right);}
async function nmiRequest(path,method,body,env,fetchImpl=fetch){
 const host=env.NMI_MODE==='sandbox'?'https://sandbox.nmi.com':'https://secure.nmi.com';
 const r=await fetchImpl(host+'/api/v5/payments'+path,{method,headers:{Authorization:env.NMI_API_KEY,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(18000),redirect:'error'});
 const data=await r.json().catch(()=>null);if(!r.ok||!data||typeof data!=='object')throw error(502,'Gateway response uncertain; do not retry the charge.');return data;
}
function nmiSaleBody(attempt,token,billing,threeDS){
 if(typeof token!=='string'||token.length<12||token.length>1024||! /^[A-Za-z0-9_.:-]+$/.test(token)||/^\d+$/.test(token))throw error(400,'Invalid payment token.');
 const payload={amount:Number(decimal(attempt.amount_cents)),currency:attempt.currency,payment_details:{payment_token:token},industry:'ecommerce',
 order_details:{id:attempt.id,description:'AltaPure invoice '+attempt.invoice_id},billing_address:billing};
 if(threeDS)payload.cardholder_auth=threeDS;
 return payload;
}
function nmiResult(data,attempt,operation='sale',originalSale=null){
 const id=String(data.id||'');if(!/^[A-Za-z0-9_-]{2,100}$/.test(id))return {outcome:'unknown',error:'missing_transaction_id'};
 const expected=operation==='refund'?originalSale:attempt;
 if(!expected||(operation==='refund'&&!expected.provider_transaction_id))return{outcome:'review',transaction:id,error:'original_sale_required'};
 const separateRefund=operation==='refund'&&id!==expected.provider_transaction_id;
 if(operation==='sale'&&expected.provider_transaction_id&&id!==expected.provider_transaction_id)return{outcome:'review',transaction:id,error:'transaction_reference_mismatch'};
 if(operation==='refund'&&((attempt.provider_transaction_id&&id!==attempt.provider_transaction_id)||(separateRefund&&!attempt.provider_transaction_id)))return{outcome:'review',transaction:id,error:'transaction_reference_mismatch'};
 const order=data.order_details?.order_id||data.order_details?.id;
 if(order!==expected.id)return{outcome:'review',transaction:id,error:'order_reference_mismatch'};
 if(String(data.currency)!==attempt.currency)return{outcome:'review',transaction:id,error:'currency_mismatch'};
 let amount;try{const raw=String(data.amount);if(separateRefund&&!/^-[0-9]/.test(raw))throw Error('Refund must be a debit reversal');amount=cents(separateRefund?raw.slice(1):raw);}catch{return{outcome:'review',transaction:id,error:'invalid_amount'};}
 if(amount!==attempt.amount_cents)return{outcome:'review',transaction:id,error:'amount_mismatch'};
 if(operation==='sale'&&String(data.response)==='2')return{outcome:'declined',transaction:id,error:'card_declined'};
 if(operation==='sale'&&(String(data.response)!=='1'||!['pendingsettlement','complete','settled'].includes(String(data.status).toLowerCase())))return{outcome:'unknown',transaction:id,error:'unconfirmed_sale'};
 if(operation==='sale'&&amount!==attempt.amount_cents)return{outcome:'review',transaction:id,error:'amount_mismatch'};
 if(operation==='refund'){
  if(String(data.response)!=='1'||!['pendingsettlement','complete','settled'].includes(String(data.status).toLowerCase()))return{outcome:'review',transaction:id,error:'unconfirmed_refund'};
  const refunds=(data.actions||[]).filter(a=>a.type==='refund'&&(a.success===true||a.success==='1')&&String(a.response||'1')==='1');
  let refunded=0;try{refunded=refunds.reduce((n,a)=>{const raw=String(a.amount);if(separateRefund&&!/^-[0-9]/.test(raw))throw Error('Refund action sign mismatch');return n+cents(separateRefund?raw.slice(1):raw);},0);}catch{return{outcome:'review',transaction:id,error:'invalid_refund_amount'};}
  if(refunded!==attempt.amount_cents)return{outcome:'review',transaction:id,error:'full_refund_not_confirmed'};
  return{outcome:'refunded',transaction:id,amount:refunded,currency:attempt.currency};
 }
 return{outcome:'approved',transaction:id,amount,currency:attempt.currency};
}
function verifyNmi(raw,header,env){
 if(!env.NMI_WEBHOOK_KEY||typeof header!=='string'||header.length>400)throw error(401,'Invalid gateway signature.');
 const parts=header.split(',').map(x=>x.trim().split('='));if(parts.length!==2||new Set(parts.map(x=>x[0])).size!==2)throw error(401,'Invalid gateway signature.');
 const p=Object.fromEntries(parts);if(!p.t||! /^[A-Za-z0-9_-]{1,100}$/.test(p.t)||! /^[a-f0-9]{64}$/i.test(p.s||''))throw error(401,'Invalid gateway signature.');
 const expected=createHmac('sha256',env.NMI_WEBHOOK_KEY).update(p.t+'.').update(raw).digest('hex');
 if(!safeEqual(expected,p.s.toLowerCase()))throw error(401,'Invalid gateway signature.');
 let event;try{event=JSON.parse(raw.toString('utf8'));}catch{throw error(400,'Invalid event.');}
 if(String(event.event_body?.merchant?.id)!==env.NMI_MERCHANT_ID||event.event_body?.features?.is_test_mode!==(env.NMI_MODE==='sandbox'))throw error(401,'Gateway account or environment mismatch.');
 if(typeof event.event_id!=='string'||event.event_id.length>150||typeof event.event_type!=='string')throw error(400,'Invalid event identity.');return event;
}
// Protocol from PayerURL's linked official Node integration; not the incompatible O-SecretKey API.
const phpEncode=s=>encodeURIComponent(String(s)).replace(/[!'()~*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase()).replace(/%20/g,'+');
function signedQuery(input){return Object.keys(input).sort().filter(k=>input[k]!==undefined&&input[k]!==null).map(k=>{const v=input[k];if(!['string','number','boolean'].includes(typeof v))throw error(400,'Unexpected nested signature field.');return phpEncode(k)+'='+phpEncode(typeof v==='boolean'?Number(v):v);}).join('&');}
function payerAuth(fields,env){const sig=createHmac('sha256',env.PAYERURL_SECRET_KEY).update(signedQuery(fields)).digest('hex');return 'Bearer '+Buffer.from(env.PAYERURL_PUBLIC_KEY+':'+sig).toString('base64');}
async function payerCreate(attempt,customer,env,fetchImpl=fetch){
 const name=customer.customer_name.trim().split(/\s+/),origin='https://altapurelabs.com';
 const body={order_id:attempt.id,amount:attempt.amount_cents,currency:attempt.currency.toLowerCase(),billing_fname:name.shift()||'',billing_lname:name.join(' '),billing_email:customer.customer_email,
 redirect_to:origin+'/pay.html?invoice='+attempt.invoice_id, cancel_url:origin+'/pay.html?invoice='+attempt.invoice_id,notify_url:origin+'/api/checkout?native=payerurl-webhook',type:'nodejs'};
 const r=await fetchImpl('https://api-v2.payerurl.com/api/payment',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8',Authorization:payerAuth(body,env)},body:signedQuery(body),signal:AbortSignal.timeout(18000),redirect:'error'});
 const data=await r.json().catch(()=>null);let url;try{url=new URL(data?.redirectTO);}catch{throw error(502,'Crypto session creation is uncertain; do not create another payment.');}
 if(!r.ok||url.protocol!=='https:'||url.hostname!==env.PAYERURL_CHECKOUT_HOST||url.username||url.password||url.port||url.hash)throw error(502,'Provider returned an unverified checkout destination.');
 return url.href;
}
function verifyPayer(body,authorization,env){
 const token=(authorization||body.authStr||'').replace(/^Bearer\s+/i,'');if(!/^[A-Za-z0-9+/]+={0,2}$/.test(token)||token.length>1024)throw error(401,'Invalid crypto signature.');
 const decoded=Buffer.from(token,'base64').toString('utf8'),sep=decoded.indexOf(':');if(sep<0||!safeEqual(decoded.slice(0,sep),env.PAYERURL_PUBLIC_KEY||''))throw error(401,'Invalid crypto account.');
 const fields={};for(const k of ['order_id','ext_transaction_id','transaction_id','status_code','note','confirm_rcv_amnt','confirm_rcv_amnt_curr','coin_rcv_amnt','coin_rcv_amnt_curr','txn_time'])if(body[k]!==undefined)fields[k]=body[k];
 const expected=createHmac('sha256',env.PAYERURL_SECRET_KEY).update(signedQuery(fields)).digest('hex');if(!safeEqual(expected,decoded.slice(sep+1)))throw error(401,'Invalid crypto signature.');
 if(typeof body.transaction_id!=='string'||! /^[A-Za-z0-9_.:-]{2,150}$/.test(body.transaction_id))throw error(400,'Invalid crypto transaction.');
 let amount;if(Number(body.status_code)===200){amount=env.PAYERURL_CALLBACK_UNIT==='minor'?Number(body.confirm_rcv_amnt):cents(body.confirm_rcv_amnt);if(!Number.isSafeInteger(amount)||amount<1||amount>100000000)throw error(400,'Invalid confirmed crypto amount.');}
 return{attempt_id:body.order_id,transaction:body.transaction_id,outcome:Number(body.status_code)===200?'approved':Number(body.status_code)===20000?'review':'unknown',amount,currency:String(body.confirm_rcv_amnt_curr||'').toUpperCase(),error:Number(body.status_code)===200?null:'crypto_status_'+String(body.status_code).slice(0,12)};
}
module.exports={cents,decimal,nmiRequest,nmiSaleBody,nmiResult,verifyNmi,payerCreate,verifyPayer,signedQuery,payerAuth};
