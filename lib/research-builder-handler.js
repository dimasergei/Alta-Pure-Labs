'use strict';
// A monthly AUTO-STACK plan is paid by a new, explicit invoice for each period.
const fs=require('node:fs'),path=require('node:path');
const price=require('./research-builder-pricing'),security=require('./checkout-security');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const loadCatalog=deps=>deps.catalog||JSON.parse(fs.readFileSync(path.join(process.cwd(),'lib/catalog.json'),'utf8'));
async function customer(req,db){
 const match=/^Bearer ([A-Za-z0-9._~-]{20,8192})$/.exec(req.headers.authorization||'');
 if(!match)return null;
 const result=await db.auth.getUser(match[1]);
 return !result.error&&result.data?.user?.email_confirmed_at?result.data.user:null;
}
module.exports=async(req,res,deps={})=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Vary','Authorization');
 try{
  if(req.method==='GET'&&req.query?.scope!=='mine'&&req.query?.scope!=='admin'){
   return res.status(200).json({catalog:price.catalog(loadCatalog(deps)),terms:price.terms,
     subscription_available:true,one_time_available:true,billing_mode:'invoice_per_cycle',
     reason:'A new invoice is paid for each monthly set.'});
  }
  if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');return res.status(405).json({error:'Method not allowed.'});}
  const db=deps.db||(req.method==='POST'&&!req.headers.authorization?null:require('./inventory-db').inventoryDb());
  if(req.method==='GET'&&req.query?.scope==='admin'){
   if(!(await require('./admin-auth').requireAdmin(req,res)))return;
   const result=await db.from('pure_stack_plans').select('id,customer_email,status,selections,monthly_cents,paid_cycles,next_invoice_due_at,canceled_at,created_at')
      .order('created_at',{ascending:false}).limit(100);
   if(result.error)throw result.error;
   return res.status(200).json({subscriptions:result.data||[]});
  }
  if(req.method==='GET'){
   const user=await customer(req,db);
   if(!user)return res.status(401).json({error:'Sign in with a verified email.'});
   const current=await db.from('pure_stack_plans').select('id,status,selections,monthly_cents,paid_cycles,next_invoice_due_at,canceled_at,created_at,pure_stack_cycles(cycle_number,invoice_id,amount_cents,status,paid_at)')
     .eq('customer_id',user.id).order('created_at',{ascending:false}).limit(30);
   if(current.error)throw current.error;
   const plans=(current.data||[]).map(item=>({...item,lines:item.selections,next_billing_at:item.next_invoice_due_at,
     currency:'USD',research_subscription_cycles:item.pure_stack_cycles,
     actions:item.status==='active'?['save','renew','cancel']:[]}));
   return res.status(200).json({subscriptions:plans,subscription_available:true,one_time_available:true,
     billing_mode:'invoice_per_cycle',reason:'Pay a new invoice for each additional month.'});
  }
  const env=deps.env||process.env;
  if(!security.isAllowedOrigin(req.headers.origin,env.SITE_URL))return res.status(403).json({error:'Origin not allowed.'});
  if(String(req.headers['content-type']||'').split(';')[0]!=='application/json')return res.status(415).json({error:'JSON required.'});
  const body=security.parseBody(req.body);
  if(body.action==='quote'){
   let membership=null;
   if(req.headers.authorization){
    const user=await customer(req,db);
    if(!user)return res.status(401).json({error:'Sign in again to verify your membership.'});
    membership=await require('./membership-benefits').active(db,user.id);
   }
   return res.status(200).json(price.quote(body.items,loadCatalog(deps),{mode:body.mode,membership,coupon:body.coupon||''}));
  }
  if(!['save','cancel'].includes(body.action))return res.status(400).json({error:'Unknown AUTO-STACK™ action.'});
  const user=await customer(req,db);
  if(!user)return res.status(401).json({error:'Sign in to manage your AUTO-STACK™ plan.'});
  if(!UUID.test(body.id||''))return res.status(400).json({error:'Choose a valid plan.'});
  if(deps.rateLimit)await deps.rateLimit(db,'stack-manage:'+user.id,env.CHECKOUT_RATE_LIMIT_SECRET);
  else await security.enforceRateLimit(db,'stack-manage:'+user.id,env.CHECKOUT_RATE_LIMIT_SECRET);
  const current=await db.from('pure_stack_plans').select('id,status').eq('id',body.id).eq('customer_id',user.id).maybeSingle();
  if(current.error)throw current.error;
  if(current.data?.status!=='active')return res.status(409).json({error:'This AUTO-STACK™ plan cannot be changed.'});
  let patch;
  if(body.action==='save'){
   const quote=price.quote(body.items,loadCatalog(deps),{mode:'subscription'});
   patch={selections:quote.lines.map(({id,name,size,qty,unit_price_usd_cents})=>({id,name,size,qty,unit_price_usd_cents})),
    monthly_cents:quote.total_cents,updated_at:new Date().toISOString()};
  }else{
   patch={status:'canceled',canceled_at:new Date().toISOString(),updated_at:new Date().toISOString()};
  }
  const result=await db.from('pure_stack_plans').update(patch).eq('id',body.id).eq('customer_id',user.id).eq('status','active')
    .select('id,status,selections,monthly_cents,canceled_at').maybeSingle();
  if(result.error)throw result.error;
  if(!result.data)return res.status(409).json({error:'This plan changed. Reload your account.'});
  return res.status(200).json({plan:result.data});
 }catch(error){
  const status=[400,401,403,409,413,415,429].includes(error.status)?error.status:503;
  return res.status(status).json({error:status===503?'AUTO-STACK™ account records are temporarily unavailable.':error.message});
 }
};
