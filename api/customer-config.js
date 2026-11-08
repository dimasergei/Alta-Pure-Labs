module.exports=async(req,res)=>{
res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).end();}
const supabaseUrl=process.env.SUPABASE_URL||'',anonKey=process.env.SUPABASE_ANON_KEY||process.env.SUPABASE_PUBLISHABLE_KEY||'';
if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(supabaseUrl)||!anonKey)return res.status(503).json({error:'Customer accounts are not configured.'});
return res.status(200).json({supabaseUrl,anonKey});};