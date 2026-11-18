'use strict';
const {randomUUID}=require('node:crypto');
const {cancelCheckout}=require('./commerce-cancellation');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const bad=(status,error)=>({status,error});
function manualPaymentAllowed(order,method){
 return order?.status==='accepted'&&order.total_cents>0&&!!method&&order.method_id===method.id&&
  ['bank_transfer','interac'].includes(method.kind)&&!method.native_provider&&method.currency===order.currency&&order.payment_snapshot?.kind===method.kind;
}
async function execute(db,body,{env=process.env,fetchImpl=fetch,notificationsDispatch,lotusRun}={}){
 if(!body||!['cancel_order','update_order','update_tracking','record_payment','record_verified_refund','edit_shipping'].includes(body.action))return bad(400,'Unknown order action.');
 if(!UUID.test(body.id||''))return bad(400,'Invalid order reference.');
 const row=await db.from('commerce_invoices').select('id,customer_id,status,kind,currency,total_cents,version,method_id,payment_snapshot').eq('id',body.id).maybeSingle();
 if(row.error)return bad(503,'Order lookup is unavailable.');
 const order=row.data;if(!order)return bad(404,'Order not found.');
 const notify=async(result,{payment=false}={})=>{
  // The database commit is authoritative. Delivery failures leave durable queues
  // for the signed worker and must never cause a payment to be recorded twice.
  const [mail,supplier]=await Promise.allSettled([
   Promise.resolve().then(()=>(notificationsDispatch||require('./invoice-notifications').dispatch)(db,{invoiceId:order.id,env,limit:3,fetchImpl})),
   payment&&!result.replayed&&env.LOTUS_FULFILLMENT_ENABLED==='true'
    ?Promise.resolve().then(()=>(lotusRun||require('./lotus-fulfillment').run)(db,{env,fetchImpl}))
    :Promise.resolve(null)
  ]);
  return{status:200,data:{...result,notification:mail.status==='fulfilled'&&mail.value?.accepted?'accepted':'queued',...(payment?{supplier:supplier.status==='fulfilled'?supplier.value:{status:'queued'}}:{})}};
 };
 if(body.action==='cancel_order'){
  if(body.confirm_unpaid!==true)return bad(400,'Confirm no funds were sent before canceling.');
  if(order.status==='void')return{status:200,data:{id:order.id,status:'void',already_canceled:true}};
  try{
   const result=await cancelCheckout(db,order,{customerId:order.customer_id,actor:'admin:unpaid-cancellation',env,fetchImpl});
   return notify(result);
  }catch(e){return bad([400,409,503].includes(e.status)?e.status:503,e.message||'Cancellation unavailable.');}
 }
 if(body.action==='record_payment'){
  const reference=typeof body.external_reference==='string'?body.external_reference.trim():'';
  if(body.confirm_funds_received!==true||!UUID.test(body.receipt_id||'')||!UUID.test(body.method_id||'')||
    !Number.isSafeInteger(body.expected_version)||body.expected_version<1||reference.length<8||reference.length>150||!/^[A-Za-z0-9:_./ -]+$/.test(reference))
   return bad(400,'Confirm received funds and enter the actual bank transaction reference, 8–150 characters.');
  if(body.method_id!==order.method_id)return bad(409,'Payment method changed. Refresh the order before recording funds.');
  // An exact receipt replay is checked under the database lock, even after the
  // invoice advances beyond paid. New writes require its current version.
  const method=await db.from('commerce_payment_methods').select('id,kind,label,currency,native_provider').eq('id',order.method_id).maybeSingle();
  if(method.error)return bad(503,'Payment method lookup is unavailable.');
  if(!manualPaymentAllowed({...order,status:'accepted'},method.data))return bad(409,'Only verified manual bank payments can be recorded here. Processor payments must be reconciled with their provider.');
  const result=await db.rpc('commerce_admin_record_bank_payment',{p_invoice:order.id,p_data:{method_id:body.method_id,expected_version:body.expected_version,receipt_id:body.receipt_id,external_reference:reference,confirm_funds_received:true}});
  if(result.error)return bad(409,'Payment was not recorded. Verify the received transfer, current order, and whether this bank reference was already used.');
  return notify(result.data,{payment:true});
 }
 if(!Number.isSafeInteger(body.version)||body.version<0||body.version!==order.version)
  return bad(409,'Order changed. Refresh before saving.');
 if(body.action==='edit_shipping'){
  if(order.kind!=='goods'||!['paid','processing'].includes(order.status))return bad(409,'Only a paid physical order awaiting fulfillment can change its shipping address.');
  if(typeof body.note!=='string'||body.note.trim().length<8||body.note.length>1000)return bad(400,'An audit note of at least eight characters is required.');
  const fields={line1:[3,180],line2:[0,180],city:[2,80],region:[1,80],postal_code:[2,20],country:[2,2]};
  if(!body.address||typeof body.address!=='object'||Array.isArray(body.address)||Object.keys(body.address).some(key=>!(key in fields)))return bad(400,'Enter a complete shipping address.');
  const address={};
  for(const [key,[min,max]] of Object.entries(fields)){
   const value=key==='line2'&&body.address[key]===undefined?'':body.address[key];
   if(typeof value!=='string'||value.trim().length<min||value.trim().length>max||/[\u0000-\u001f\u007f]/.test(value))return bad(400,`Invalid shipping ${key}.`);
   address[key]=value.trim();
  }
  address.country=address.country.toUpperCase();
  if(!/^[A-Z]{2}$/.test(address.country))return bad(400,'Use a two-letter country code.');
  const result=await db.rpc('commerce_admin_edit_shipping',{p_invoice:order.id,p_version:order.version,p_address:address,p_note:body.note.trim()});
  if(result.error)return bad(409,'Address update blocked. Refresh and review any fulfillment already in progress.');
  return {status:200,data:{saved:true,version:result.data?.version}};
 }
 if(body.action==='update_order'||body.action==='update_tracking'){
  if((body.action==='update_order'&&!['processing','shipped','delivered'].includes(body.status))||typeof body.note!=='string'||body.note.trim().length<8||body.note.length>1000)
   return bad(400,'Select an allowed order status and provide a reason.');
  const carrier=typeof body.tracking_carrier==='string'?body.tracking_carrier.trim():'',tracking=typeof body.tracking_number==='string'?body.tracking_number.trim():'';
  if((body.status==='shipped'||body.action==='update_tracking')&&(carrier.length<2||carrier.length>100||tracking.length<4||tracking.length>160||/[\u0000-\u001f\u007f]/.test(carrier+tracking)))
   return bad(400,'Enter the confirmed carrier and tracking number.');
  const args={action:body.action,version:order.version,status:body.status||null,note:body.note.trim(),tracking_carrier:carrier,tracking_number:tracking};
  const result=await db.rpc('commerce_admin_fulfill_order',{p_invoice:order.id,p_data:args});
  if(result.error)return bad(409,'Update blocked. Refresh the order and review its payment, tracking, and any fulfillment already in progress.');
  return notify(result.data);
 }
 if(body.action==='record_verified_refund'){
  if(body.confirm_external_refund!==true||!['paid','processing','shipped','delivered'].includes(order.status)||order.total_cents<=0)
   return bad(409,'First complete and verify the external refund with the actual payment provider.');
  const reference=String(body.external_reference||'').trim();
  if(reference.length<8||reference.length>150||!/^[A-Za-z0-9:_./ -]+$/.test(reference))
   return bad(400,'Enter a verified refund transaction reference, 8–150 characters.');
  const result=await db.rpc('commerce_admin_command',{p_action:'record_refund',p_data:{id:order.id,version:order.version,receipt_id:randomUUID(),external_reference:reference,amount_cents:order.total_cents,currency:order.currency,funds_confirmed:true},p_actor:'admin:external-refund-verified'});
  if(result.error)return bad(409,'Refund was not recorded. Reconcile the provider transaction first.');
  return notify(result.data);
 }
 return bad(400,'Unsupported order action.');
}
module.exports={execute,manualPaymentAllowed};
