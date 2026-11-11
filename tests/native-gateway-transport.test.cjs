'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {Readable}=require('node:stream');
const gateway=require('../lib/native-gateway');
const env={PEPTIDEPAY_WEBHOOK_SECRET:'whsec_transport_fixture_only'};
function request(raw,headers={}){
 const req=Readable.from([raw.subarray(0,7),raw.subarray(7)]);
 req.method='POST';req.headers={'content-type':'application/json',...headers};
 // Accessing Vercel's lazy helper loses the distinction between signed JSON
 // representations. A payment transport must never access this helper.
 Object.defineProperty(req,'body',{get(){throw Error('Parsed body getter accessed');}});
 return req;
}
function response(){return{status(code){this.code=code;return this;},json(body){this.body=body;return this;},setHeader(){}};}
function signature(raw){const timestamp=Math.floor(Date.now()/1000);return't='+timestamp+',v1='+crypto.createHmac('sha256',env.PEPTIDEPAY_WEBHOOK_SECRET).update(timestamp+'.').update(raw).digest('hex');}
test('signed JSON callbacks use the original stream despite a runtime body getter',async()=>{
 const raw=Buffer.from('{\n "event": "webhook.test", "amount": 1.00, "label": "é"\n}\n');
 const res=response();let writes=0;
 const db={from(){writes++;throw Error('Test events must not query invoices');},rpc(){writes++;throw Error('Test events must not mutate payments');}};
 await gateway.handle(request(raw,{'x-peptidepay-signature':signature(raw)}),res,new URLSearchParams({native:'peptidepay-webhook'}),{env,db});
 assert.equal(res.code,200);assert.deepEqual(res.body,{received:true,verified:true,ignored:true,live_payment_applied:false});assert.equal(writes,0);
});
test('altered or unsigned JSON callbacks are rejected without database access',async()=>{
 const original=Buffer.from('{ "event": "webhook.test" }');
 for(const header of [signature(original),undefined]){
  const res=response();const db={from(){throw Error('Must authenticate first');},rpc(){throw Error('Must authenticate first');}};
  await gateway.handle(request(Buffer.from('{"event":"webhook.test"}'),{'x-peptidepay-signature':header}),res,new URLSearchParams({native:'peptidepay-webhook'}),{env,db});
  assert.equal(res.code,401);
 }
});
test('request limits count raw bytes and reject oversized streams and buffered adapters',async()=>{
 for(const req of [request(Buffer.alloc(65537)),Readable.from(['é'.repeat(32769)]),{body:Buffer.alloc(65537)}])await assert.rejects(gateway.rawBody(req),e=>e.status===413);
 const raw=Buffer.from('a'.repeat(65536));assert.deepEqual(await gateway.rawBody(request(raw)),raw);
});
test('parsed-only bodies and unavailable lazy buffers cannot bypass signature verification',async()=>{
 const parsed={body:{event:'webhook.test'}};
 const lazy={};Object.defineProperty(lazy,'body',{get(){throw Error('Do not invoke');}});
 for(const req of [parsed,lazy])await assert.rejects(gateway.rawBody(req),e=>e.status===400);
 const raw=Buffer.from('{ "x": 1.00 }');assert.deepEqual(await gateway.rawBody({body:raw}),raw);assert.deepEqual(await gateway.rawBody({body:raw.toString()}),raw);
});
