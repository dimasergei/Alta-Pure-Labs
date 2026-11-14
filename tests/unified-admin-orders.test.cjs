'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {unifiedAdminOrders}=require('../lib/admin-order-query');
const store=[{id:'11111111-1111-1111-1111-111111111111',created_at:'2026-11-13T00:00:00Z',customer_name:'Legacy',customer_email:'legacy@example.test',payment_status:'paid',fulfillment_status:'unfulfilled',priority:'normal',archived:false,total_cents:1000,store_order_items:[]}];
const invoices=[{id:'22222222-2222-2222-2222-222222222222',created_at:'2026-11-14T00:00:00Z',customer_name:'Commerce',customer_email:'commerce@example.test',status:'paid',kind:'goods',total_cents:2000,currency:'USD',request_data:{address:{country:'US',region:'FL',postal_code:'33101'},items:[{id:'a',name:'A',size:'10mg',qty:1}]}}];
function db(){return{from(name){let rows=name==='store_orders'?store:invoices;return{select(){return this},order(){return this},async range(a,b){return{data:rows.slice(a,b+1),error:null}}}}}}
function params(p){return new URLSearchParams(p)}
test('unified results sort newest and preserve both ledgers',async()=>{const x=await unifiedAdminOrders(db(),params({status:'all'}));assert.equal(x.pagination.total,2);assert.deepEqual(x.orders.map(o=>o.source),['commerce','store']);});
test('pagination includes commerce in total and next flag',async()=>{const x=await unifiedAdminOrders(db(),params({status:'all',page_size:'1'}));assert.equal(x.orders.length,1);assert.equal(x.pagination.total,2);assert.equal(x.pagination.has_next,true);const y=await unifiedAdminOrders(db(),params({status:'all',page_size:'1',page:'2'}));assert.equal(y.orders[0].source,'store');});
test('search finds commerce customer',async()=>{const x=await unifiedAdminOrders(db(),params({status:'all',search:'commerce@example.test'}));assert.equal(x.pagination.total,1);assert.equal(x.orders[0].source,'commerce');});
test('CSV-compatible commerce item fields are normalized',async()=>{const x=await unifiedAdminOrders(db(),params({status:'all'}));assert.equal(x.orders[0].store_order_items[0].product_name,'A');});
test('active paid view contains both sources',async()=>{const x=await unifiedAdminOrders(db(),params({status:'active'}));assert.equal(x.pagination.total,2);});
test('oldest sorting works across both sources',async()=>{const x=await unifiedAdminOrders(db(),params({status:'all',sort:'oldest'}));assert.equal(x.orders[0].source,'store');});
