'use strict';
const {randomBytes,createHash,createCipheriv,createDecipheriv,timingSafeEqual}=require('node:crypto');
const {inventoryDb}=require('./inventory-db');
const ORIGIN='https://altapurelabs.com';
const IG_VERSION='v27.0';
const IG_GRAPH='https://graph.facebook.com/';
const MAX_WORKSPACE_BYTES=1200000;
const safe=(v,n=1000)=>typeof v==='string'?v.slice(0,n):'';
const fail=(status,message)=>Object.assign(Error(message),{status});
const only=(result)=>{if(result.error)throw fail(503,'Marketing database is unavailable.');return result.data;};
const h=v=>createHash('sha256').update(String(v)).digest('hex');
const isId=v=>typeof v==='string'&&/^\d{5,30}$/.test(v);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const table='ap_marketing_workspaces';

function origin(env){const url=new URL(env.SITE_URL||ORIGIN);if(url.origin!==ORIGIN)throw fail(503,'Marketing service site configuration mismatch.');return url.origin;}
function isConfigured(env){return /^\d{6,30}$/.test(env.INSTAGRAM_APP_ID||'')&&/^\d{6,30}$/.test(env.INSTAGRAM_CONFIG_ID||'')&&Boolean(env.INSTAGRAM_APP_SECRET);}
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
  return {connected:Boolean(acc),username:acc?.username||null,ig_user_id:acc?.ig_user_id||null,
    token_expires_at:acc?.token_expires_at||null,webhook_subscribed:acc?.webhook_subscribed===true,
    credentials_configured:isConfigured(env),webhook_url:'https://mqtitxfsdphqbsxhwdma.supabase.co/functions/v1/alta-instagram-webhook',
    callback_url:ORIGIN+'/api/instagram/callback',can_send: Boolean(acc&&isConfigured(env))};
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
  const url=new URL('https://www.facebook.com/dialog/oauth');
  url.searchParams.set('client_id',env.INSTAGRAM_APP_ID);
  url.searchParams.set('config_id',env.INSTAGRAM_CONFIG_ID);
  url.searchParams.set('redirect_uri',origin(env)+'/api/instagram/callback');
  url.searchParams.set('response_type','code');
  url.searchParams.set('display','popup');
  url.searchParams.set('override_default_response_type','true');
  url.searchParams.set('prompt','login');
  url.searchParams.set('state',token);
  return {authorization_url:url.toString()};
}
async function jsonFetch(url,opts,fetchImpl){
  const resp=await fetchImpl(url,{...opts,signal:AbortSignal.timeout(14000)});
  if(!resp.ok)throw fail(502,'Instagram API request was not accepted (HTTP '+resp.status+').');
  return resp.json();
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
    const exchange=new URL(IG_GRAPH+IG_VERSION+'/oauth/access_token');
    exchange.search=new URLSearchParams({client_id:env.INSTAGRAM_APP_ID,client_secret:env.INSTAGRAM_APP_SECRET,
      redirect_uri:base+'/api/instagram/callback',code}).toString();
    const grant=await jsonFetch(exchange,{method:'GET'},fetchImpl);
    if(!grant.access_token)throw fail(502,'Meta did not return an access token.');
    const token=grant.access_token;
    const assigned=new URL(IG_GRAPH+IG_VERSION+'/me/assigned_instagram_accounts');
    assigned.search=new URLSearchParams({fields:'id,username',limit:'100'}).toString();
    const accounts=await jsonFetch(assigned,{method:'GET',headers:{Authorization:'Bearer '+token}},fetchImpl);
    const selected=(Array.isArray(accounts.data)?accounts.data:[]).find(x=>String(x.id)==='17841478098427620');
    if(!selected)throw fail(403,'The authorized Meta business did not share the selected Instagram account.');
    const igId=String(selected.id);
    if(!isId(igId))throw fail(502,'Meta returned an invalid Instagram account ID.');
    const username=safe(selected.username,120)||'Instagram professional account';
    // Meta Unified Login token lifetime depends on configuration. Avoid
    // asserting a non-expiring grant; keep the existing nullable expiry column.
    const expires=Number(grant.expires_in)||60*24*3600;
    only(await db.from('ap_marketing_ig_auth').upsert({ig_user_id:igId,username,ciphertext:encrypt(token,env),token_expires_at:new Date(Date.now()+expires*1000).toISOString(),webhook_subscribed:false,updated_at:new Date().toISOString()},{onConflict:'ig_user_id'}));
    let subscribed=false;
    try{
      const u=IG_GRAPH+IG_VERSION+'/'+igId+'/subscribed_apps';
      const p=new URLSearchParams({subscribed_fields:'messages',access_token:token});
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
  const secured=only(await db.from('ap_marketing_ig_auth').select('ciphertext').eq('ig_user_id',acc.ig_user_id).single());
  const u=IG_GRAPH+IG_VERSION+'/'+acc.ig_user_id+'/messages';
  const data=await jsonFetch(u,{method:'POST',headers:{Authorization:'Bearer '+decrypt(secured.ciphertext,env),'Content-Type':'application/json'},body:JSON.stringify({recipient:{id:recipient},message:{text:message}})},fetchImpl);
  if(!data.message_id)throw fail(502,'Instagram did not confirm the message.');
  only(await db.from('ap_marketing_ig_messages').upsert({provider_message_id:String(data.message_id),ig_user_id:acc.ig_user_id,participant_id:recipient,direction:'outgoing',body:message,message_at:new Date().toISOString()},{onConflict:'provider_message_id'}));
  return {sent:true,message_id:data.message_id};
}
async function syncInbox(db,env,fetchImpl){
  const acc=await account(db);if(!acc)throw fail(409,'Connect Instagram first.');
  const sec=only(await db.from('ap_marketing_ig_auth').select('ciphertext').eq('ig_user_id',acc.ig_user_id).single());
  const token=decrypt(sec.ciphertext,env);
  const path=IG_GRAPH+IG_VERSION;
  const url=new URL(path+'/'+acc.ig_user_id+'/conversations');
  url.search=new URLSearchParams({platform:'instagram',fields:'id,participants,updated_time',limit:'20',access_token:token}).toString();
  const list=await jsonFetch(url,{method:'GET'},fetchImpl);
  let recorded=0;
  const media={};
  const mediaDiagnostics={found:0,resolved:0,unavailable:0};
  const collectMedia=(msg)=>{
    const id=String(msg?.id||'');
    if(!id||id.length>512)return false;
    const attachments=Array.isArray(msg.attachments?.data)?msg.attachments.data:[];
    const items=[];
    const add=(kind,value)=>{
      if(typeof value!=='string'||value.length>4096)return;
      try{
        const u=new URL(value);
        if(u.protocol==='https:'&&!u.username&&!u.password&&!items.some(x=>x.url===u.href))items.push({type:kind,url:u.href});
      }catch{}
    };
    for(const a of attachments.slice(0,12)){
      const type=String(a?.type||'').toLowerCase();
      add('image',a?.image_data?.url||a?.image_data?.animated_gif_url||a?.image_data?.preview_url);
      add('video',a?.video_data?.url);
      add('file',a?.file_url);
      add(type==='video'||type==='audio'||type==='image'?type:'file',a?.payload?.url||a?.url);
    }
    if(msg.story?.link)add('image',msg.story.link);
    if(items.length)media[id]=items;
    return items.length>0;
  };
  const profiles={};
  const addProfile=(person)=>{
    const id=String(person?.id||''),username=safe(person?.username,80).replace(/^@/,'');
    if(isId(id)&&/^[a-zA-Z0-9._]{1,30}$/.test(username))profiles[id]={username,name:safe(person?.name,120)};
  };
  let detailBudget=8;
  for(const conv of (list.data||[]).slice(0,20)){
    if(!conv?.id)continue;
    for(const p of (conv.participants?.data||[]))addProfile(p);
    const cu=new URL(path+'/'+encodeURIComponent(conv.id));
    cu.search=new URLSearchParams({fields:'messages{id,message,from,to,created_time,attachments{type,payload}}',access_token:token}).toString();
    let item;try{item=await jsonFetch(cu,{method:'GET'},fetchImpl);}catch{continue;}
    let conversationDetails=0;
    for(const msg of (item.messages?.data||[]).slice(0,25)){
      if(!msg.message||msg.attachments?.data?.length){
        mediaDiagnostics.found++;
        // The conversation edge can omit attachment details. Fetch the
        // documented individual Message node using the existing app token.
        if(collectMedia(msg)){mediaDiagnostics.resolved++;}
        else if(detailBudget>0&&conversationDetails<2){
        detailBudget--;conversationDetails++;
        const detailUrl=new URL(path+'/'+encodeURIComponent(String(msg.id)));
        detailUrl.search=new URLSearchParams({fields:'id,message,attachments{file_url,image_data,video_data},story',access_token:token}).toString();
        try{
          const detail=await Promise.race([jsonFetch(detailUrl,{method:'GET'},fetchImpl),new Promise((_,reject)=>setTimeout(()=>reject(Error('Media detail timed out')),4000))]);
          if(collectMedia(detail))mediaDiagnostics.resolved++;
          else mediaDiagnostics.unavailable++;
        }catch{mediaDiagnostics.unavailable++;}
        }else mediaDiagnostics.unavailable++;
      }
      addProfile(msg.from);
      for(const p of (msg.to?.data||[]))addProfile(p);
      const sender=String(msg.from?.id||''),receiver=Array.isArray(msg.to?.data)?String(msg.to.data[0]?.id||''):'';
      const incoming=sender!==acc.ig_user_id;
      const participant=incoming?sender:receiver;
      if(!msg.id||!isId(participant))continue;
      const m={provider_message_id:String(msg.id),ig_user_id:acc.ig_user_id,participant_id:participant,direction:incoming?'incoming':'outgoing',body:safe(msg.message,4000),message_at:msg.created_time||new Date().toISOString()};
      only(await db.from('ap_marketing_ig_messages').upsert(m,{onConflict:'provider_message_id'}));
      recorded++;
    }
  }
  // Resolve Instagram-scoped sender IDs through the authorized messaging API.
  // Failure for one user must not prevent the rest of the inbox from syncing.
  const recent=await messages(db,acc.ig_user_id);
  const participantIds=[...new Set(recent.map(x=>x.participant_id).filter(isId))].slice(0,40);
  const failures={};
  await Promise.all(Array.from({length:Math.min(4,participantIds.length)},async(_,worker)=>{
    for(let i=worker;i<participantIds.length;i+=4){
      const id=participantIds[i];
      if(profiles[id])continue;
      const profileUrl=new URL(path+'/'+id);
      profileUrl.search=new URLSearchParams({fields:'username,name'}).toString();
      try{
        const response=await jsonFetch(profileUrl,{method:'GET',headers:{Authorization:'Bearer '+token}},fetchImpl);
        const username=safe(response.username,120).replace(/^@/,'');
        const name=safe(response.name,120);
        if(username&&/^[a-zA-Z0-9._]{1,30}$/.test(username))profiles[id]={username,name};
      }catch(e){
        const code=String(e?.message||'').match(/HTTP (\d{3})/)?.[1]||'unavailable';
        failures[code]=(failures[code]||0)+1;
      }
    }
  }));
  return {synced:true,processed:recorded,messages:recent,participant_profiles:profiles,media,media_diagnostics:mediaDiagnostics,profile_lookup:{resolved:Object.keys(profiles).length,unresolved:participantIds.filter(id=>!profiles[id]).length,failures}};
}

async function mediaForMessage(db,body,env,fetchImpl){
  const acc=await account(db);
  if(!acc)throw fail(409,'Connect Instagram first.');
  const messageId=String(body?.message_id||'');
  if(!/^[A-Za-z0-9_:-]{8,512}$/.test(messageId))throw fail(400,'Invalid Instagram message ID.');
  const existing=only(await db.from('ap_marketing_ig_messages').select('provider_message_id,body').eq('ig_user_id',acc.ig_user_id).eq('provider_message_id',messageId).maybeSingle());
  if(!existing)throw fail(403,'Message is not in the connected inbox.');
  const sec=only(await db.from('ap_marketing_ig_auth').select('ciphertext').eq('ig_user_id',acc.ig_user_id).single());
  const token=decrypt(sec.ciphertext,env);
  const url=new URL(IG_GRAPH+IG_VERSION+'/'+encodeURIComponent(messageId));
  url.search=new URLSearchParams({fields:'id,attachments{file_url,image_data,video_data}',access_token:token}).toString();
  let response,code='ok';
  try{
    response=await Promise.race([jsonFetch(url,{method:'GET'},fetchImpl),new Promise((_,reject)=>setTimeout(()=>reject(Error('timeout')),6500))]);
  }catch(e){
    code=String(e.message||'').match(/HTTP (\\d{3})/)?.[1]||'unavailable';
    return {message_id:messageId,media:[],status:code};
  }
  const media=[];
  const attachments=Array.isArray(response.attachments?.data)?response.attachments.data:Array.isArray(response.attachments)?response.attachments:[];
  for(const a of attachments.slice(0,12)){
    const candidates=[
      ['image',a?.image_data?.url],['image',a?.image_data?.preview_url],
      ['video',a?.video_data?.url],['file',a?.file_url],
      [String(a?.type||'file'),a?.payload?.url||a?.url]
    ];
    for(const [kind,link] of candidates){
      if(typeof link!=='string'||link.length>4096)continue;
      try{
        const u=new URL(link);
        if(u.protocol==='https:'&&!u.username&&!u.password&&!media.some(x=>x.url===u.href))media.push({type:['image','video','audio'].includes(kind)?kind:'file',url:u.href});
      }catch{}
    }
  }
  return {message_id:messageId,media,status:media.length?'available':'no_media_url',attachment_count:attachments.length};
}
module.exports={workspace,saveWorkspace,getStatus,connectUrl,oauthCallback,disconnect,sendReply,syncInbox,mediaForMessage,encrypt,decrypt,validWorkspace};
