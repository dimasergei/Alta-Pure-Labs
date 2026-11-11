'use strict';
const {parseBody,configuredOrigin}=require('./checkout-security');
const {passwordMatches}=require('./admin-operations');
const adapter=require('./lotus-supplier'),{client}=require('./lotus-client');
const checked=r=>{if(r.error)throw Error('Supplier records unavailable.');return r.data;};
async function handle(req,res,params,deps={}){
 const env=deps.env||process.env;res.setHeader('Cache-Control','no-store');
 try{
  if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'Method not allowed.'});
  if(!env.ADMIN_ORDERS_PASSWORD||env.ADMIN_ORDERS_PASSWORD.length<32||!passwordMatches(req.headers['x-admin-password'],env.ADMIN_ORDERS_PASSWORD))return res.status(401).json({error:'Unauthorized.'});
  if(req.method==='POST'&&(req.headers.origin!==configuredOrigin(env.SITE_URL)||String(req.headers['content-type']||'').split(';')[0]!=='application/json'))return res.status(403).json({error:'Request not allowed.'});
  const db=deps.db||require('./inventory-db').inventoryDb();
  if(req.method==='GET')return res.status(200).json({api:adapter.configuration(env),settings:checked(await db.from('commerce_supplier_settings').select('*').eq('id',true).single()),mappings:checked(await db.from('commerce_supplier_mappings').select('*')),jobs:checked(await db.from('commerce_supplier_jobs').select('invoice_id,reference,status,supplier_id,provider_status,settlement,owed_total,tracking_number,carrier,last_error,attempts,updated_at').order('updated_at',{ascending:false}).limit(100))});
  const b=parseBody(req.body);
  if(b.action==='catalog')return res.status(200).json(await client({env,fetchImpl:deps.fetchImpl}).products());
  if(b.action==='run')return res.status(200).json(await require('./lotus-fulfillment').run(db,{env,fetchImpl:deps.fetchImpl}));
  if(b.action==='save_mapping'){
   const catalog=require('node:fs').existsSync('lib/catalog.json')?JSON.parse(require('node:fs').readFileSync('lib/catalog.json')):[];
   const [id,size]=String(b.variant_key||'').split('|');if(!catalog.some(p=>p.id===id&&p.variants.some(v=>v.size===size)))return res.status(400).json({error:'Choose an exact AltaPure product and dosage.'});
   const data=await client({env,fetchImpl:deps.fetchImpl}).products(),product=data.products?.find(p=>p.id===b.product);
   if(!product?.packs?.some(p=>p.vials===b.vials)||b.confirmed!==true)return res.status(400).json({error:'Confirm the exact supplier product and supported vial pack.'});
   checked(await db.from('commerce_supplier_mappings').upsert({variant_key:b.variant_key,product:b.product,vials:b.vials,supplier_name:product.name,verified_at:new Date().toISOString()}));return res.status(200).json({saved:true});
  }
  return res.status(400).json({error:'Unknown action.'});
 }catch(e){return res.status(503).json({error:e.code==='api_not_configured'?'Lotus API access is not configured. Ask Lotus to enable the API-key section.':'Supplier action could not be completed. Check access, mapping and job status before retrying.'});}
}
module.exports={handle};
