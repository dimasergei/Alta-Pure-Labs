'use strict';
const {randomUUID}=require('node:crypto');
const adapter=require('./lotus-supplier'),{client,cents}=require('./lotus-client');
const checked=r=>{if(r.error)throw Object.assign(Error('Supplier records unavailable.'),{code:'database_error'});return r.data;};
// A lease plus stable supplier reference protects crash/timeout recovery. Retries are queued,
// never performed inside a customer's payment request. Settlement and labels remain manual.
async function run(db,{env=process.env,fetchImpl=fetch,now=Date.now}={}){
 const settings=checked(await db.from('commerce_supplier_settings').select('*').eq('id',true).single());
 if(env.LOTUS_FULFILLMENT_ENABLED!=='true'||!settings.enabled||!settings.verified_at||settings.max_order_cents<1)return {enabled:false,processed:0};
 const api=client({env,fetchImpl});if(api.mode!=='live')return {enabled:false,processed:0,reason:'Live worker requires verified live configuration.'};
 const lease=randomUUID(),job=(checked(await db.rpc('commerce_supplier_claim',{p_lease:lease}))||[])[0];if(!job)return {enabled:true,processed:0};
 const save=data=>db.rpc('commerce_supplier_save',{p_invoice:job.invoice_id,p_lease:lease,p_data:data}).then(checked);
 try{
  if(job.mode&&job.mode!==api.mode)throw Object.assign(Error('Mode mismatch'),{code:'mode_mismatch'});
  const order=checked(await db.from('commerce_invoices').select('*').eq('id',job.invoice_id).single());
  let remote;
  if(job.supplier_id)remote=await api.get(job.supplier_id);
  else if(job.payload){try{remote=await api.find(job.reference);}catch(e){if(e.status!==404)throw e;}}
  remote=remote?.order||remote;
  if(remote&&(remote.reference!==job.reference||remote.mode!==api.mode||!remote.id))throw Object.assign(Error('Supplier response mismatch'),{code:'response_mismatch'});
  if(['refunded','void'].includes(order.status)){
   if(remote&&remote.status!=='cancelled')remote=await api.cancel(remote.id);
   await save({status:'cancelled',release:true});return{processed:1,status:'cancelled'};
  }
  if(!['paid','processing','shipped','delivered'].includes(order.status))throw Object.assign(Error('Order not paid'),{code:'order_not_paid'});
  if(!remote){
   if(!job.payload){
    const maps=checked(await db.from('commerce_supplier_mappings').select('*'));const mapping=Object.fromEntries(maps.map(m=>[m.variant_key,m]));
    const lines=adapter.linesFor(order.request_data.items,mapping),quote=await api.quote(lines);
    if(cents(quote.owed_total)>settings.max_order_cents)throw Object.assign(Error('Supplier cost limit'),{code:'cost_limit'});
    job.payload=adapter.prepareOrder(order,mapping,quote);await save({payload:job.payload,status:'working',mode:api.mode});
   }
   // A retained payload is immutable across retries; changed prices need explicit review.
   if(cents(job.payload.expected_owed)>settings.max_order_cents)throw Object.assign(Error('Supplier cost limit'),{code:'cost_limit'});
   remote=await api.create(job.payload);remote=remote.order||remote;
  }
  if(remote.reference!==job.reference||remote.mode!==api.mode||!remote.id)throw Object.assign(Error('Supplier response mismatch'),{code:'response_mismatch'});
  const shipping=adapter.shipment(remote);
  if(shipping&&!['shipped','delivered'].includes(order.status)){
   checked(await db.rpc('commerce_admin_command',{p_action:'status',p_data:{id:order.id,version:order.version,status:'shipped',tracking_carrier:shipping.carrier,tracking_number:shipping.tracking_number,note:'Lotus confirmed dispatch at '+shipping.shipped_at},p_actor:'lotus-worker'}));
  }
  await save({supplier_id:remote.id,mode:api.mode,status:remote.status==='cancelled'?'blocked':shipping?'shipped':'submitted',provider_status:remote.status,settlement:remote.settlement,owed_total:remote.owed_total,tracking_number:remote.tracking_number,carrier:remote.carrier,last_error:remote.status==='cancelled'?'supplier_cancelled':null,retry_count:0,release:true});
  return{processed:1,status:shipping?'shipped':'submitted'};
 }catch(e){const retries=(job.retry_count||0)+1,retry=e.retryable&&retries<5;await save({retry_count:retries,status:retry?'retry':'blocked',last_error:/^[a-z_]{1,60}$/.test(e.code||'')?e.code:'mapping_or_validation_error',next_attempt_at:new Date(now()+Math.min(3600000,60000*2**retries)+Math.floor(Math.random()*10000)).toISOString(),release:true});return{processed:1,status:retry?'retry':'blocked'};}
}
module.exports={run};
