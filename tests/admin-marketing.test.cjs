'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const handle=require('../lib/admin-marketing');

const goodPassword='a'.repeat(48);
const env={ADMIN_ORDERS_PASSWORD:goodPassword,SITE_URL:'https://altapurelabs.com',OPENAI_API_KEY:'test-key',OPENAI_MARKETING_MODEL:'gpt-6-astra'};
function response(){
  return {
    statusCode:200,headers:{},payload:null,
    setHeader(k,v){this.headers[k]=v;return this;},
    status(v){this.statusCode=v;return this;},
    json(v){this.payload=v;return this;}
  };
}
function req(method='GET',override={}){
  return {method,headers:{'x-admin-password':goodPassword,'origin':'https://altapurelabs.com','content-type':'application/json'},...override};
}

test('marketing endpoint refuses unauthenticated requests',async()=>{
  const res=response();
  await handle(req('GET',{headers:{}}),res,{env});
  assert.equal(res.statusCode,401);
  assert.equal(res.headers['Cache-Control'],'no-store');
});
test('marketing endpoint returns authenticated shared CRM and Instagram status',async()=>{
  const res=response();
  const db={from(name){return {select(){return this;},eq(){return this;},order(){return this;},limit(){return this;},async maybeSingle(){
    return {error:null,data:name==='ap_marketing_workspaces'?{workspace_id:'main',revision:0,payload:{leads:[],messages:[],style:'Test'},updated_at:'2026-11-13T00:00:00Z'}:null};
  }};}};
  await handle(req(),res,{env:{...env,OPENAI_API_KEY:''},db});
  assert.equal(res.statusCode,200);
  assert.equal(res.payload.authenticated,true);
  assert.equal(res.payload.ai_enabled,false);
  assert.equal(res.payload.revision,0);
  assert.deepEqual(res.payload.workspace.leads,[]);
  assert.equal(res.payload.instagram.connected,false);
  assert.equal(res.payload.instagram.credentials_configured,false);
  assert.equal(res.payload.instagram.callback_url,'https://altapurelabs.com/api/instagram/callback');
  const current=response();
  await handle(req(),current,{env:{...env,SITE_URL:'https://getpurelabs.com',OPENAI_API_KEY:''},db});
  assert.equal(current.statusCode,200);
  assert.equal(current.payload.instagram.callback_url,'https://altapurelabs.com/api/instagram/callback');
});
test('marketing drafting rejects cross-origin POST',async()=>{
  const res=response();
  await handle(req('POST',{headers:{'x-admin-password':goodPassword,origin:'https://attacker.example','content-type':'application/json'}}),res,{env});
  assert.equal(res.statusCode,403);
});
test('marketing drafting returns explicitly review-only text',async()=>{
  let called=0;
  const fetchImpl=async(url,options)=>{
    called++;
    assert.equal(url,'https://api.openai.com/v1/responses');
    assert.equal(options.method,'POST');
    const payload=JSON.parse(options.body);
    assert.equal(payload.store,false);
    assert.match(payload.instructions,/not send|do not claim you sent/i);
    assert.equal(JSON.parse(payload.input).name,'Creator A');
    return {ok:true,json:async()=>({output:[{content:[{type:'output_text',text:'Hello Creator A, are you open to a collaboration?'}]}]})};
  };
  const res=response();
  await handle(req('POST',{body:{action:'draft',name:'Creator A',type:'intro',context:'recent post'}}),res,{env,fetchImpl});
  assert.equal(res.statusCode,200);
  assert.equal(res.payload.sent,false);
  assert.equal(res.payload.review_required,true);
  assert.equal(called,1);
});
test('marketing drafting has safe unavailable response without API key',async()=>{
  const res=response();
  await handle(req('POST',{body:{action:'draft',name:'Creator A'}}),res,{env:{...env,OPENAI_API_KEY:''}});
  assert.equal(res.statusCode,503);
});
test('admin navigation includes Orders, Marketing and Inventory; existing operations and manual sending are preserved',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../admin-orders.html'),'utf8');
  const match=html.match(/<nav class="admin-nav" aria-label="Admin sections">([\s\S]*?)<\/nav>/);
  assert.ok(match,'Admin nav found');
  const links=[...match[1].matchAll(/>(Orders|Marketing|Inventory|Batches|Notifications|Lotus)<\/(?:a|button)>/g)].map(x=>x[1]);
  assert.deepEqual(links,['Orders','Marketing','Inventory']);
  assert.match(match[1],/href="\/admin-inventory\.html">Inventory/);
  for(const id of ['admin-orders-section','admin-batches-section','admin-notifications-section','admin-lotus-section'])assert.match(html,new RegExp('id="'+id+'"'));
  const marketing=fs.readFileSync(path.join(__dirname,'../admin-marketing.html'),'utf8');
  assert.match(marketing,/href="\/admin-orders\.html">Orders/);
  assert.match(marketing,/href="\/admin-marketing\.html" aria-current="page">Marketing/);
  assert.match(marketing,/href="\/admin-inventory\.html">Inventory/);
  assert.match(marketing,/Messages are sent only when you click Send\./);
  assert.match(marketing,/manual review and send only/);
});
test('Marketing browser script parses and uses official review-only draft flow',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../admin-marketing.js'),'utf8');
  assert.doesNotThrow(()=>new Function(source));
  assert.match(source,/draft-output/);
  assert.doesNotMatch(source,/graph\.facebook\.com|api\.instagram\.com|ig\.me\/m/);
});

