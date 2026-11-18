'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom'),{unifiedAdminOrders}=require('../lib/admin-order-query');
const uuid=n=>'b1000000-0000-4000-8000-'+String(n).padStart(12,'0'),member=uuid(999),tick=()=>new Promise(resolve=>setImmediate(resolve));
function order(n,extra={}){return{id:uuid(n),created_at:'2026-11-18T12:00:00Z',customer_name:'Fixture customer',customer_email:'fixture@example.test',kind:'goods',status:'paid',
 total_cents:10000,currency:'USD',request_data:{items:[{id:'fixture',name:'Fixture product',size:'5mg',qty:1}],address:{country:'CA'}},...extra};}
function database(rows){const reads=[];return{reads,from(table){return{select(columns){reads.push({table,columns});return this;},order(){return this;},range:async(start,end)=>({data:(table==='commerce_invoices'?rows:[]).slice(start,end+1)})};}};}

test('paid and processing PURE BLACK jobs precede the rest of the queue before pagination',async()=>{
 const rows=Array.from({length:30},(_,n)=>order(n,{created_at:'2026-11-18T12:'+String(n).padStart(2,'0')+':00Z'}));
 rows.push(order(40,{created_at:'2026-11-15T12:00:00Z',priority_fulfillment:true,membership_invoice_id:member,status:'processing'}));
 rows.push(order(41,{created_at:'2026-11-16T12:00:00Z',priority_fulfillment:true,membership_invoice_id:member}));
 const db=database(rows),before=JSON.stringify(rows),result=await unifiedAdminOrders(db,new URLSearchParams({status:'all',sort:'fulfillment_priority',page_size:'1'}));
 assert.equal(result.orders[0].id,uuid(40));assert.equal(result.orders[0].priority,'high');assert.equal(result.orders[0].priority_fulfillment,true);assert.equal(result.orders[0].membership_invoice_id,member);
 assert.equal(result.pagination.total,32);assert.equal(result.pagination.has_next,true);
 const second=await unifiedAdminOrders(db,new URLSearchParams({status:'all',sort:'fulfillment_priority',page_size:'1',page:'2'}));assert.equal(second.orders[0].id,uuid(41));
 const third=await unifiedAdminOrders(db,new URLSearchParams({status:'all',sort:'fulfillment_priority',page_size:'1',page:'3'}));assert.equal(third.orders[0].id,uuid(29));
 assert.equal(JSON.stringify(rows),before,'Priority ordering must not mutate the saved orders');
 const selected=db.reads.find(read=>read.table==='commerce_invoices').columns;assert.match(selected,/priority_fulfillment/);assert.match(selected,/membership_invoice_id/);
});

test('unpaid, canceled, refunded, dispatched and user-supplied flags cannot promote a fulfillment job',async()=>{
 const invalid=[{status:'accepted'},{status:'void'},{status:'refunded'},{status:'shipped'},{status:'delivered'},
  {cancellation_status:'pending'},{cancellation_requested_at:'2026-11-18T11:00:00Z'},{kind:'membership',plan:'elite'},
  {membership_invoice_id:null},{membership_invoice_id:'forged'},{priority_fulfillment:'true'},
  {priority_fulfillment:false,request_data:{priority_fulfillment:true,membership_invoice_id:member,plan:'elite',items:[]}}];
 const rows=invalid.map((patch,n)=>order(n,{priority_fulfillment:true,membership_invoice_id:member,...patch}));
 rows.push(order(50,{created_at:'2026-01-01T00:00:00Z',priority_fulfillment:true,membership_invoice_id:member}));
 const result=await unifiedAdminOrders(database(rows),new URLSearchParams({status:'all',sort:'fulfillment_priority'}));
 assert.equal(result.orders[0].id,uuid(50));assert.equal(result.orders.filter(row=>row.priority==='high').length,1);
 const filtered=await unifiedAdminOrders(database(rows),new URLSearchParams({status:'all',priority:'high'}));assert.deepEqual(filtered.orders.map(row=>row.id),[uuid(50)]);
});

test('explicit date and amount sorts remain available alongside priority ordering',async()=>{
 const rows=[order(1,{created_at:'2026-01-01T00:00:00Z',total_cents:100,priority_fulfillment:true,membership_invoice_id:member}),order(2,{total_cents:99999})];
 for(const sort of ['newest','highest_total'])assert.equal((await unifiedAdminOrders(database(rows),new URLSearchParams({status:'all',sort}))).orders[0].id,uuid(2));
 assert.equal((await unifiedAdminOrders(database(rows),new URLSearchParams({status:'all',sort:'oldest'}))).orders[0].id,uuid(1));
});

test('admin hub defaults to priority and shows trusted PURE BLACK badges without supplier controls',async t=>{
 const rows=(await unifiedAdminOrders(database([order(1,{priority_fulfillment:true,membership_invoice_id:member}),order(2,{status:'accepted',priority_fulfillment:true,membership_invoice_id:member}),order(3,{priority_fulfillment:false,request_data:{priority_fulfillment:true,items:[]}})]),new URLSearchParams({status:'all',sort:'fulfillment_priority'}))).orders;
 const dom=new JSDOM('<div class="ap-workspace"><div id="fulfillment-hub"></div></div>',{url:'https://getpurelabs.com/admin-orders.html',runScripts:'outside-only'}),w=dom.window,calls=[];
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.eval(fs.readFileSync('admin-fulfillment.js','utf8'));t.after(()=>{w.AltaFulfillment.clear();dom.window.close();});
 w.AltaFulfillment.mount(async(url)=>{calls.push(url);if(url.includes('view=detail'))return{order:{...rows[0],status:'paid',version:1,request_data:{items:[]}},allocations:[],jobs:[],history:[]};return{orders:rows,pagination:{total:3,has_previous:false,has_next:false}};});
 await tick();assert.equal(new URL(calls[0],'https://getpurelabs.com').searchParams.get('sort'),'fulfillment_priority');
 assert.equal(w.document.querySelector('[aria-label="Sort orders"]').value,'fulfillment_priority');
 assert.equal(w.document.querySelectorAll('.uc-order-row .uc-priority-badge').length,1);assert.equal(w.document.querySelector('.uc-priority-badge').textContent,'PURE BLACK / Priority');
 assert.ok([...w.document.querySelector('[aria-label="Filter order type"]').options].some(option=>option.value==='membership'));
 w.document.querySelector('.uc-order-row button').click();await tick();assert.equal(w.document.querySelector('dialog .uc-priority-badge').textContent,'PURE BLACK / Priority');
 assert.doesNotMatch(w.document.querySelector('dialog').textContent,/Assign.*supplier|Submit.*supplier|Lotus|99Purity/i);
});
