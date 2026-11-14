'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { Readable } = require('node:stream');
const r = require('../lib/rampex-connection');
const secret = 'offline-fixture-only-not-real-rampex-secret';
const env = { RAMPEX_API_KEY: 'offline-fixture-only', RAMPEX_WEBHOOK_SECRET: secret };
const response = (status, value) => new Response(JSON.stringify(value), { status });
function res() { return { headers: {}, setHeader(k,v){this.headers[k]=v;}, status(s){this.code=s;return this;}, json(v){this.data=v;return this;} }; }
function signed(payload) { const raw=Buffer.from(JSON.stringify(payload));return {method:'POST',body:raw,headers:{'x-rampex-signature':createHmac('sha256',secret).update(raw).digest('hex')}}; }
const params = name => new URLSearchParams({ native: name });

test('authenticates only through the fixed read-only key endpoint', async()=>{
 let call;
 const status=await r.authenticate(env,async(url,options)=>{call={url,options};return response(200,{valid:true,merchant_id:'merchant-fixture',business_name:'private'});});
 assert.equal(status,'valid');assert.equal(call.url,'https://api.rampex.io/api-validate-key');
 assert.equal(call.options.method,'POST');assert.equal(call.options.redirect,'error');assert.equal(call.options.headers['X-API-Key'],env.RAMPEX_API_KEY);assert.equal(call.options.body,undefined);
});
test('key failures are sanitized and not represented as valid',async()=>{
 assert.equal(await r.authenticate({},()=>{throw Error('must not fetch')}),'not_configured');
 assert.equal(await r.authenticate(env,async()=>response(401,{valid:false,error:'private'})),'rejected');
 for(const value of [{valid:true},{valid:false},[],null]) assert.equal(await r.authenticate(env,async()=>response(200,value)),'unavailable');
 assert.equal(await r.authenticate(env,async()=>{throw Error(env.RAMPEX_API_KEY)}),'unavailable');
 assert.equal(await r.authenticate(env,async()=>new Response('x'.repeat(17000))),'unavailable');
});
test('readiness is cached and never leaks merchant data or secret values',async()=>{
 let calls=0;const fetcher=async()=>{calls++;return response(200,{valid:true,merchant_id:'private-merchant',business_name:'private-name'});};
 const a=await r.readiness(env,fetcher,1000),b=await r.readiness(env,fetcher,1001);
 assert.equal(calls,1);assert.deepEqual(a,b);assert.equal(a.authentication,'valid');assert.equal(a.collection_enabled,false);assert.equal(a.order_reconciliation_ready,false);
 for(const value of [env.RAMPEX_API_KEY,secret,'private-merchant','private-name']) assert.equal(JSON.stringify(a).includes(value),false);
 await r.readiness({...env,RAMPEX_API_KEY:'rotated-offline-fixture'},fetcher,1002);assert.equal(calls,2);
});
test('readiness cannot be turned into collection with an environment flag',async()=>{
 const out=res();await r.handle({method:'GET'},out,params('rampex-readiness'),{env:{...env,RAMPEX_ENABLED:'true'},fetchImpl:async()=>response(200,{valid:true,merchant_id:'fixture'}),now:999999});
 assert.equal(out.code,200);assert.equal(out.data.collection_enabled,false);
});
test('raw webhook stream is used without accessing parsed body getter',async()=>{
 const req=Readable.from([Buffer.from('{"event":"ping"}')]);Object.defineProperty(req,'body',{get(){throw Error('parsed getter accessed')}});
 assert.equal((await r.rawBody(req)).toString(),'{"event":"ping"}');
 await assert.rejects(()=>r.rawBody({body:{event:'ping'}}));
 await assert.rejects(()=>r.rawBody({body:Buffer.alloc(65537)}),{status:413});
});
test('an explicit signed test is verified without writing or calling an API',async()=>{
 const out=res();await r.handle(signed({event:'payment.completed',test:true}),out,params('rampex-webhook'),{env,fetchImpl:()=>{throw Error('no fetch allowed')}});
 assert.equal(out.code,200);assert.equal(out.data.verified,true);assert.equal(out.data.live_payment_applied,false);
});
test('genuine or ambiguous callbacks fail closed pending durable reconciliation',async()=>{
 for(const event of ['payment.completed','payment.extra_deposit','payment.expired','unrecognized']){
  const out=res();await r.handle(signed({event,link_id:'fixture-123'}),out,params('rampex-webhook'),{env});
  assert.equal(out.code,503);assert.equal(out.data.verified,true);assert.equal(out.data.live_payment_applied,false);assert.equal(out.headers['Retry-After'],'60');
 }
});
test('missing and tampered signatures cannot pass as test events',async()=>{
 const req=signed({event:'payment.completed',test:true});req.body=Buffer.concat([req.body,Buffer.from(' ')]);
 const out=res();await r.handle(req,out,params('rampex-webhook'),{env});assert.equal(out.code,401);assert.equal(out.data.live_payment_applied,false);
});
test('wrong methods, unknown routes and missing signing configuration fail closed',async()=>{
 for(const [req,kind,code,config] of [[{method:'GET'},'rampex-webhook',405,env],[{method:'POST'},'rampex-readiness',405,env],[{method:'GET'},'other',404,env],[{method:'POST'},'rampex-webhook',503,{}]]){
  const out=res();await r.handle(req,out,params(kind),{env:config});assert.equal(out.code,code);
 }
});
test('checkout router leaves the legacy payment route retired',async()=>{
 const route=require('../api/checkout'),out=res();await route({method:'POST',url:'/api/checkout'},out);assert.equal(out.code,503);assert.equal(route.config.api.bodyParser,false);
});
