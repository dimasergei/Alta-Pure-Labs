'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{createHmac}=require('node:crypto');
const {verify}=require('../lib/invoice-worker-auth'),{handle}=require('../lib/manual-commerce-integrated');
const secret='isolated-fixture-key-not-a-production-secret',nonce='70000000-0000-4000-8000-000000000001';
function headers(now=Date.now(),key=secret){const ts=String(Math.floor(now/1000));return{'x-commerce-job-time':ts,'x-commerce-job-nonce':nonce,'x-commerce-job-signature':createHmac('sha256',key).update('invoice-email-retry\n'+ts+'\n'+nonce).digest('hex')};}
function res(){return{code:200,setHeader(){},status(n){this.code=n;return this;},json(v){this.body=v;return this;}};}
test('worker proof verifies the exact scoped message without transmitting the reusable key',()=>{const h=headers();assert.equal(verify(h,secret).nonce,nonce);assert.equal(JSON.stringify(h).includes(secret),false);assert.equal(verify({...h,'x-commerce-job-nonce':'70000000-0000-4000-8000-000000000002'},secret),null);assert.equal(verify(headers(Date.now(),'wrong-secret'),secret),null);});
test('old, future, malformed and bearer-only worker calls fail verification',()=>{assert.equal(verify(headers(Date.now()-61000),secret),null);assert.equal(verify(headers(Date.now()+10000),secret),null);assert.equal(verify({authorization:'Bearer '+secret},secret),null);assert.equal(verify({...headers(),'x-commerce-job-signature':'xyz'},secret),null);assert.equal(verify(headers(),''),null);});
test('valid job must consume its nonce before any dispatch; replay cannot send',async()=>{let consumed=0;const db={rpc:async(name,args)=>{assert.equal(name,'commerce_consume_notification_job');assert.equal(args.p_nonce,nonce);return{data:consumed++===0};}};const env={COMMERCE_NOTIFICATION_JOB_SECRET:secret};const a=res(),b=res(),req={method:'POST',headers:headers()};await handle(req,a,new URLSearchParams({commerce:'worker'}),{env,db});assert.equal(a.code,200);assert.equal(a.body.configured,false);await handle(req,b,new URLSearchParams({commerce:'worker'}),{env,db});assert.equal(b.code,409);});
test('a failed email queue does not starve the paid-order supplier queue',async()=>{
 const db={rpc:async()=>({data:true})},env={COMMERCE_NOTIFICATION_JOB_SECRET:secret,LOTUS_FULFILLMENT_ENABLED:'true'};
 let supplierCalls=0;
 const response=res();await handle({method:'POST',headers:headers()},response,new URLSearchParams({commerce:'worker'}),{
  env,db,notificationsDispatch:async()=>{throw Error('email storage unavailable')},
  lotusRun:async()=>{supplierCalls++;return{enabled:true,processed:1,status:'submitted'}}
 });
 assert.equal(response.code,503);assert.equal(response.body.notification_error,'unavailable');
 assert.equal(response.body.supplier.status,'submitted');assert.equal(supplierCalls,1);
});
test('a supplier outage does not stop the independent email queue',async()=>{
 const db={rpc:async()=>({data:true})},env={COMMERCE_NOTIFICATION_JOB_SECRET:secret,LOTUS_FULFILLMENT_ENABLED:'true'};
 let mailCalls=0;
 const response=res();await handle({method:'POST',headers:headers()},response,new URLSearchParams({commerce:'worker'}),{
  env,db,notificationsDispatch:async()=>{mailCalls++;return{configured:true,attempted:1,accepted:1,failed:0,held:0}},
  lotusRun:async()=>{throw Error('supplier unavailable')}
 });
 assert.equal(response.code,503);assert.equal(response.body.accepted,1);
 assert.equal(response.body.supplier.status,'unavailable');assert.equal(mailCalls,1);
});
test('authenticated one-use job reconciles crypto before dispatch even when new wallet collection is disabled',async()=>{
 const events=[],env={COMMERCE_NOTIFICATION_JOB_SECRET:secret,POLYGON_USDC_RECIPIENT:'0x1111111111111111111111111111111111111111',POLYGON_USDC_RPC_URL:'https://polygon-rpc.test',POLYGON_USDC_ENABLED:'false'};
 let consumed=false;const db={rpc:async(name)=>{assert.equal(name,'commerce_consume_notification_job');events.push('auth');if(consumed)return{data:false};consumed=true;return{data:true};}};
 const deps={env,db,cryptoReconcile:async(_db,options)=>{events.push('crypto');assert.equal(options.limit,4);assert.equal(options.timeBudgetMs,35000);return{processed:1,paid:1,pending:0};},notificationsDispatch:async()=>{events.push('mail');return{configured:true,attempted:1,accepted:1};}};
 const anonymous=res();await handle({method:'POST',headers:{}},anonymous,new URLSearchParams({commerce:'worker'}),deps);assert.equal(anonymous.code,401);assert.deepEqual(events,[]);
 const first=res(),req={method:'POST',headers:headers()};await handle(req,first,new URLSearchParams({commerce:'worker'}),deps);assert.equal(first.code,200);assert.deepEqual(events,['auth','crypto','mail']);assert.equal(first.body.crypto.paid,1);
 const replay=res();await handle(req,replay,new URLSearchParams({commerce:'worker'}),deps);assert.equal(replay.code,409);assert.deepEqual(events,['auth','crypto','mail','auth']);
});
test('an unavailable chain does not starve notification work or leak RPC errors',async()=>{
 const env={COMMERCE_NOTIFICATION_JOB_SECRET:secret,POLYGON_USDC_RECIPIENT:'0x1111111111111111111111111111111111111111',POLYGON_USDC_RPC_URL:'https://polygon-rpc.test'};
 const response=res();let calls=0;await handle({method:'POST',headers:headers()},response,new URLSearchParams({commerce:'worker'}),{env,db:{rpc:async()=>({data:true})},cryptoReconcile:async()=>{throw Error('private RPC detail');},notificationsDispatch:async()=>{calls++;return{configured:true,accepted:1};}});
 assert.equal(response.code,503);assert.equal(calls,1);assert.deepEqual(response.body.crypto,{status:'unavailable'});assert.ok(!JSON.stringify(response.body).includes('private RPC detail'));
});
