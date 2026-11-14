'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
const source=fs.readFileSync('admin-fulfillment.js','utf8'),tick=()=>new Promise(r=>setImmediate(r));
test('per-order Manage Order displays Lotus exceptions and safely escapes customer text',async()=>{
 const dom=new JSDOM('<div id="fulfillment-hub"></div><div id="orders-list"></div>',{url:'https://altapurelabs.com/admin-orders.html',runScripts:'outside-only'});
 const w=dom.window;w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false};w.eval(source);
 const id='00000000-0000-4000-8000-000000000001',order={id,kind:'goods',customer_name:'<img src=x>',customer_email:'fixture@example.test',total_cents:10000,currency:'USD',status:'paid',created_at:new Date().toISOString(),request_data:{items:[{id:'fixture',name:'Fixture',size:'5mg',qty:2},{id:'other',name:'Other',size:'5mg',qty:1}],address:{country:'US',region:'FL',postal_code:'33101'}}};
 const allocations=[{invoice_id:id,variant_key:'fixture|5mg',item:{name:'Fixture',size:'5mg',qty:2},route:'lotus',supplier_name:'Lotus',status:'ordered',version:1},{invoice_id:id,variant_key:'other|5mg',item:{name:'Other',size:'5mg',qty:1},route:'manual',supplier_name:'',status:'pending',version:1}];
 const jobs=[{invoice_id:id,status:'blocked',last_error:'stock_unavailable',reference:'ALTA-'+id}];
 w.AltaFulfillment.mount(async()=>({order,allocations,jobs,mappings:[{variant_key:'fixture|5mg',product:1,vials:1,verified_at:'2026-11-14'}],supplier_enabled:true}));
 await w.AltaFulfillment.manage(id);await tick();
 assert.match(w.document.querySelector('dialog').textContent,/stock_unavailable/);
 assert.match(w.document.querySelector('dialog').textContent,/Other · 5mg/);
 assert.match(w.document.querySelector('dialog').textContent,/Cancel Lotus/);
 assert.equal(w.document.querySelector('img'),null);
 w.AltaFulfillment.clear();assert.equal(w.document.querySelector('dialog'),null);dom.window.close();
});
test('logout discards a delayed Manage Order detail response',async()=>{
 const dom=new JSDOM('<div id="fulfillment-hub"></div>',{runScripts:'outside-only'}),w=dom.window;w.eval(source);
 let resolve;w.AltaFulfillment.mount(()=>new Promise(r=>{resolve=r}));
 const request=w.AltaFulfillment.manage('00000000-0000-4000-8000-000000000001');
 w.AltaFulfillment.clear();resolve({order:{id:'00000000-0000-4000-8000-000000000001'},allocations:[],jobs:[],mappings:[]});
 await request;assert.equal(w.document.querySelector('dialog'),null);dom.window.close();
});
