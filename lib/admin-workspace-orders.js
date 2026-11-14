'use strict';
const {createHash,timingSafeEqual}=require('node:crypto');
const {clients}=require('../lib/backend');
const {unifiedAdminOrders}=require('../lib/admin-order-query');
function authorized(provided,expected){
 if(typeof provided!=='string'||typeof expected!=='string'||expected.length<32||provided.length>4096)return false;
 return timingSafeEqual(createHash('sha256').update(provided).digest(),createHash('sha256').update(expected).digest());
}
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 if(!authorized(req.headers?.['x-admin-password'],process.env.ADMIN_ORDERS_PASSWORD))return res.status(401).json({error:'Unauthorized.'});
 if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({error:'Method not allowed.'});}
 try{
  const params=new URL(req.url||'/api/customer-config','https://admin.internal').searchParams;
  return res.status(200).json(await unifiedAdminOrders(clients().db,params));
 }catch(err){
  if(err.status===400)return res.status(400).json({error:err.message});
  console.error('Unified admin order list unavailable',{name:err.name,code:err.code});
  return res.status(503).json({error:'Orders temporarily unavailable. Refresh to try again.'});
 }
};
