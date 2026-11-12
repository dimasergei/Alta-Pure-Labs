'use strict';
const rampex=require('./rampex');
const error=(status,message)=>Object.assign(Error(message),{status});
function checked(result){if(result.error)throw error(503,'Rampex payment record could not be confirmed. Do not pay again.');return result.data;}
async function start(db,invoice,account,config,body,user,env,fetchImpl,rateLimit){
 if(!config.ready)throw error(503,'Rampex collection is disabled.');
 if(body.crypto_conversion_consent!==true||invoice.kind!=='goods')throw error(400,'Confirm the card-to-crypto disclosure for this goods order.');
 rampex.assertRail(account.rampex_provider);
 // Validate availability before claiming the single persistent attempt. Never switch providers automatically.
 await rampex.providerStatus(account.rampex_provider,invoice.total_cents,fetchImpl);
 await rateLimit(db,'native-payment:'+user.id,env.CHECKOUT_RATE_LIMIT_SECRET);
 const attempt=checked(await db.rpc('commerce_begin_rampex_attempt',{p_id:body.attempt_id,p_invoice:invoice.id,p_customer:user.id,p_account_tag:config.account_tag}));
 if(!attempt.claimed)return{attempt_id:attempt.id,state:attempt.state,already_started:true,redirect_url:attempt.state==='redirected'?attempt.redirect_url:null};
 try{
  const link=await rampex.create(attempt,user.email,env,fetchImpl);
  const done=checked(await db.rpc('commerce_bind_rampex_link',{p_id:attempt.id,p_link:link.id,p_redirect:link.url,p_account_tag:config.account_tag}));
  return{...done,attempt_id:attempt.id,redirect_url:done.state==='redirected'?link.url:null};
 }catch{
  // A timeout may mean a link exists. Preserve an unknown attempt instead of issuing a second link.
  checked(await db.rpc('commerce_finish_gateway_attempt',{p_id:attempt.id,p_event:'rampex-create:'+attempt.id,p_outcome:'unknown',p_transaction:null,p_amount:null,p_currency:null,p_redirect:null,p_error:'rampex_link_result_uncertain'}));
  return{attempt_id:attempt.id,state:'unknown',redirect_url:null};
 }
}
async function settle(db,attempt,env,fetchImpl,event,deps={}){
 const config=rampex.configuration(env);
 if(config.missing.length||attempt.account_tag!==config.account_tag||attempt.mode!=='live')throw error(503,'Rampex account verification is unavailable.');
 const data=await rampex.retrieve(attempt,env,fetchImpl),result=rampex.confirmation(data,attempt,event);
 if(!result.confirmed)return{state:attempt.state,confirmed:false,provider_status:result.status};
 const done=checked(await db.rpc('commerce_finish_rampex_payment',{p_id:attempt.id,p_link:attempt.rampex_link_id,p_account_tag:config.account_tag,p_transaction:result.transaction,p_amount:result.amount,p_received:result.received,p_currency:result.currency}));
 if(done.newly_paid===true){try{await (deps.dispatch||require('./invoice-notifications').dispatch)(db,{invoiceId:attempt.invoice_id,env,limit:2});}catch{/* Existing durable notification queue handles a failed dispatch. */}}
 return done;
}
async function event(db,payload,env,fetchImpl,deps={}){
 if(payload.test===true||payload.livemode===false||payload.mode==='test')return{received:true,verified:true,test:true,live_payment_applied:false};
 if(!['payment.completed','payment.expired','payment.extra_deposit'].includes(payload.event))return{received:true,verified:true,ignored:true,live_payment_applied:false};
 const config=rampex.configuration(env);
 if(config.missing.length)throw error(503,'Rampex account verification is unavailable.');
 if(typeof payload.link_id!=='string'||!/^[A-Za-z0-9_-]{1,160}$/.test(payload.link_id))throw error(400,'Invalid Rampex link reference.');
 const attempt=checked(await db.from('commerce_gateway_attempts').select('*').eq('provider','rampex').eq('account_tag',config.account_tag).eq('rampex_link_id',payload.link_id).maybeSingle());
 if(!attempt)throw error(503,'Rampex link mapping is not recorded. Retry delivery; do not collect again.');
 if(payload.event==='payment.expired'||payload.event==='payment.extra_deposit'){
  // Never reopen an expired link or grant a second entitlement for additional deposits.
  const code=payload.event==='payment.expired'?'rampex_expired_review':'rampex_extra_deposit_review';
  checked(await db.rpc('commerce_finish_gateway_attempt',{p_id:attempt.id,p_event:code+':'+attempt.id,p_outcome:'review',p_transaction:null,p_amount:null,p_currency:null,p_redirect:null,p_error:code}));
  return{received:true,verified:true,review:true,live_payment_applied:false};
 }
 const done=await settle(db,attempt,env,fetchImpl,payload,deps);
 if(done.confirmed===false)throw error(503,'Rampex has not confirmed completed payment. Retry delivery.');
 return{received:true,verified:true,live_payment_applied:done.newly_paid===true,already_recorded:done.state==='paid'&&!done.newly_paid,review:done.state==='review'};
}
module.exports={start,settle,event};
