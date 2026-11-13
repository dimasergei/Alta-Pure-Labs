'use strict';
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 const url=new URL(req.url||'/api/customer-config','https://account.internal');
 if(url.searchParams.has('lotus'))return require('../lib/lotus-admin').handle(req,res,url.searchParams);
 if(url.searchParams.has('partner'))return require('../lib/partner-program').handle(req,res,url.searchParams);
 if(url.searchParams.has('marketing'))return require('../lib/admin-marketing')(req,res);
 if(url.searchParams.has('checkout'))return require('../lib/direct-checkout').handle(req,res,url.searchParams);
 if(url.searchParams.has('commerce'))return require('../lib/manual-commerce-integrated').handle(req,res,url.searchParams);
 if(url.searchParams.has('admin_operations'))return require('../lib/admin-operations').handle(req,res,url.searchParams);
 if(req.method==='GET'&&url.searchParams.get('workspace')==='requests'){
  try{return await require('../lib/request-operations').customerRequests(req,res,require('../lib/inventory-db').inventoryDb());}
  catch(e){return res.status([400,401].includes(e.status)?e.status:503).json({error:e.status===400?e.message:'Requests are temporarily unavailable.'});}
 }
 if(req.method==='POST')return require('../lib/site-inquiry').handleInquiry(req,res);
 if(req.method!=='GET'){res.setHeader('Allow','GET, POST');return res.status(405).end();}
 const supabaseUrl=process.env.SUPABASE_URL||'',anonKey=process.env.SUPABASE_ANON_KEY||process.env.SUPABASE_PUBLISHABLE_KEY||'';
 if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(supabaseUrl)||!anonKey)return res.status(503).json({error:'Customer accounts are not configured.'});
 return res.status(200).json({supabaseUrl,anonKey});
};
