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
  if(req.method==='GET'&&params.get('view')==='notifications'){
   const offset=Math.min(5000,Math.max(0,Number(params.get('offset'))||0));
   const rows=checked(await db.from('commerce_notifications').select('id,invoice_id,audience,event_action,snapshot,state,attempts,last_error,created_at,updated_at').eq('audience','customer').order('created_at',{ascending:false}).range(offset,offset+24));
   return res.status(200).json({notifications:rows,offset,has_more:rows.length===25});
  }
  if(req.method==='GET'&&params.get('view')==='notifications'){
   const offset=Math.min(5000,Math.max(0,Number(params.get('offset'))||0));
   const rows=checked(await db.from('commerce_notifications').select('id,invoice_id,audience,event_action,snapshot,state,attempts,last_error,created_at,updated_at').eq('audience','customer').order('created_at',{ascending:false}).range(offset,offset+24));
   return res.status(200).json({notifications:rows,offset,has_more:rows.length===25});
  }
  if(req.method==='GET'&&params.get('view')==='orders'){
   const offset=Math.min(100000,Math.max(0,Number(params.get('offset'))||0));
   const rows=checked(await db.from('commerce_invoices').select('id,customer_name,customer_email,kind,status,version,total_cents,currency,created_at,checkout_version').order('created_at',{ascending:false}).range(offset,offset+24));
   const ids=rows.map(x=>x.id);
   const jobs=ids.length?checked(await db.from('commerce_supplier_jobs').select('invoice_id,status,provider_status,settlement,owed_total,last_error,takeover_requested,updated_at').in('invoice_id',ids)):[];
   const allocations=ids.length?checked(await db.from('commerce_fulfillment_items').select('*').in('invoice_id',ids)):[];
   return res.status(200).json({orders:rows,jobs,allocations,offset,has_more:rows.length===25});
  }
  if(req.method==='GET'&&params.get('view')==='detail'){
   const id=params.get('id');if(!/^[a-f0-9-]{36}$/i.test(id||''))return res.status(400).json({error:'Invalid order.'});
   return res.status(200).json({order:checked(await db.from('commerce_invoices').select('*').eq('id',id).single()),allocations:checked(await db.from('commerce_fulfillment_items').select('*').eq('invoice_id',id)),jobs:checked(await db.from('commerce_supplier_jobs').select('invoice_id,reference,status,supplier_id,provider_status,settlement,owed_total,tracking_number,carrier,last_error,takeover_requested,updated_at').eq('invoice_id',id))});
  }
  if(req.method==='GET')return res.status(200).json({api:adapter.configuration(env),settings:checked(await db.from('commerce_supplier_settings').select('*').eq('id',true).single()),mappings:checked(await db.from('commerce_supplier_mappings').select('*')),jobs:checked(await db.from('commerce_supplier_jobs').select('invoice_id,reference,status,supplier_id,provider_status,settlement,owed_total,tracking_number,carrier,last_error,attempts,updated_at').order('updated_at',{ascending:false}).limit(100))});
  const b=parseBody(req.body);
  if(b.action==='retry_notification'){
   if(!/^[a-f0-9-]{36}$/i.test(b.id||''))return res.status(400).json({error:'Invalid notification.'});
   const result=checked(await db.from('commerce_notifications').select('invoice_id,state').eq('id',b.id).eq('audience','customer').maybeSingle());
   if(!result||result.state!=='failed')return res.status(409).json({error:'Only failed customer notifications may be retried.'});
   return res.status(200).json(await require('./invoice-notifications').dispatch(db,{invoiceId:result.invoice_id,env,limit:1,fetchImpl:deps.fetchImpl||fetch}));
  }
  if(['cancel_order','update_order','record_verified_refund'].includes(b.action)){
   const result=await require('./unified-admin-actions').execute(db,b,{env,fetchImpl:deps.fetchImpl||fetch});
   return res.status(result.status).json(result.status===200?result.data:{error:result.error});
  }

  if(b.action==='retry_notification'){
   if(!/^[a-f0-9-]{36}$/i.test(b.id||''))return res.status(400).json({error:'Invalid notification.'});
   const notice=checked(await db.from('commerce_notifications').select('invoice_id,state').eq('id',b.id).eq('audience','customer').maybeSingle());
   if(!notice||notice.state!=='failed')return res.status(409).json({error:'Only failed customer notifications may be retried.'});
   return res.status(200).json(await require('./invoice-notifications').dispatch(db,{invoiceId:notice.invoice_id,env,limit:1,fetchImpl:deps.fetchImpl||fetch}));
  }
  if(['cancel_order','update_order','record_verified_refund'].includes(b.action)){
   const result=await require('./unified-admin-actions').execute(db,b,{env,fetchImpl:deps.fetchImpl||fetch});
   return res.status(result.status).json(result.status===200?result.data:{error:result.error});
  }
  if(b.action==='label'){
   let url;try{url=new URL(b.url);}catch{return res.status(400).json({error:'Enter a Pirate Ship HTTPS share link.'});}
   if(url.protocol!=='https:'||url.username||url.password||url.port||!(url.hostname==='pirateship.com'||url.hostname.endsWith('.pirateship.com'))||!/^([A-Za-z0-9 -]{8,160})$/.test(b.tracking||'')||!/^[a-f0-9-]{36}$/i.test(b.id||''))return res.status(400).json({error:'Check the Pirate Ship share link and tracking number.'});
   const job=checked(await db.from('commerce_supplier_jobs').select('*').eq('invoice_id',b.id).single());
   const order=checked(await db.from('commerce_invoices').select('status').eq('id',b.id).single());
   if(!job.supplier_id||job.takeover_requested||!['paid','processing'].includes(order.status)||['cancelled','shipped'].includes(job.status)||Date.parse(job.lease_until)>Date.now())return res.status(409).json({error:'Wait for an active, paid Lotus order with no cancellation or sync in progress.'});
   const remote=client({env,fetchImpl:deps.fetchImpl});let current=await remote.get(job.supplier_id);current=current.order||current;
   if(current.reference!==job.reference||current.mode!==remote.mode||current.id!==job.supplier_id||current.status!=='paid')return res.status(409).json({error:'Supplier order state changed. Refresh before attaching a label.'});
   await remote.label(job.supplier_id,{url:url.href,tracking:b.tracking.trim()});return res.status(200).json({saved:true});
  }
  if(['assign','shipment','retry','takeover'].includes(b.action)){
   if(!/^[a-f0-9-]{36}$/i.test(b.id||'')||typeof b.note!=='string'||b.note.trim().length<8)return res.status(400).json({error:'Choose an order and enter an audit note of at least eight characters.'});
   const result=await db.rpc('commerce_fulfillment_admin',{p_invoice:b.id,p_data:b});
   if(result.error)return res.status(409).json({error:'Update blocked. Refresh the order. Wait for active supplier requests, and cancel/reconcile Lotus before replacing a submitted shipment.'});
   return res.status(200).json({saved:true});
  }
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
