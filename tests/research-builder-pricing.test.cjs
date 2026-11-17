'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const builder=require('../lib/research-builder-pricing'),handler=require('../lib/research-builder-handler');
function response(){return{setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};}
test('research builder exposes no purchasable catalog or quote',()=>{
 assert.deepEqual(builder.catalog(),[]);
 for(const value of [undefined,[],[{id:'retatrutide',size:'10mg',qty:4}]])assert.throws(()=>builder.quote(value),e=>e.status===409);
});
test('all new subscription creation, edits, activation and purchase requests are unavailable',async()=>{
 for(const action of ['quote','create','checkout','edit','activate','renew','cancel']){
  const res=response();await handler({method:'POST',headers:{},body:{action,items:[]}},res);
  assert.equal(res.code,409);assert.match(res.body.error,/unavailable/);
 }
});
test('public capability reports unavailable and historical reads still require authentication',async()=>{
 const res=response();await handler({method:'GET',headers:{}},res);assert.equal(res.code,200);assert.equal(res.body.subscription_available,false);assert.equal(res.body.catalog,undefined);
 for(const scope of ['mine','admin']){const res=response();await handler({method:'GET',headers:{},query:{scope}},res);assert.equal(res.code,401);}
});
