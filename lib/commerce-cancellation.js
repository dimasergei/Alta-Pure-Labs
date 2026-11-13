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
module.exports={verifyUnpaid};
