'use strict';
const fs=require('node:fs'),path=require('node:path'),{randomUUID,createHash}=require('node:crypto');
const base=require('./manual-commerce'),options=require('./payment-provider-options'),terms=require('../config/launch-commercial-terms.json');
const {passwordMatches}=require('./admin-operations'),{configuredOrigin,parseBody,enforceRateLimit}=require('./checkout-security');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const error=(s,m)=>Object.assign(Error(m),{status:s});
function checked(r){if(r.error){const c=r.error.code;if(c==='40001'||c==='P0001'||c==='23505')throw error(409,'The method or invoice changed. Reload and review the current settings.');if(c==='P0002'||c==='PGRST116')throw error(404,'Payment record not found.');if(c==='22023')throw error(400,'Invalid provider configuration or invoice link.');throw error(503,'Payment settings are temporarily unavailable.');}return r.data;}
const methodColumns='id,label,kind,currency,provider_key,display_order,sale_scope,active';
async function listMethods(db){return checked(await db.from('commerce_payment_methods').select(methodColumns).order('display_order',{ascending:true}).order('created_at',{ascending:true}))||[];}
async function verifiedUser(req,db){const t=/^Bearer ([A-Za-z0-9._~-]{20,8192})$/.exec(req.headers?.authorization||'');if(!t)throw error(401,'Sign in to request an invoice.');const r=await db.auth.getUser(t[1]);if(r.error||!r.data?.user?.email_confirmed_at||!r.data.user.email)throw error(401,'Sign in with a verified email.');return r.data.user;}
async function handle(req,res,params,deps={}){
 const mode=params.get('commerce'),view=params.get('view'),env=deps.env||process.env;
 let body;try{if(req.method==='POST')body=parseBody(req.body);}catch(e){return res.status(e.status||400).json({error:'Invalid request.'});}
 const enhanced=mode==='public'&&req.method==='GET'||mode==='customer'&&req.method==='GET'||mode==='admin'&&(view==='methods'&&req.method==='GET'||req.method==='POST'&&['save_method','save_method_draft','issue','preview','pause_method','set_method_priority'].includes(body?.action))||mode==='customer'&&req.method==='POST'&&body?.action==='request'&&!!body.preferred_method_id;
 if(!enhanced)return base.handle(req,res,params,deps);
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 try{
  if(mode==='admin'&&(typeof env.ADMIN_ORDERS_PASSWORD!=='string'||env.ADMIN_ORDERS_PASSWORD.length<32||!passwordMatches(req.headers?.['x-admin-password'],env.ADMIN_ORDERS_PASSWORD)))throw error(401,'Unauthorized.');
  const db=deps.db||require('./inventory-db').inventoryDb();
  if(req.method==='GET'){
   if(mode==='public'){const methods=await listMethods(db);return res.status(200).json({invoice_requests:true,payment_methods:options.publicMethods(methods),payment_options:options.publicOptions(methods),native_card_processor_connected:false,card_processor_connected:false,collection_mode:'reviewed_invoice_manual_reconciliation',terms});}
   if(mode==='admin')return res.status(200).json({methods:options.sorted(checked(await db.from('commerce_payment_methods').select('*').order('created_at',{ascending:false}))||[]),provider_options:options.definitions,terms});
   // The existing customer handler remains responsible for ownership; decorate only a successful response.
   let code=200,data;const buffered={setHeader:(k,v)=>res.setHeader(k,v),status(n){code=n;return this;},json(v){data=v;}};
   await base.handle(req,buffered,params,{...deps,db});
   if(code===200){const methods=await listMethods(db);data={...data,payment_methods:options.publicMethods(methods)};}
   return res.status(code).json(data);
  }
  if(req.headers.origin!==configuredOrigin(env.SITE_URL))throw error(403,'Origin not allowed.');
  if(String(req.headers['content-type']||'').split(';')[0].trim().toLowerCase()!=='application/json')throw error(415,'JSON required.');
  if(mode==='admin'){
   const actor='admin-shared-key:'+randomUUID();let payload=body;
   if(body.action==='save_method')payload=options.methodExtra(base.validateMethod(body),body);
   else if(body.action==='save_method_draft'){
    payload=options.methodExtra(base.validateMethod(body,{draft:true}),body);
    return res.status(200).json(checked(await db.rpc('commerce_save_receiving_draft',{p_data:payload,p_actor:actor})));
   }
   else if(['pause_method','set_method_priority'].includes(body.action)){
    if(!UUID.test(body.id||'')||!Number.isSafeInteger(body.version)||body.version<1)throw error(400,'A valid method and current version are required.');
    if(body.action==='set_method_priority'&&(!Number.isInteger(body.display_order)||body.display_order<0||body.display_order>999))throw error(400,'Priority must be 0–999.');
   }else{
    if(!UUID.test(body.id||'')||!UUID.test(body.method_id||''))throw error(400,'Choose a valid invoice and receiving method.');
    const m=checked(await db.from('commerce_payment_methods').select('*').eq('id',body.method_id).single());
    const invoice=checked(await db.from('commerce_invoices').select('kind').eq('id',body.id).single());
    if(!m.active||!options.allowedFor(m,invoice.kind))throw error(409,'This method is not active for this sale type.');
    payload=await base.issueInvoice(db,{...body,action:'preview'});
    payload.method_version=m.version;payload.provider_key=options.infer(m);payload.provider_label=m.label;
    if(body.action==='preview')return res.status(200).json(payload);
    if(body.expected_total_cents!==payload.total_cents)throw error(409,'Preview the current final amount again.');
    if(m.kind==='hosted_link'&&body.provider_amount_confirmed!==true)throw error(400,'Confirm the provider invoice has the exact final amount and currency.');
    payload.payment_url=options.hostedUrl(body.payment_url,m);
   }
   return res.status(200).json(checked(await db.rpc('commerce_provider_command',{p_action:body.action,p_data:payload,p_actor:actor})));
  }
  const user=await verifiedUser(req,db);
  if(!UUID.test(body.preferred_method_id||''))throw error(400,'Choose an available payment preference.');
  const m=checked(await db.from('commerce_payment_methods').select(methodColumns).eq('id',body.preferred_method_id).single());
  if(!m.active||!options.allowedFor(m,body.kind))throw error(409,'That payment method is no longer available for this request. Choose another or no preference.');
  await (deps.rateLimit||enforceRateLimit)(db,'manual-invoice:'+user.id,env.CHECKOUT_RATE_LIMIT_SECRET);
  const catalog=deps.catalog||JSON.parse(fs.readFileSync(path.join(process.cwd(),'lib/catalog.json'),'utf8'));
  // Reuse all existing invoice normalization, consent and catalog checks. The request-only
  // DB facade attaches a server-validated preference before hashing and the single RPC write.
  const requestDb={rpc:async(name,args)=>{
   if(name!=='commerce_request_invoice')throw Error('Unexpected request operation.');
   const data={...args.p_data,request:{...args.p_data.request,preferred_payment:{method_id:m.id,provider_key:options.infer(m),label:m.label,currency:m.currency}}};
   delete data.digest;data.digest=createHash('sha256').update(JSON.stringify(data)).digest('hex');
   return db.rpc(name,{p_data:data});
  }};
  return res.status(201).json(await base.requestInvoice(requestDb,user,body,catalog));
 }catch(e){return res.status([400,401,403,404,409,413,415,429].includes(e.status)?e.status:503).json({error:e.status&&e.status!==503?e.message:'Payment settings are temporarily unavailable.'});}
}
module.exports={handle};
