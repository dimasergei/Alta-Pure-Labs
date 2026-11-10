'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {configuredOrigin,parseBody,enforceRateLimit}=require('./checkout-security');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const EMAIL=/^[^\s@\r\n]+@[^\s@\r\n]+\.[^\s@\r\n]+$/;
const TYPES=new Set(['contact','bulk','partner','updates']);
function fail(status,message){const e=new Error(message);e.status=status;throw e;}
function text(value,max,label,required=false){if(value===undefined||value===null)value='';if(typeof value!=='string')fail(400,label+' must be text.');const result=value.trim();if(result.length>max||(required&&!result)||/[\u0000]/.test(result))fail(400,'Check '+label.toLowerCase()+'.');return result;}
function normalizeInquiry(input,catalog=[]){
 if(!input||!TYPES.has(input.type)||typeof input.request_id!=='string'||!UUID.test(input.request_id))fail(400,'Invalid request.');
 if(input.consent!==true)fail(400,'Consent is required before sending.');
 if(text(input.website,300,'Website confirmation'))fail(400,'Request could not be accepted.');
 const name=text(input.name,120,'Name',true),email=text(input.email,254,'Email',true).toLowerCase(),message=text(input.message,4000,'Message',true);
 if(!EMAIL.test(email)||message.length<10||/[\r\n]/.test(name))fail(400,'Check your name, email and message.');
 const organization=text(input.organization,180,'Organization'),country=text(input.country,80,'Country'),topic=text(input.topic,80,'Topic');
 if(/[\r\n]/.test(country+topic+organization))fail(400,'Single-line fields cannot contain line breaks.');
 let items=[];
 if(input.type==='bulk'){
  if(!Array.isArray(input.items)||input.items.length<1||input.items.length>100)fail(400,'Choose product quantities first.');
  const seen=new Set();
  items=input.items.map(row=>{const p=catalog.find(p=>p.id===row?.id),v=p?.variants.find(v=>v.size===row?.size);if(!v||!Number.isSafeInteger(row.qty)||row.qty<1||row.qty>100)fail(400,'Invalid product, size or quantity.');const key=p.id+':'+v.size;if(seen.has(key))fail(400,'Duplicate product sizes.');seen.add(key);return {product_id:p.id,name:p.name,size:v.size,quantity:row.qty,unit_price_cents:Math.round(v.price*100)};});
 }
 return {type:input.type,request_id:input.request_id,name,email,message,organization,country,topic,consent:true,items};
}
async function handleInquiry(req,res,deps={}){
 const env=deps.env||process.env;
 try{
  const origin=configuredOrigin(env.SITE_URL);
  if(req.headers?.origin!==origin)fail(403,'Origin not allowed.');
  if(String(req.headers?.['content-type']||'').split(';')[0].trim().toLowerCase()!=='application/json')fail(415,'JSON required.');
  const raw=parseBody(req.body);
  if(Buffer.byteLength(JSON.stringify(raw),'utf8')>16384)fail(413,'Request too large.');
  const catalog=deps.catalog||JSON.parse(fs.readFileSync(path.join(process.cwd(),'lib/catalog.json'),'utf8'));
  const inquiry=normalizeInquiry(raw,catalog);
  if(!env.RESEND_API_KEY||!env.ORDER_CONFIRMATION_FROM||!EMAIL.test(env.ADMIN_ORDER_EMAIL||'')||!env.CHECKOUT_RATE_LIMIT_SECRET)fail(503,'Messaging is currently unavailable. Please email altapurelabs@protonmail.com.');
  const db=deps.db||require('./inventory-db').inventoryDb();
  const rateLimit=deps.rateLimit||enforceRateLimit;
  const address=String(req.headers['x-vercel-forwarded-for']||req.headers['x-real-ip']||req.socket?.remoteAddress||'unknown').split(',')[0].trim().slice(0,100);
  await rateLimit(db,'inquiry-email:'+inquiry.email,env.CHECKOUT_RATE_LIMIT_SECRET);
  await rateLimit(db,'inquiry-address:'+address,env.CHECKOUT_RATE_LIMIT_SECRET);
  const reference='REQ-'+inquiry.request_id.slice(0,8).toUpperCase();
  const lines=[`AltaPure Labs ${inquiry.type} inquiry`,`Reference: ${reference}`,`Name: ${inquiry.name}`,`Reply email: ${inquiry.email}`,`Organization: ${inquiry.organization||'Not provided'}`,`Destination country (inquiry only): ${inquiry.country||'Not provided'}`,`Topic: ${inquiry.topic||inquiry.type}`,'','Message:',inquiry.message];
  if(inquiry.items.length){lines.push('','Requested products — catalog-price estimate, not an accepted order:');for(const x of inquiry.items)lines.push(`${x.name} | ${x.size} | quantity ${x.quantity} | USD ${(x.unit_price_cents/100).toFixed(2)} per unit`);const subtotal=inquiry.items.reduce((n,x)=>n+x.unit_price_cents*x.quantity,0);lines.push(`Catalog subtotal USD ${(subtotal/100).toFixed(2)}. Shipping, taxes and negotiated terms excluded.`);}
  lines.push('','The requester consented to contact concerning this request. No purchase, paid enrollment, approved shipping route, or partner commission was created.');
  const email={from:env.ORDER_CONFIRMATION_FROM,to:[env.ADMIN_ORDER_EMAIL],reply_to:inquiry.email,subject:`AltaPure ${inquiry.type} inquiry · ${reference}`,text:lines.join('\n')};
  const fingerprint=createHash('sha256').update(JSON.stringify(inquiry)).digest('hex');
  const response=await (deps.fetchImpl||fetch)('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'altapure-inquiry/'+fingerprint},body:JSON.stringify(email),signal:AbortSignal.timeout(12000)});
  const result=await response.json().catch(()=>null);
  if(!response.ok||!result||typeof result.id!=='string')fail(502,'The email service did not accept the request. Please retry or email altapurelabs@protonmail.com.');
  return res.status(200).json({received:true,reference});
 }catch(error){
  const status=[400,403,413,415,429,502,503].includes(error.status)?error.status:503;
  return res.status(status).json({error:status===503?'Messaging is currently unavailable. Please email altapurelabs@protonmail.com.':error.message});
 }
}
module.exports={normalizeInquiry,handleInquiry};
