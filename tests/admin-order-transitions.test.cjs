'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const backendPath=require.resolve('../lib/backend'),original=require(backendPath),password='valid-test-admin-password-with-32-characters';
let previous,updates;
require.cache[backendPath].exports={
 clients:()=>({db:{from(name){
  assert.equal(name,'store_orders');
  return{select(){return this},eq(){return this},async maybeSingle(){return{data:previous,error:null}},update(){updates++;throw Error('Forbidden transition reached update')}};
 }}}),
 checked:r=>{if(r.error)throw r.error;return r.data}
};
const handler=require('../api/admin-orders');
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
async function request(from,to,extra={}){previous={id,order_number:'AP-OLD',customer_email:'test@example.test',payment_status:'paid',fulfillment_status:from,tracking_carrier:null,tracking_number:null,...extra};updates=0;
 const req={method:'PATCH',url:'/api/admin-orders',headers:{'x-admin-password':password,'content-type':'application/json'},body:{action:'update',order_id:id,fulfillment_status:to}};
 const res={statusCode:200,setHeader(){},status(code){this.statusCode=code;return this},json(body){this.body=body;return this}};
 await handler(req,res);return res}
test('server blocks fulfillment regressions and paid cancellation after supplier activity',async()=>{
 const old=process.env.ADMIN_ORDERS_PASSWORD;process.env.ADMIN_ORDERS_PASSWORD=password;
 try{for(const [from,to,extra]of [['delivered','canceled',{}],['shipped','processing',{}],['unfulfilled','canceled',{supplier_report_generated_at:'2026-11-15T00:00:00Z'}],['unfulfilled','canceled',{supplier_status:'submitted'}]]){const res=await request(from,to,extra);assert.equal(res.statusCode,409,from+' -> '+to);assert.equal(updates,0)}}finally{if(old===undefined)delete process.env.ADMIN_ORDERS_PASSWORD;else process.env.ADMIN_ORDERS_PASSWORD=old}
});
test.after(()=>{require.cache[backendPath].exports=original});
