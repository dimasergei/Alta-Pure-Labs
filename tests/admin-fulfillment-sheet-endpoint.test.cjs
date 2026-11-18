'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const backendPath=require.resolve('../lib/backend'),original=require.cache[backendPath],password='valid-test-admin-password-with-32-characters';
const id='52788339-e005-4ee8-a851-200ba27496e3';
let reads=0, historical=false;
const allocations=[{variant_key:'p1|10mg',item:{id:'p1',size:'10mg',qty:2},supplier_name:'Lotus Labs',route:'lotus',product:41,vials:1,status:'ordered'}];
const jobs=[{supplier_id:'PRIVATE-EXTERNAL-ORDER',reference:'PRIVATE-EXTERNAL-REFERENCE',payload:{supplier:'99Purity Peptides',contact:'PRIVATE-CONTACT'}}];
require.cache[backendPath]={id:backendPath,filename:backendPath,loaded:true,exports:{
 clients:()=>({db:{from(table){reads++;return{select(){return this},eq(){return this},async maybeSingle(){return{data:table==='commerce_invoices'?{id,kind:'goods',status:historical?'paid':'accepted',created_at:'2026-11-16T12:00:00Z',customer_email:'test@example.test',customer_name:'Researcher',request_data:{name:'Researcher',items:[{id:'p1',name:'Test compound',size:'10mg',qty:2}],address:{line1:'1 Main',city:'NY',region:'NY',postal_code:'10001',country:'US'},checkout:{delivery:{shipping:'standard'}}},pricing:{lines:[{id:'p1',size:'10mg',qty:2,bogo_free_units:1}]}}:null,error:null}},then(resolve){return Promise.resolve({data:historical?(table==='commerce_fulfillment_items'?allocations:table==='commerce_supplier_jobs'?jobs:[]):[],error:null}).then(resolve)},update(){throw Error('Export mutated records')}}}}}),
 checked:r=>{if(r.error)throw r.error;return r.data}
}};
const handler=require('../api/admin-orders');
const previous=process.env.ADMIN_ORDERS_PASSWORD;
test.before(()=>{process.env.ADMIN_ORDERS_PASSWORD=password});
test.beforeEach(()=>{historical=false});
test.after(()=>{if(original)require.cache[backendPath]=original;else delete require.cache[backendPath];if(previous===undefined)delete process.env.ADMIN_ORDERS_PASSWORD;else process.env.ADMIN_ORDERS_PASSWORD=previous});
function response(){return{statusCode:200,headers:{},body:null,setHeader(k,v){this.headers[k]=v},status(n){this.statusCode=n;return this},json(v){this.body=v;return this},send(v){this.body=v;return this}}}
async function get(query,authorized=true){const res=response();await handler({method:'GET',url:'/api/admin-orders?view=fulfillment-sheet&'+query,headers:authorized?{'x-admin-password':password}:{}},res);return res;}
test('exports require existing admin authentication before any database access',async()=>{reads=0;const r=await get('id='+id,false);assert.equal(r.statusCode,401);assert.equal(reads,0);assert.equal(r.headers['Cache-Control'],'no-store');});
test('authenticated per-order PDF and CSV respond as safe no-store attachments',async()=>{for(const format of ['pdf','csv']){const r=await get('id='+id+'&source=commerce&format='+format);assert.equal(r.statusCode,200);assert.ok(Buffer.isBuffer(r.body));assert.equal(r.headers['Content-Disposition'],`attachment; filename="fulfillment-ORD-52788339.${format}"`);assert.equal(r.headers['X-Content-Type-Options'],'nosniff');assert.equal(r.headers['Cache-Control'],'no-store');assert.match(r.headers['Content-Type'],format==='pdf'?/application\/pdf/:/text\/csv/);assert.match(r.body.toString(),/DRAFT - PAYMENT NOT CONFIRMED/);assert.match(r.body.toString(),/Fulfillment Sheet/);assert.doesNotMatch(r.body.toString(),/99Purity|Lotus|Supplier|Route/);}});
test('historical branded allocations remain duplicate-held without exposing supplier identity or references',async()=>{
 historical=true;
 for(const format of ['pdf','csv']){
  const r=await get('id='+id+'&source=commerce&format='+format);assert.equal(r.statusCode,200);
  const body=r.body.toString('latin1');assert.match(body,/FULFILLMENT ACTIVITY EXISTS/);assert.match(body,/DO NOT SHIP AGAIN/);
  assert.match(body,/Test compound/);assert.match(body,/Researcher/);assert.doesNotMatch(body,/99Purity|Lotus|Supplier|Route|PRIVATE-/);
 }
});
test('endpoint rejects unsupported format and malformed id',async()=>{for(const query of ['id='+id+'&format=html','id=not-an-id&format=csv']){const r=await get(query);assert.equal(r.statusCode,400);assert.equal(typeof r.body.error,'string');assert.equal(r.headers['Content-Disposition'],undefined);}});
