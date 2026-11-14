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
test('admin navigation is Orders and Marketing only; existing operational sections preserved',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../admin-orders.html'),'utf8');
  const match=html.match(/<nav class="admin-nav" aria-label="Admin sections">([\s\S]*?)<\/nav>/);
  assert.ok(match,'Admin nav found');
  const links=[...match[1].matchAll(/>(Orders|Marketing|Batches|Notifications|Lotus)<\/(?:a|button)>/g)].map(x=>x[1]);
  assert.deepEqual(links,['Orders','Marketing']);
  for(const id of ['admin-orders-section','admin-batches-section','admin-notifications-section','admin-lotus-section'])assert.match(html,new RegExp('id="'+id+'"'));
  const marketing=fs.readFileSync(path.join(__dirname,'../admin-marketing.html'),'utf8');
  assert.match(marketing,/href="\/admin-orders\.html">Orders/);
  assert.match(marketing,/href="\/admin-marketing\.html" aria-current="page">Marketing/);
  assert.match(marketing,/never sends outreach automatically/);
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
  assert.ok(frontend.includes("confirm('Send this exact reply"));
  assert.ok(frontend.includes("action:'instagram_send'"));
  assert.ok(!frontend.includes('setInterval(()=>endpoint({action:\'instagram_send\''));
});
