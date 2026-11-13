'use strict';
const {randomUUID}=require('node:crypto');
const {verifyUnpaid}=require('./commerce-cancellation');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const bad=(status,error)=>({status,error});
async function execute(db,body,{env=process.env,fetchImpl=fetch}={}){
 if(!body||!['cancel_order','update_order','record_verified_refund'].includes(body.action))return bad(400,'Unknown order action.');
 if(!UUID.test(body.id||''))return bad(400,'Invalid order reference.');
 const row=await db.from('commerce_invoices').select('id,customer_id,status,kind,currency,total_cents,version').eq('id',body.id).maybeSingle();
 if(row.error)return bad(503,'Order lookup is unavailable.');
 const order=row.data;if(!order)return bad(404,'Order not found.');
 const notify=async result=>{
  try{await require('./invoice-notifications').dispatch(db,{invoiceId:order.id,env,limit:3,fetchImpl});}catch{}
  return{status:200,data:result};
 };
 if(body.action==='cancel_order'){
  if(body.confirm_unpaid!==true)return bad(400,'Confirm no funds were sent before canceling.');
  if(order.status==='void')return{status:200,data:{id:order.id,status:'void',already_canceled:true}};
  try{
   const check=await verifyUnpaid(db,order,{env,fetchImpl});
   const result=await db.rpc('commerce_cancel_checkout',{p_id:order.id,p_customer:order.customer_id});
   if(result.error)return bad(409,'Cancellation could not be verified. Refresh the order before retrying.');
   return notify({...result.data,provider_link_may_remain_live:check.provider_link_may_remain_live||result.data.provider_link_may_remain_live});
  }catch(e){return bad([400,409,503].includes(e.status)?e.status:503,e.message||'Cancellation unavailable.');}
 }
 if(!Number.isSafeInteger(body.version)||body.version<0||body.version!==order.version)
  return bad(409,'Order changed. Refresh before saving.');
 if(body.action==='update_order'){
  if(!['processing','shipped','delivered'].includes(body.status)||typeof body.note!=='string'||body.note.trim().length<8||body.note.length>1000)
   return bad(400,'Select an allowed order status and provide a reason.');
  if(body.status==='shipped'&&(!body.tracking_carrier?.trim()||!body.tracking_number?.trim()))
   return bad(400,'A carrier and tracking number are required before shipment.');
  const args={id:order.id,version:order.version,status:body.status,note:body.note.trim(),tracking_carrier:typeof body.tracking_carrier==='string'?body.tracking_carrier.trim():null,tracking_number:typeof body.tracking_number==='string'?body.tracking_number.trim():null};
  const result=await db.rpc('commerce_admin_command',{p_action:'status',p_data:args,p_actor:'admin:unified-orders'});
  if(result.error)return bad(409,'Status could not be updated. Review the current order.');
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
module.exports={execute};
