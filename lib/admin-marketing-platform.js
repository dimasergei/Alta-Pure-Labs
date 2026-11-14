'use strict';
const {randomBytes,createHash,createCipheriv,createDecipheriv,timingSafeEqual}=require('node:crypto');
const {inventoryDb}=require('./inventory-db');
const ORIGIN='https://altapurelabs.com';
const IG_VERSION='v26.0';
const MAX_WORKSPACE_BYTES=1200000;
const safe=(v,n=1000)=>typeof v==='string'?v.slice(0,n):'';
const fail=(status,message)=>Object.assign(Error(message),{status});
const only=(result)=>{if(result.error)throw fail(503,'Marketing database is unavailable.');return result.data;};
const h=v=>createHash('sha256').update(String(v)).digest('hex');
const isId=v=>typeof v==='string'&&/^\d{5,30}$/.test(v);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const table='ap_marketing_workspaces';

function origin(env){const url=new URL(env.SITE_URL||ORIGIN);if(url.origin!==ORIGIN)throw fail(503,'Marketing service site configuration mismatch.');return url.origin;}
function isConfigured(env){return /^\d{6,30}$/.test(env.INSTAGRAM_APP_ID||'')&&Boolean(env.INSTAGRAM_APP_SECRET);}
function cryptoKey(env){
  const source=env.INSTAGRAM_TOKEN_ENCRYPTION_KEY||env.PARTNER_BANK_ENCRYPTION_KEY||'';
  if(!/^[a-f0-9]{64}$/i.test(source))throw fail(503,'Instagram token encryption is not configured.');
  return createHash('sha256').update('AltaPure:Instagram:Token:v1').update(Buffer.from(source,'hex')).digest();
}
function encrypt(token,env){
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',cryptoKey(env),iv);
  const raw=Buffer.concat([cipher.update(token,'utf8'),cipher.final()]);
  return [iv.toString('hex'),cipher.getAuthTag().toString('hex'),raw.toString('hex')].join(':');
}
function decrypt(box,env){
  const [iv,tag,data]=String(box||'').split(':');
  if(!/^[a-f0-9]{24}$/i.test(iv||'')||!/^[a-f0-9]{32}$/i.test(tag||'')||!/^[a-f0-9]*$/i.test(data||''))throw fail(503,'Stored Instagram connection is invalid.');
  const d=createDecipheriv('aes-256-gcm',cryptoKey(env),Buffer.from(iv,'hex'));
  d.setAuthTag(Buffer.from(tag,'hex'));return Buffer.concat([d.update(Buffer.from(data,'hex')),d.final()]).toString('utf8');
}
function validWorkspace(p){
  if(!p||typeof p!=='object'||Array.isArray(p)||!Array.isArray(p.leads)||!Array.isArray(p.messages)||p.leads.length>5000||p.messages.length>10000)throw fail(400,'Invalid marketing workspace format.');
  if(p.leads.some(x=>!x||typeof x!=='object'||typeof x.id!=='string'||!x.id||typeof x.name!=='string'||x.name.length>150))throw fail(400,'Invalid creator record.');
  if(p.messages.some(x=>!x||typeof x!=='object'||typeof x.lead_id!=='string'||typeof x.text!=='string'||x.text.length>4000))throw fail(400,'Invalid conversation history.');
  const clone={leads:p.leads,messages:p.messages,style:safe(p.style,2000)};
  const size=Buffer.byteLength(JSON.stringify(clone),'utf8');
  if(size>MAX_WORKSPACE_BYTES)throw fail(413,'Marketing workspace is too large. Export a backup and reduce the number of records.');
  return clone;
}
async function workspace(db){
  let row=only(await db.from(table).select('workspace_id,revision,payload,updated_at').eq('workspace_id','main').maybeSingle());
  if(!row){
    only(await db.from(table).upsert({workspace_id:'main',payload:{leads:[],messages:[],style:''}},{onConflict:'workspace_id'}));
    row=only(await db.from(table).select('workspace_id,revision,payload,updated_at').eq('workspace_id','main').single());
  }
  return row;
}
async function saveWorkspace(db,body){
  const revision=body.revision;
  if(!Number.isSafeInteger(revision)||revision<0)throw fail(400,'Supply a valid workspace revision.');
  const payload=validWorkspace(body.payload);
  const updated=only(await db.from(table).update({payload,revision:revision+1,updated_at:new Date().toISOString()}).eq('workspace_id','main').eq('revision',revision).select('revision,updated_at').maybeSingle());
  if(!updated)throw fail(409,'Workspace changed in another browser. Refresh before overwriting.');
  return {revision:updated.revision,updated_at:updated.updated_at};
}
async function account(db){
  return only(await db.from('ap_marketing_ig_auth').select('ig_user_id,username,token_expires_at,webhook_subscribed,updated_at').order('updated_at',{ascending:false}).limit(1).maybeSingle());
}
function igPublic(acc,env){
  const expiresAt=acc?.token_expires_at?Date.parse(acc.token_expires_at):NaN;
  const expired=Number.isFinite(expiresAt)&&expiresAt<=Date.now();
  const expiring=Number.isFinite(expiresAt)&&expiresAt-Date.now()<14*86400000;
  return {connected:Boolean(acc),username:acc?.username||null,ig_user_id:acc?.ig_user_id||null,
    token_expires_at:acc?.token_expires_at||null,token_expired:expired,token_expiring:expiring,
    webhook_subscribed:acc?.webhook_subscribed===true,
    credentials_configured:isConfigured(env),webhook_url:'https://mqtitxfsdphqbsxhwdma.supabase.co/functions/v1/alta-instagram-webhook',
    callback_url:ORIGIN+'/api/instagram/callback',can_send: Boolean(acc&&isConfigured(env)&&!expired)};
}
async function messages(db,igid){
  if(!igid)return [];
  return only(await db.from('ap_marketing_ig_messages').select('id,provider_message_id,participant_id,direction,body,message_at').eq('ig_user_id',igid).order('message_at',{ascending:false}).limit(200))||[];
}
async function getStatus(db,env){
  const [state,acc]=await Promise.all([workspace(db),account(db)]);
  return {authenticated:true,ai_enabled:Boolean(env.OPENAI_API_KEY),revision:state.revision,workspace:state.payload,updated_at:state.updated_at,instagram:igPublic(acc,env),instagram_messages:await messages(db,acc?.ig_user_id)};
}
async function connectUrl(db,env){
  if(!isConfigured(env))throw fail(503,'Add INSTAGRAM_APP_ID and INSTAGRAM_APP_SECRET to the Vercel production environment first.');
  cryptoKey(env);
  const token=randomBytes(32).toString('hex');
  only(await db.from('ap_marketing_ig_oauth_states').insert({state_hash:h(token),expires_at:new Date(Date.now()+10*60000).toISOString()}));
  const url=new URL('https://www.instagram.com/oauth/authorize');
  url.searchParams.set('client_id',env.INSTAGRAM_APP_ID);
  url.searchParams.set('redirect_uri',origin(env)+'/api/instagram/callback');
  url.searchParams.set('scope','instagram_business_basic,instagram_business_manage_messages');
  url.searchParams.set('response_type','code');
  url.searchParams.set('state',token);
  return {authorization_url:url.toString()};
}
async function jsonFetch(url,opts,fetchImpl){
  const resp=await fetchImpl(url,{...opts,signal:AbortSignal.timeout(14000)});
  if(!resp.ok)throw fail(502,'Instagram API request was not accepted (HTTP '+resp.status+').');
  return resp.json();
}
// Refresh long-lived Instagram Login tokens when less than 14 days remain.
// Never return a token to the browser or include one in an error.
async function accessToken(db,acc,env,fetchImpl){
  const credentials=only(await db.from('ap_marketing_ig_auth')
    .select('ciphertext,token_expires_at').eq('ig_user_id',acc.ig_user_id).single());
  if(!credentials)throw fail(409,'Instagram account needs to be reconnected.');
  const current=decrypt(credentials.ciphertext,env);
  const expiry=Date.parse(credentials.token_expires_at||'');
  if(Number.isFinite(expiry)&&expiry<=Date.now())
    throw fail(409,'Instagram access token expired. Reconnect Instagram in Marketing.');
  if(!Number.isFinite(expiry)||expiry-Date.now()>14*86400000)return current;
  if(!isConfigured(env))throw fail(503,'Instagram app credentials are missing; reconnect after configuration.');
  const refresh=new URL('https://graph.instagram.com/refresh_access_token');
  refresh.search=new URLSearchParams({grant_type:'ig_refresh_token',access_token:current}).toString();
  try {
    const data=await jsonFetch(refresh,{method:'GET'},fetchImpl);
    if(typeof data.access_token!=='string'||data.access_token.length<20)throw Error('Missing refreshed token');
    const seconds=Number(data.expires_in);
    if(!Number.isFinite(seconds)||seconds<=86400||seconds>5184000)throw Error('Invalid refreshed expiry');
    const newExpiry=new Date(Date.now()+seconds*1000).toISOString();
    only(await db.from('ap_marketing_ig_auth').update({
      ciphertext:encrypt(data.access_token,env),
      token_expires_at:newExpiry,
      updated_at:new Date().toISOString()
    }).eq('ig_user_id',acc.ig_user_id));
    return data.access_token;
  }catch(err){
    if(expiry-Date.now()<=2*86400000)
      throw fail(502,'Instagram token is near expiry and refresh failed. Reconnect the account.');
    return current; // The existing token remains valid until expiry.
  }
}
async function oauthCallback(req,res,deps={}){
  const env=deps.env||process.env,db=deps.db||inventoryDb(),fetchImpl=deps.fetchImpl||fetch;
  const base=origin(env);
  const loc=new URL(req.url||'',base);
  const code=loc.searchParams.get('code'),state=loc.searchParams.get('state');
  if(!code||!state||!(/^[a-f0-9]{64}$/.test(state)))return res.status(400).json({error:'Invalid Instagram authorization response.'});
  const row=only(await db.from('ap_marketing_ig_oauth_states').select('state_hash,expires_at').eq('state_hash',h(state)).maybeSingle());
  if(!row||Date.parse(row.expires_at)<Date.now())return res.status(403).json({error:'Instagram authorization expired. Restart from Marketing.'});
  only(await db.from('ap_marketing_ig_oauth_states').delete().eq('state_hash',h(state)));
  if(!isConfigured(env))return res.status(503).json({error:'Instagram OAuth credentials are not configured.'});
  try{
    const params=new URLSearchParams({client_id:env.INSTAGRAM_APP_ID,client_secret:env.INSTAGRAM_APP_SECRET,grant_type:'authorization_code',redirect_uri:base+'/api/instagram/callback',code});
    const short=await jsonFetch('https://api.instagram.com/oauth/access_token',{method:'POST',body:params,headers:{'Content-Type':'application/x-www-form-urlencoded'}},fetchImpl);
    if(!short.access_token)throw fail(502,'Instagram did not return an access token.');
    const next=new URL('https://graph.instagram.com/access_token');
    next.search=new URLSearchParams({grant_type:'ig_exchange_token',client_secret:env.INSTAGRAM_APP_SECRET,access_token:short.access_token}).toString();
    const long=await jsonFetch(next,{method:'GET'},fetchImpl);
    const token=long.access_token||short.access_token;
    const profileURL=new URL('https://graph.instagram.com/'+IG_VERSION+'/me');
    profileURL.search=new URLSearchParams({fields:'user_id,username',access_token:token}).toString();
    const profile=await jsonFetch(profileURL,{method:'GET'},fetchImpl);
    const igId=String(profile.user_id||profile.id||short.user_id||'');
    if(!isId(igId))throw fail(502,'Instagram returned an invalid account ID.');
    const username=safe(profile.username,120)||'Instagram professional account';
    const expires=Number(long.expires_in)||3600;
    only(await db.from('ap_marketing_ig_auth').upsert({ig_user_id:igId,username,ciphertext:encrypt(token,env),token_expires_at:new Date(Date.now()+expires*1000).toISOString(),webhook_subscribed:false,updated_at:new Date().toISOString()},{onConflict:'ig_user_id'}));
    let subscribed=false;
    try{
      const u='https://graph.instagram.com/'+IG_VERSION+'/'+igId+'/subscribed_apps';
      const p=new URLSearchParams({subscribed_fields:'messages,messaging_postbacks',access_token:token});
      const sub=await jsonFetch(u,{method:'POST',body:p},fetchImpl);subscribed=sub.success===true;
    }catch{/* Reporting remains unverified until permissions and app review complete. */}
    if(subscribed)only(await db.from('ap_marketing_ig_auth').update({webhook_subscribed:true,updated_at:new Date().toISOString()}).eq('ig_user_id',igId));
    res.setHeader('Location',base+'/admin-marketing.html?instagram='+(subscribed?'connected':'connected_webhook_pending'));
    return res.status(302).end();
  }catch(e){
    res.setHeader('Location',base+'/admin-marketing.html?instagram=connection_failed');
    return res.status(302).end();
  }
}
async function disconnect(db){
  const acc=await account(db);
  if(!acc)return {disconnected:true};
  only(await db.from('ap_marketing_ig_auth').delete().eq('ig_user_id',acc.ig_user_id));
  return {disconnected:true};
}
async function sendReply(db,body,env,fetchImpl){
  const acc=await account(db);if(!acc)throw fail(409,'Connect Instagram before replying.');
  const recipient=safe(body.recipient_id,40),message=safe(body.message,1200).trim();
  if(!isId(recipient)||!message||message.length>1000)throw fail(400,'Choose an existing conversation and a reply of at most 1,000 characters.');
  const last=only(await db.from('ap_marketing_ig_messages').select('message_at').eq('ig_user_id',acc.ig_user_id).eq('participant_id',recipient).eq('direction','incoming').order('message_at',{ascending:false}).limit(1).maybeSingle());
  if(!last||Date.now()-Date.parse(last.message_at)>24*3600000)throw fail(409,'Manual replies require a recent inbound Instagram message. This conversation is outside the standard messaging window.');
  const token=await accessToken(db,acc,env,fetchImpl);
  const u='https://graph.instagram.com/'+IG_VERSION+'/'+acc.ig_user_id+'/messages';
  const data=await jsonFetch(u,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({recipient:{id:recipient},message:{text:message}})},fetchImpl);
  if(!data.message_id)throw fail(502,'Instagram did not confirm the message.');
  only(await db.from('ap_marketing_ig_messages').upsert({provider_message_id:String(data.message_id),ig_user_id:acc.ig_user_id,participant_id:recipient,direction:'outgoing',body:message,message_at:new Date().toISOString()},{onConflict:'provider_message_id'}));
  return {sent:true,message_id:data.message_id};
}
async function syncInbox(db,env,fetchImpl){
  const acc=await account(db);if(!acc)throw fail(409,'Connect Instagram first.');
  const token=await accessToken(db,acc,env,fetchImpl);
  const path='https://graph.instagram.com/'+IG_VERSION;
  const url=new URL(path+'/'+acc.ig_user_id+'/conversations');
  url.search=new URLSearchParams({platform:'instagram',fields:'id,participants,updated_time',limit:'20',access_token:token}).toString();
  const list=await jsonFetch(url,{method:'GET'},fetchImpl);
  let recorded=0;
  for(const conv of (list.data||[]).slice(0,20)){
    if(!conv?.id)continue;
    const cu=new URL(path+'/'+encodeURIComponent(conv.id));
    cu.search=new URLSearchParams({fields:'messages{id,message,from,to,created_time}',access_token:token}).toString();
    let item;try{item=await jsonFetch(cu,{method:'GET'},fetchImpl);}catch{continue;}
    for(const msg of (item.messages?.data||[]).slice(0,25)){
      const sender=String(msg.from?.id||''),receiver=Array.isArray(msg.to?.data)?String(msg.to.data[0]?.id||''):'';
      const incoming=sender!==acc.ig_user_id;
      const participant=incoming?sender:receiver;
      if(!msg.id||!isId(participant))continue;
      const m={provider_message_id:String(msg.id),ig_user_id:acc.ig_user_id,participant_id:participant,direction:incoming?'incoming':'outgoing',body:safe(msg.message,4000),message_at:msg.created_time||new Date().toISOString()};
      only(await db.from('ap_marketing_ig_messages').upsert(m,{onConflict:'provider_message_id'}));
      recorded++;
    }
  }
  return {synced:true,processed:recorded,messages:await messages(db,acc.ig_user_id)};
}
module.exports={workspace,saveWorkspace,getStatus,connectUrl,oauthCallback,disconnect,sendReply,syncInbox,accessToken,encrypt,decrypt,validWorkspace};
