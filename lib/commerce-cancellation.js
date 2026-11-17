'use strict';
const rampex=require('./rampex');
const money=require('./rampex-protocol');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
async function verifyUnpaid(db,invoice,{env=process.env,fetchImpl=fetch}={}){
 if(!invoice||!UUID.test(invoice.id||'')||invoice.status!=='accepted')fail(409,'This order is not awaiting payment.');
 const attemptResult=await db.from('commerce_gateway_attempts').select('*').eq('invoice_id',invoice.id);
 if(attemptResult.error)fail(503,'Payment attempts could not be checked; no cancellation was made.');
 let liveLink=false;
 for(const a of attemptResult.data||[]){
  if(a.state==='declined')continue;
  if(a.provider==='polygon_usdc'){
   await require('./polygon-usdc').verifyUnpaid(db,invoice,env,fetchImpl);
   continue;
  }
  if(a.provider!=='rampex'||a.mode!=='live'||a.state!=='redirected'||!a.rampex_link_id)
   fail(409,'Payment is in progress or requires review. Contact support before canceling.');
  let status;
  try{status=await rampex.retrieve(a,env,fetchImpl);}
  catch{fail(503,'Unable to verify the provider payment status. Your order was not canceled.');}
  let amount;
  try{amount=money.toCents(status?.amount);}catch{fail(409,'Provider amount could not be checked.');}
  if(status?.link_id!==a.rampex_link_id||status.currency!==invoice.currency||amount!==invoice.total_cents)
   fail(409,'The provider payment record does not match this order.');
  if(status.received_amount!==undefined&&status.received_amount!==null){
   let received;try{received=money.toCents(status.received_amount);}catch{fail(409,'Provider payment receipt uncertain.');}
   if(received>0)fail(409,'A payment may have been received; cancellation needs review.');
  }
  if(!['active','expired'].includes(status.status))fail(409,'The provider did not confirm an unpaid payment state.');
  liveLink ||= status.status==='active';
 }
 return{confirmed_unpaid:true,provider_link_may_remain_live:liveLink};
}
async function cancelCheckout(db,invoice,{customerId,actor,env=process.env,fetchImpl=fetch}={}){
 if(!invoice||!UUID.test(invoice.id||'')||!UUID.test(customerId||''))fail(400,'Invalid order cancellation.');
 if(invoice.status==='void')return{id:invoice.id,status:'void',already_canceled:true};
 if(invoice.status!=='accepted')fail(409,'This order is not awaiting payment.');
 const attempts=await db.from('commerce_gateway_attempts').select('*').eq('invoice_id',invoice.id);
 if(attempts.error)fail(503,'Payment attempts could not be checked; no cancellation was made.');
 if((attempts.data||[]).some(a=>a.provider==='polygon_usdc'&&a.state!=='declined')){
  // Record the request under the invoice lock before querying the chain. An
  // unrecorded signature can still settle, so this is a hold, never unpaid proof.
  const requested=await db.rpc('commerce_request_polygon_usdc_cancellation',{p_id:invoice.id,p_customer:customerId,p_actor:actor||'customer:'+customerId});
  if(requested.error)fail(['P0001','40001'].includes(requested.error.code)?409:503,'Cancellation could not be recorded. Refresh the order and check its payment status.');
  if(requested.data?.status==='void'||requested.data?.cancellation_status==='review')return requested.data;
  try{
   const check=await require('./polygon-usdc').verifyUnpaid(db,invoice,env,fetchImpl);
   if(check.status==='void')return check;
  }catch{
   // A durable request survives RPC outages, an active authorization, and a
   // possible transfer. The existing signed worker continues reconciliation.
  }
  return requested.data;
 }
 const check=await verifyUnpaid(db,invoice,{env,fetchImpl});
 const result=await db.rpc('commerce_cancel_checkout',{p_id:invoice.id,p_customer:customerId});
 if(result.error)fail(409,'Cancellation could not be verified. Refresh the order before retrying.');
 return{...result.data,provider_link_may_remain_live:check.provider_link_may_remain_live||result.data.provider_link_may_remain_live};
}
module.exports={verifyUnpaid,cancelCheckout};
