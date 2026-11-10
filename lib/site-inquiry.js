'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {configuredOrigin,parseBody,enforceRateLimit}=require('./checkout-security');
const operations=require('./request-operations');
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
 return {type:input.type,request_id:input.request_id.toLowerCase(),name,email,message,organization,country,topic,consent:true,items};
}
async function handleInquiry(req,res,deps={}){
 const env=deps.env||process.env;
 try{
  if(req.headers?.origin!==configuredOrigin(env.SITE_URL))fail(403,'Origin not allowed.');
  if(String(req.headers?.['content-type']||'').split(';')[0].trim().toLowerCase()!=='application/json')fail(415,'JSON required.');
  const raw=parseBody(req.body);if(Buffer.byteLength(JSON.stringify(raw),'utf8')>16384)fail(413,'Request too large.');
  const catalog=deps.catalog||JSON.parse(fs.readFileSync(path.join(process.cwd(),'lib/catalog.json'),'utf8'));
  const inquiry=normalizeInquiry(raw,catalog);
  if(!env.CHECKOUT_RATE_LIMIT_SECRET)fail(503,'Messaging is currently unavailable. Please email altapurelabs@protonmail.com.');
  const db=deps.db||require('./inventory-db').inventoryDb(),rateLimit=deps.rateLimit||enforceRateLimit;
  const address=String(req.headers['x-vercel-forwarded-for']||req.headers['x-real-ip']||req.socket?.remoteAddress||'unknown').split(',')[0].trim().slice(0,100);
  await rateLimit(db,'inquiry-email:'+inquiry.email,env.CHECKOUT_RATE_LIMIT_SECRET);
  await rateLimit(db,'inquiry-address:'+address,env.CHECKOUT_RATE_LIMIT_SECRET);
  const saved=await (deps.storeRequest||operations.storeRequest)(db,inquiry,env);
  let delivery={email_status:saved.email_status||'queued'};
  try{delivery=await (deps.deliverRequest||operations.deliverRequest)(db,inquiry.request_id,env,deps.fetchImpl||fetch);}catch{ /* Durable record remains in admin inbox; never discard it on mail failure. */ }
  return res.status(202).json({received:true,saved:true,reference:operations.reference(inquiry.request_id),notification:delivery.email_status});
 }catch(e){
  const status=[400,403,409,413,415,429,503].includes(e.status)?e.status:503;
  return res.status(status).json({error:status===503?'Your request could not be saved. Please retry or email altapurelabs@protonmail.com.':e.message});
 }
}
module.exports={normalizeInquiry,handleInquiry};
