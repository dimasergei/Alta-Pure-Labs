'use strict';
// Member Stack is available only to verified, currently paid PURE members.
const fs=require('node:fs'),path=require('node:path');
const pricing=require('./research-builder-pricing'),security=require('./checkout-security');
const catalog=deps=>deps.catalog||JSON.parse(fs.readFileSync(path.join(process.cwd(),'lib/catalog.json'),'utf8'));
module.exports=async(req,res,deps={})=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Vary','Authorization');
 try{
  if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');return res.status(405).json({error:'Method not allowed.'});}
  const match=/^Bearer ([A-Za-z0-9._~-]{20,8192})$/.exec(req.headers.authorization||'');
  if(!match)return res.status(401).json({error:'Sign in to access your PURE membership benefits.'});
  const db=deps.db||require('./inventory-db').inventoryDb();
  const auth=await db.auth.getUser(match[1]),user=auth.data?.user;
  if(auth.error||!user?.email_confirmed_at)return res.status(401).json({error:'Sign in with a verified account.'});
  const membership=await require('./membership-benefits').active(db,user.id);
  if(!membership)return res.status(403).json({error:'Choose PURE WHITE or PURE BLACK to unlock Member Stack.'});
  if(req.method==='GET')return res.status(200).json({
   catalog:pricing.catalog(catalog(deps)),terms:pricing.terms,
   member_plan:membership.plan,member_stack_available:true,subscription_available:false
  });
  const env=deps.env||process.env;
  if(!security.isAllowedOrigin(req.headers.origin,env.SITE_URL))return res.status(403).json({error:'Origin not allowed.'});
  if(String(req.headers['content-type']||'').split(';')[0]!=='application/json')return res.status(415).json({error:'JSON required.'});
  const body=security.parseBody(req.body);
  if(body.action!=='quote')return res.status(400).json({error:'Choose a current Member Stack checkout.'});
  if(body.mode&&body.mode!=='member_stack')return res.status(400).json({error:'Member Stack is a membership benefit, not a subscription.'});
  return res.status(200).json(pricing.quote(body.items,catalog(deps),{membership}));
 }catch(error){
  const status=[400,401,403,405,409,413,415,429].includes(error.status)?error.status:503;
  return res.status(status).json({error:status===503?'Member Stack details are temporarily unavailable.':error.message});
 }
};
