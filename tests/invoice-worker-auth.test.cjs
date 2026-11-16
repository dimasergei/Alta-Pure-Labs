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
