'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const handler=require('../api/admin-operations-overview');
const root=path.resolve(__dirname,'..');
function response(){return{code:200,headers:{},body:null,setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(x){this.body=x;return this;}};}
test('admin overview rejects missing and invalid passwords without DB access',async()=>{
 const previous=process.env.ADMIN_ORDERS_PASSWORD;
 process.env.ADMIN_ORDERS_PASSWORD='fixture-password-is-at-least-32-characters';
 try{
  for(const provided of [undefined,'incorrect','x'.repeat(5000)]){
   const res=response();
   await handler({method:'GET',headers:{'x-admin-password':provided}},res);
   assert.equal(res.code,401);
   assert.deepEqual(res.body,{error:'Unauthorized.'});
   assert.equal(res.headers['Cache-Control'],'no-store');
  }
 }finally{if(previous===undefined)delete process.env.ADMIN_ORDERS_PASSWORD;else process.env.ADMIN_ORDERS_PASSWORD=previous;}
});
test('authenticated non-GET requests are rejected',async()=>{
 const previous=process.env.ADMIN_ORDERS_PASSWORD;
 process.env.ADMIN_ORDERS_PASSWORD='fixture-password-is-at-least-32-characters';
 try{
  const res=response();
  await handler({method:'POST',headers:{'x-admin-password':process.env.ADMIN_ORDERS_PASSWORD}},res);
  assert.equal(res.code,405);
  assert.equal(res.headers.Allow,'GET');
 }finally{if(previous===undefined)delete process.env.ADMIN_ORDERS_PASSWORD;else process.env.ADMIN_ORDERS_PASSWORD=previous;}
});
test('overview computes only exact counts and returns no customer data',async()=>{
 const calls=[];
 const db={from(table){return{select(cols,options){
  assert.equal(cols,'*');assert.deepEqual(options,{count:'exact',head:true});
  const filters=[];const query={eq(k,v){filters.push([k,v]);return query;},then(resolve){calls.push({table,filters});return Promise.resolve({count:3,error:null}).then(resolve);}};return query;
 }}}};
 const result=await handler.loadOverview(db);
 assert.equal(calls.length,10);
 assert.equal(result.counts.orders_total,3);
 assert.equal(result.counts.suppliers_active,3);
 assert.equal(result.counts.notifications_total,3);
 assert.equal(result.checkout_enabled,false);
 assert.equal(result.data_scope,'live_counts');
 assert.equal(JSON.stringify(result).includes('customer_email'),false);
});
test('overview page uses branded admin styling and never stores password',()=>{
 const html=fs.readFileSync(path.join(root,'admin-operations-overview.html'),'utf8');
 const js=fs.readFileSync(path.join(root,'admin-operations-overview.js'),'utf8');
 assert.match(html,/href="\/admin-dashboard\.css"/);
 assert.match(html,/type="password"/);
 assert.match(js,/x-admin-password/);
 assert.match(js,/input\.value=''/);
 assert.doesNotMatch(js,/localStorage|sessionStorage|innerHTML\s*=/);
});