test('workspace validation requires bounded, typed records',()=>{
  const platform=require('../lib/admin-marketing-platform');
  assert.throws(()=>platform.validWorkspace({leads:[{id:'x'}],messages:[]}),/Invalid creator/);
  assert.throws(()=>platform.validWorkspace({leads:[],messages:[{lead_id:7,text:'test'}]}),/Invalid conversation/);
  const clean=platform.validWorkspace({leads:[{id:'x',name:'Creator'}],messages:[],style:'Hello'});
  assert.equal(clean.leads[0].name,'Creator');
});
test('Instagram access tokens are encrypted at rest and decrypt correctly',()=>{
  const platform=require('../lib/admin-marketing-platform');
  const testEnv={INSTAGRAM_TOKEN_ENCRYPTION_KEY:'a'.repeat(64)};
  const encrypted=platform.encrypt('secret-IG-token',testEnv);
  assert.doesNotMatch(encrypted,/secret-IG-token/);
  assert.equal(platform.decrypt(encrypted,testEnv),'secret-IG-token');
  assert.throws(()=>platform.decrypt(encrypted,{INSTAGRAM_TOKEN_ENCRYPTION_KEY:'b'.repeat(64)}));
});
test('Meta OAuth URL is disabled until Instagram credentials are configured',async()=>{
  const platform=require('../lib/admin-marketing-platform');
  await assert.rejects(()=>platform.connectUrl({},{}),/INSTAGRAM_APP_ID/);
});
test('all Instagram reply sends require explicit manual actions',()=>{
  const frontend=fs.readFileSync(path.join(__dirname,'../admin-marketing.js'),'utf8');
  const handler=frontend.match(/\$\('mk-ig-send'\)\.addEventListener\('click',async\(\)=>\{([\s\S]*?)\n  \}\);/);
  assert.ok(handler,'Instagram sending must be registered on an explicit click');
  assert.match(handler[1],/if\(!recipient_id\|\|!message\)return/);
  assert.match(handler[1],/if\(!confirm\('Send this exact reply[\s\S]*?\)\)return/);
  assert.ok(handler[1].indexOf("confirm('Send this exact reply")<handler[1].indexOf("action:'instagram_send'"));
  assert.equal([...frontend.matchAll(/action\s*:\s*['"]instagram_send['"]/g)].length,1,'No background or draft path may send an Instagram reply');
  assert.match(handler[1],/await endpoint\(\{action:'instagram_send',recipient_id,message\}\)/);
  const backend=fs.readFileSync(path.join(__dirname,'../lib/admin-marketing.js'),'utf8');
  assert.match(backend,/if\(body\.action==='instagram_send'\)return res\.status\(200\)\.json\(await platform\.sendReply/);
  assert.equal([...backend.matchAll(/platform\.sendReply\(/g)].length,1);
});

test('marketing Instagram connection uses Meta Unified Login and a one-time state',async()=>{
  const platform=require('../lib/admin-marketing-platform');
  let inserted;
  const db={from(table){
    assert.equal(table,'ap_marketing_ig_oauth_states');
    return {async insert(value){inserted=value;return {error:null,data:value};}};
  }};
  const auth=await platform.connectUrl(db,{
    SITE_URL:'https://altapurelabs.com',
    INSTAGRAM_APP_ID:'2526228261196996',
    INSTAGRAM_CONFIG_ID:'1599102845567340',
    INSTAGRAM_APP_SECRET:'unit-test-secret',
    INSTAGRAM_TOKEN_ENCRYPTION_KEY:'a'.repeat(64)
  });
  const url=new URL(auth.authorization_url);
  assert.equal(url.origin,'https://www.facebook.com');
  assert.equal(url.pathname,'/dialog/oauth');
  assert.equal(url.searchParams.get('config_id'),'1599102845567340');
  assert.equal(url.searchParams.get('redirect_uri'),'https://altapurelabs.com/api/instagram/callback');
  assert.equal(url.searchParams.get('response_type'),'code');
  assert.match(url.searchParams.get('state'),/^[a-f0-9]{64}$/);
  assert.equal(inserted.state_hash.length,64);
  assert.equal(url.searchParams.has('scope'),false);
});

test('Instagram authorization retains the registered callback with either configured storefront domain',async()=>{
  const platform=require('../lib/admin-marketing-platform');
  const db={from(){return {async insert(){return {error:null,data:{}};}};}};
  const credentials={INSTAGRAM_APP_ID:'2526228261196996',INSTAGRAM_CONFIG_ID:'1599102845567340',INSTAGRAM_APP_SECRET:'unit-test-secret',INSTAGRAM_TOKEN_ENCRYPTION_KEY:'a'.repeat(64)};
  for(const site of [undefined,'https://altapurelabs.com','https://getpurelabs.com']){
    const auth=await platform.connectUrl(db,{...credentials,...(site?{SITE_URL:site}:{})});
    assert.equal(new URL(auth.authorization_url).searchParams.get('redirect_uri'),'https://altapurelabs.com/api/instagram/callback');
  }
  await assert.rejects(()=>platform.connectUrl(db,{...credentials,SITE_URL:'https://untrusted.example'}),/site configuration mismatch/);
});

test('Instagram token exchange preserves the registered redirect URI after a callback reaches the new domain',async()=>{
  const platform=require('../lib/admin-marketing-platform');
  const db={from(table){
    assert.equal(table,'ap_marketing_ig_oauth_states');
    const q={select(){return q;},eq(){return q;},delete(){return q;},async maybeSingle(){return {data:{expires_at:new Date(Date.now()+60000).toISOString()}};},then(resolve){return Promise.resolve({data:{}}).then(resolve);}};
    return q;
  }};
  const callbackEnv={SITE_URL:'https://getpurelabs.com',INSTAGRAM_APP_ID:'2526228261196996',INSTAGRAM_CONFIG_ID:'1599102845567340',INSTAGRAM_APP_SECRET:'unit-test-secret'};
  let exchanged;
  const res=response();res.end=function(){return this;};
  await platform.oauthCallback({url:'/api/instagram/callback?code=fixture-code&state='+'a'.repeat(64)},res,{env:callbackEnv,db,fetchImpl:async(url)=>{
    exchanged=new URL(url);return {ok:false,status:502};
  }});
  assert.equal(exchanged.searchParams.get('redirect_uri'),'https://altapurelabs.com/api/instagram/callback');
  assert.equal(res.statusCode,302);
  assert.equal(res.headers.Location,'https://getpurelabs.com/admin-marketing.html?instagram=connection_failed');
});

test('Instagram media accepts Graph image and webhook attachment URLs without treating story links as images',()=>{
  const platform=require('../lib/admin-marketing-platform');
  const media=platform.mediaItems({
    attachments:{data:[
      {image_data:{url:'https://scontent.cdninstagram.com/a.jpg'}},
      {type:'video',payload:{url:'https://video.cdninstagram.com/b.mp4'}}
    ]},
    story:{link:'https://www.instagram.com/stories/example/123/'}
  });
  assert.deepEqual(media.map(x=>x.type),['image','video','file']);
  assert.equal(media[0].url,'https://scontent.cdninstagram.com/a.jpg');
  assert.equal(media[2].url,'https://www.instagram.com/stories/example/123/');
  assert.deepEqual(platform.mediaItems({attachments:[{type:'image',payload:{url:'javascript:alert(1)'}}]}),[]);
});

test('Instagram attachment lookup refreshes Meta URL and returns trusted image bytes for browser preview',async()=>{
  const platform=require('../lib/admin-marketing-platform');
  const env={INSTAGRAM_TOKEN_ENCRYPTION_KEY:'a'.repeat(64)};
  const ciphertext=platform.encrypt('test-token',env);
  let updated;
  const db={from(table){
    const q={select(){return this;},eq(){return this;},order(){return this;},limit(){return this;},
      async maybeSingle(){return {error:null,data:table==='ap_marketing_ig_auth'?
        {ig_user_id:'17841478098427620',username:'AltaPure'}:
        {provider_message_id:'mid_12345678',body:'[Media attachment]',attachments:[]}};},
      async single(){return {error:null,data:{ciphertext}};},
      update(value){updated=value;return this;}};
    return q;
  }};
  const fetchImpl=async(url)=>{
    if(new URL(url).hostname==='graph.facebook.com')return {ok:true,json:async()=>({
      id:'mid_12345678',attachments:{data:[{image_data:{url:'https://scontent.cdninstagram.com/new.jpg'}}]}
    })};
    return {ok:true,headers:{get:key=>key==='content-type'?'image/jpeg':key==='content-length'?'3':null},
      arrayBuffer:async()=>Uint8Array.of(255,216,217).buffer};
  };
  const result=await platform.mediaForMessage(db,{message_id:'mid_12345678'},env,fetchImpl);
  assert.equal(result.status,'available');
  assert.equal(updated.attachments[0].url,'https://scontent.cdninstagram.com/new.jpg');
  assert.equal(result.media[0].data_url,'data:image/jpeg;base64,/9jZ');
});

test('Instagram sync stores attachment metadata and does not erase it when Meta omits later media',async()=>{
  const platform=require('../lib/admin-marketing-platform');
  const authEnv={INSTAGRAM_TOKEN_ENCRYPTION_KEY:'b'.repeat(64)};
  const saved=[];
  const db={from(table){
    return {select(){return this;},eq(){return this;},order(){return this;},limit(){return this;},
      async maybeSingle(){return {error:null,data:{ig_user_id:'17841478098427620'}};},
      async single(){return {error:null,data:{ciphertext:platform.encrypt('token',authEnv)}};},
      async upsert(value,options){saved.push({value,options});return {error:null,data:null};},
      then(resolve){resolve({error:null,data:table==='ap_marketing_ig_messages'?[]:null});}};
  }};
  const fetchImpl=async(url)=>{
    const path=new URL(url).pathname;
    if(path.endsWith('/conversations'))return {ok:true,json:async()=>({data:[{id:'conv123',participants:{data:[
      {id:'17841478098427620',username:'AltaPure'},
      {id:'17841478098427621',username:'creator'}]}}]})};
    if(path.endsWith('/conv123'))return {ok:true,json:async()=>({messages:{data:[
      {id:'mid_image_123456',message:'',from:{id:'17841478098427621'},to:{data:[{id:'17841478098427620'}]},
        created_time:'2026-11-16T00:00:00Z',attachments:{data:[{image_data:{url:'https://scontent.cdninstagram.com/a.jpg'}}]}},
      {id:'mid_text_123456',message:'Hello',from:{id:'17841478098427621'},to:{data:[{id:'17841478098427620'}]},
        created_time:'2026-11-16T00:00:01Z'}]}})};
    throw Error('Unexpected Meta URL');
  };
  const result=await platform.syncInbox(db,authEnv,fetchImpl);
  assert.equal(result.processed,2);
  assert.equal(saved[0].value.attachments[0].type,'image');
  assert.equal(saved[0].options.ignoreDuplicates,false);
  assert.equal(saved[1].value.attachments,undefined);
  assert.equal(saved[1].options.ignoreDuplicates,true);
});
