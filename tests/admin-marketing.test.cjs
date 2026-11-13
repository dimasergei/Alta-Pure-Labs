'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const handle=require('../api/admin-marketing');

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
test('marketing endpoint reports AI status only after authentication',async()=>{
  const res=response();
  await handle(req(),res,{env:{...env,OPENAI_API_KEY:''}});
  assert.equal(res.statusCode,200);
  assert.deepEqual(res.payload,{authenticated:true,ai_enabled:false});
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
  assert.match(marketing,/No messages are sent/);
});