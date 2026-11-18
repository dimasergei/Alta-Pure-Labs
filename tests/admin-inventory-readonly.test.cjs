'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {loadInventory}=require('../lib/enterprise-inventory-query');
const adminHandler=require('../api/admin-suppliers');
const root=path.resolve(__dirname,'..');
function response(){return{code:200,headers:{},body:null,setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(v){this.body=v;return this;}};}
test('inventory endpoint requires admin password before database access',async()=>{
 const prior=process.env.ADMIN_ORDERS_PASSWORD;
 process.env.ADMIN_ORDERS_PASSWORD='fixture-admin-password-that-is-long-enough-123';
 try{
  const res=response();
  await adminHandler({method:'GET',url:'/api/admin-suppliers?inventory=1',headers:{}},res);
  assert.equal(res.code,401);
  assert.deepEqual(res.body,{error:'Unauthorized.'});
  assert.equal(res.headers['Cache-Control'],'no-store');
 }finally{if(prior===undefined)delete process.env.ADMIN_ORDERS_PASSWORD;else process.env.ADMIN_ORDERS_PASSWORD=prior;}
});
test('read model returns only restricted lot/report metadata and never sales approval',async()=>{
 const calls=[];
 const db={from(table){const query={select(columns){calls.push({table,columns});return query;},order(){return query;},limit(){return Promise.resolve({data:table==='enterprise_inventory_lots'?[{
  id:'lot-1',sku_key:'fixture-sku',lot_number:'L1',status:'quarantine',on_hand:10,reserved:0,damaged:0
 }]:[],error:null});}};return query;}};
 const result=await loadInventory(db);
 assert.equal(calls.length,2);
 assert.equal(result.lots[0].available_for_review,0);
 assert.equal(result.lots[0].can_sell,false);
 assert.equal(result.can_sell,false);
 assert.equal(JSON.stringify(result).includes('storage_object_key'),false);
 assert.equal(JSON.stringify(result).includes('customer_email'),false);
});
test('standalone inventory uses shared auth without storefront or supplier integration',()=>{
 const html=fs.readFileSync(path.join(root,'admin-inventory.html'),'utf8');
 const js=fs.readFileSync(path.join(root,'admin-inventory.js'),'utf8');
 assert.match(html,/src=["']\/admin-auth\.js/);
 assert.match(js,/PureAdminAuth/);
 assert.match(js,/\/api\/customer-config\?inventory/);
 assert.doesNotMatch(js,/\/api\/(?:admin-suppliers|admin-orders|checkout)\b|\/api\/customer-config\?(?:commerce|checkout|lotus|partner)/);
 assert.doesNotMatch(html,/src=["'][^"']*(?:products|cart|checkout)[^"']*["']/);
 assert.doesNotMatch(js,/x-admin-password/);
 assert.doesNotMatch(js,/localStorage|sessionStorage|innerHTML\s*=/);
});

test('legacy supplier intake remains authenticated and disconnected from standalone inventory',async()=>{
 const previous=process.env.ADMIN_ORDERS_PASSWORD;
 process.env.ADMIN_ORDERS_PASSWORD='fixture-admin-password-that-is-long-enough-123';
 try{
  const res=response();
  await adminHandler({method:'POST',url:'/api/admin-suppliers',
   headers:{'content-type':'application/json'},
   body:{action:'preview_inventory_import',rows:[]}},res);
  assert.equal(res.code,401);
 }finally{if(previous===undefined)delete process.env.ADMIN_ORDERS_PASSWORD;else process.env.ADMIN_ORDERS_PASSWORD=previous;}
 const source=fs.readFileSync(path.join(root,'api/admin-suppliers.js'),'utf8');
 const ui=fs.readFileSync(path.join(root,'admin-inventory.js'),'utf8');
 assert.match(source,/preview_inventory_import/);
 assert.match(source,/normalizeInventoryIntake/);
 assert.match(source,/inventoryIntake\(inventoryDb\(\), body\.rows, commit\)/);
 assert.doesNotMatch(ui,/preview_inventory_import|commit_inventory_intake|inventoryIntake/);
 assert.doesNotMatch(ui,/localStorage|sessionStorage|innerHTML\s*=/);
});
