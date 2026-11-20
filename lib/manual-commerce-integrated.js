'use strict';
const base=require('./multi-payment-commerce');
const notifications=require('./invoice-notifications');
const workerAuth=require('./invoice-worker-auth');
const {requireAdmin}=require('./admin-auth');
const {isAllowedOrigin,parseBody}=require('./checkout-security');
async function handle(req,res,params,deps={}){
 const env=deps.env||process.env,mode=params.get('commerce'),view=params.get('view');
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 if(mode==='worker'){
  if(req.method!=='POST')return res.status(405).json({error:'Use POST.'});
  const proof=workerAuth.verify(req.headers,env.COMMERCE_NOTIFICATION_JOB_SECRET);
  if(!proof)return res.status(401).json({error:'Unauthorized.'});
  try{
   const db=deps.db||require('./inventory-db').inventoryDb();
   const consumed=await db.rpc('commerce_consume_notification_job',{p_nonce:proof.nonce,p_issued_at:proof.issued_at});
   if(consumed.error)return res.status(503).json({error:'Job authorization storage unavailable.'});
   if(consumed.data!==true)return res.status(409).json({error:'Job request expired or already used.'});
   // Reconcile finalized, nonce-bound wallet transfers even when the buyer has
   // closed their browser. Settled orders can then enter both existing queues.
   // Turning off new crypto collection must not turn off past-payment checks.
   let crypto=null,cryptoFailed=false;
   if(env.POLYGON_USDC_RECIPIENT&&env.POLYGON_USDC_RPC_URL){
    try{crypto=await (deps.cryptoReconcile||require('./polygon-usdc').reconcilePending)(db,{env,fetchImpl:deps.fetchImpl,limit:4,timeBudgetMs:35000});}
    catch{cryptoFailed=true;crypto={status:'unavailable'};}
   }
   // Email transport and supplier fulfillment are independent queues. A failed or
   // slow email batch must not prevent a due, paid order from reaching Lotus.
   const supplierEnabled=env.LOTUS_FULFILLMENT_ENABLED==='true';
   const [mail,supplier]=await Promise.allSettled([
    Promise.resolve().then(()=>(deps.notificationsDispatch||notifications.dispatch)(db,{env,limit:5,fetchImpl:deps.fetchImpl})),
    supplierEnabled?Promise.resolve().then(()=>(deps.lotusRun||require('./lotus-fulfillment').run)(db,{env,fetchImpl:deps.fetchImpl})):Promise.resolve(null)
   ]);
   const delivery=mail.status==='fulfilled'?mail.value:{configured:notifications.configured(env),attempted:0,accepted:0,failed:0,held:0,notification_error:'unavailable'};
   if(crypto)delivery.crypto=crypto;
   if(supplierEnabled)delivery.supplier=supplier.status==='fulfilled'?supplier.value:{status:'unavailable'};
   return res.status(cryptoFailed||mail.status==='rejected'||supplier.status==='rejected'?503:200).json(delivery);
  }catch{return res.status(503).json({error:'Notification processing unavailable.'});}
 }
 let body=null;try{if(req.method==='POST')body=parseBody(req.body);}catch(e){return res.status(e.status||400).json({error:'Invalid request body.'});}
 if(mode==='admin'&&(view==='automation'||body?.action==='retry_notifications')){
  if(!(await requireAdmin(req,res,{...deps,env})))return;
  try{
   const db=deps.db||require('./inventory-db').inventoryDb();
   if(req.method==='GET')return res.status(200).json(await notifications.status(db,env));
   if(req.method!=='POST')return res.status(405).json({error:'Method not allowed.'});
   if(!isAllowedOrigin(req.headers.origin,env.SITE_URL))return res.status(403).json({error:'Origin not allowed.'});
   if(String(req.headers['content-type']||'').split(';')[0].trim().toLowerCase()!=='application/json')return res.status(415).json({error:'JSON required.'});
   return res.status(200).json(await notifications.dispatch(db,{env,limit:5,fetchImpl:deps.fetchImpl}));
  }catch{return res.status(503).json({error:'Notification status unavailable.'});}
 }
 if(req.method!=='POST')return base.handle(req,res,params,deps);
 let code=200,payload;
 const buffered={setHeader:(k,v)=>res.setHeader(k,v),status(n){code=n;return this;},json(v){payload=v;return v;}};
 await base.handle(req,buffered,params,deps);
 if(code>=200&&code<300&&payload?.id&&['request','accept','issue','record_payment','record_refund','status'].includes(body?.action)){
  try{const db=deps.db||require('./inventory-db').inventoryDb();const delivery=await notifications.dispatch(db,{invoiceId:payload.id,limit:3,env,fetchImpl:deps.fetchImpl});payload={...payload,notification:delivery.accepted?'accepted':delivery.configured?'queued':'not_configured'};}catch{payload={...payload,notification:'queued'};}
 }
 return res.status(code).json(payload);
}
module.exports={handle};
