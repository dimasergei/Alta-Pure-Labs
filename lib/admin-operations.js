'use strict';
const {createHash,timingSafeEqual}=require('node:crypto');
const {configuredOrigin,parseBody}=require('./checkout-security');
const requests=require('./request-operations');
function passwordMatches(value,expected){return typeof value==='string'&&value.length<=4096&&timingSafeEqual(createHash('sha256').update(value).digest(),createHash('sha256').update(expected).digest());}
async function handle(req,res,params,deps={}){
 const env=deps.env||process.env;
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 const password=env.ADMIN_ORDERS_PASSWORD;
 if(typeof password!=='string'||password.length<32)return res.status(503).json({error:'Operations tools are not configured.'});
 if(!passwordMatches(req.headers?.['x-admin-password'],password))return res.status(401).json({error:'Unauthorized.'});
 if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');return res.status(405).json({error:'Method not allowed.'});}
 try{
  const db=deps.db||require('./inventory-db').inventoryDb();
  if(req.method==='GET'){
   const view=params.get('admin_operations');
   if(view==='requests')return res.status(200).json(await requests.listRequests(db,params));
   if(view==='detail')return res.status(200).json(await requests.requestDetail(db,params.get('id')));
   if(view==='readiness')return res.status(200).json(await require('./launch-readiness').loadReadiness(db,env));
   return res.status(400).json({error:'Unknown operations view.'});
  }
  if(req.headers.origin!==configuredOrigin(env.SITE_URL))return res.status(403).json({error:'Origin not allowed.'});
  if(String(req.headers['content-type']||'').split(';')[0].trim().toLowerCase()!=='application/json')return res.status(415).json({error:'JSON required.'});
  const body=parseBody(req.body);
  if(body.action==='update_request')return res.status(200).json(await requests.updateRequest(db,body));
  if(body.action==='retry_request_email')return res.status(200).json(await requests.deliverRequest(db,body.request_id,env,deps.fetchImpl||fetch));
  return res.status(400).json({error:'Unknown operations action.'});
 }catch(e){const status=[400,403,404,409,413,415,429].includes(e.status)?e.status:503;return res.status(status).json({error:status===503?'Operations data is temporarily unavailable.':e.message});}
}
module.exports={handle,passwordMatches};
