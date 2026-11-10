'use strict';
const manifest=require('../config/operational-requirements.json');
async function count(db,table,filter){try{let q=db.from(table).select('*',{count:'exact',head:true});if(filter)q=q.eq(filter[0],filter[1]);const r=await q;if(r.error||!Number.isSafeInteger(r.count)||r.count<0)return {available:false};return {available:true,count:r.count};}catch{return {available:false};}}
async function loadReadiness(db,env=process.env){
 const keys=[['requests','enterprise_customer_requests'],['requests_new','enterprise_customer_requests',['status','new']],['request_email_failed','enterprise_customer_requests',['email_status','failed']],['request_email_review','enterprise_customer_requests',['email_status','needs_review']],['inventory_lots','enterprise_inventory_lots'],['released_lots','enterprise_inventory_lots',['status','released']],['quality_documents','enterprise_quality_documents'],['published_quality_documents','enterprise_quality_documents',['publication_approved',true]],['suppliers','suppliers'],['paid_orders','store_orders',['payment_status','paid']]];
 const values=await Promise.all(keys.map(x=>count(db,x[1],x[2]))),observations=Object.fromEntries(keys.map((x,i)=>[x[0],values[i]]));
 return {generated_at:new Date().toISOString(),checkout_enabled:false,fully_operational:false,
  scope:'Live aggregate counts and configuration presence; not proof of provider approval or end-to-end payment operation.',
  configuration:{database:!!env.SUPABASE_URL&&!!env.SUPABASE_SERVICE_ROLE_KEY,email_transport:!!env.RESEND_API_KEY&&!!env.ORDER_CONFIRMATION_FROM&&!!env.ADMIN_ORDER_EMAIL,rate_limiter:typeof env.CHECKOUT_RATE_LIMIT_SECRET==='string'&&env.CHECKOUT_RATE_LIMIT_SECRET.length>=32},
  observations,requirements:manifest.requirements.map(x=>({...x})),reviewed_at:manifest.reviewed_at};
}
module.exports={loadReadiness};
