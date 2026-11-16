'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
const source=fs.readFileSync('admin-fulfillment.js','utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const id='00000000-0000-4000-8000-000000000091';
function fixture(status='accepted',overrides={}){
 const row={id,source:'commerce',kind:'goods',commerce_status:status,payment_status:status==='accepted'?'pending':'paid',order_number:'ORD-TEST91',customer_name:'Fixture customer',customer_email:'fixture@example.test',total_cents:12255,currency:'USD',created_at:'2026-11-16T06:27:25Z'};
 const order={...row,status,version:7,checkout_version:2,method_id:'wire-us',pricing:{lines:[{name:'BPC-157',size:'10mg',qty:4,line_total_cents:10800}]},request_data:{items:[{id:'bpc-157',size:'10mg',qty:4}],address:{line1:'123 Example Street',city:'Miami',region:'FL',postal_code:'33101',country:'US'}},tracking_carrier:status==='shipped'?'UPS':'',tracking_number:status==='shipped'?'TRACK-EXISTING':''};
 return{row,detail:{order,allocations:[],jobs:[],mappings:[],supplier_enabled:true,manual_payment_allowed:false,history:[],...overrides}};
}
async function setup(t,{row,detail},writeImpl){
 const dom=new JSDOM('<p id="orders-message"></p><div id="fulfillment-hub"></div>',{url:'https://altapurelabs.com/admin-orders.html',runScripts:'outside-only'}),w=dom.window,calls=[],downloads=[],objectURLs=[];
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false};w.confirm=()=>true;
 w.URL.createObjectURL=blob=>{objectURLs.push(blob);return'blob:fixture-'+objectURLs.length};w.URL.revokeObjectURL=()=>{};
 w.HTMLAnchorElement.prototype.click=function(){downloads.push({name:this.download,href:this.href})};
 w.eval(source);w.AltaFulfillment.mount(async(url,options)=>{calls.push({url,options});if(options?.body)return writeImpl?writeImpl(JSON.parse(options.body),calls):{saved:true};if(options?.responseType==='blob')return new w.Blob(['fixture document']);if(url.includes('view=detail'))return detail;return{orders:[row],pagination:{page:1,total:1}}});
 t.after(()=>{w.AltaFulfillment.clear();w.close()});await tick();await w.AltaFulfillment.manage(row);
 return{w,calls,downloads,objectURLs,form:title=>[...w.document.querySelectorAll('dialog form')].find(f=>f.querySelector('h4')?.textContent===title),button:title=>[...w.document.querySelectorAll('dialog button')].find(b=>b.textContent===title),writes:()=>calls.filter(c=>c.options?.body).map(c=>JSON.parse(c.options.body))};
}
const submit=f=>f.onsubmit({preventDefault(){}});
const field=(f,name,value)=>{f.elements.namedItem(name).value=value};
function manual(status='pending'){return[{variant_key:'bpc-157|10mg',route:'manual',supplier_name:'Example supplier',status,version:4},{variant_key:'ghk-cu|50mg',route:'manual',supplier_name:'Example supplier',status,version:3}]}

test('received-payment control requires server permission, not merely an unpaid invoice',async t=>{
 const denied=await setup(t,fixture());assert.equal(denied.form('Confirm received bank payment'),undefined);assert.match(denied.w.document.querySelector('dialog').textContent,/Awaiting confirmed payment/);
 const allowed=await setup(t,fixture('accepted',{manual_payment_allowed:true,payment_method:{label:'US wire'}}));const f=allowed.form('Confirm received bank payment');assert.ok(f);assert.match(f.textContent,/\$122\.55/);assert.match(f.textContent,/US wire/);assert.equal(f.querySelector('input[type=checkbox]').required,true);
});
test('payment action verifies confirmation and retains receipt across a failed retry',async t=>{
 let attempts=0;const ctx=await setup(t,fixture('accepted',{manual_payment_allowed:true}),()=>{attempts++;if(attempts===1)throw Error('Temporary connection failure');return{saved:true}}),f=ctx.form('Confirm received bank payment');field(f,'bank_reference','BANK-EXAMPLE-123');
 await submit(f);assert.equal(ctx.writes().length,0);assert.match(ctx.w.document.querySelector('[data-unified-message]').textContent||ctx.w.document.querySelector('dialog').textContent,/Verify received funds first/);
 f.querySelector('input[type=checkbox]').checked=true;ctx.w.confirm=()=>false;await submit(f);assert.equal(ctx.writes().length,0);
 ctx.w.confirm=()=>true;await submit(f);await submit(f);const writes=ctx.writes();assert.equal(writes.length,2);assert.equal(writes[0].receipt_id,writes[1].receipt_id);assert.match(writes[0].receipt_id,/^[0-9a-f-]{36}$/i);
 assert.deepEqual({...writes[0],receipt_id:undefined},{action:'record_payment',id,expected_version:7,method_id:'wire-us',receipt_id:undefined,external_reference:'BANK-EXAMPLE-123',confirm_funds_received:true});
});
test('separately opened payment forms use independent receipt identifiers',async t=>{
 const ctx=await setup(t,fixture('accepted',{manual_payment_allowed:true}),()=>{throw Error('Fixture failure')});let f=ctx.form('Confirm received bank payment');field(f,'bank_reference','BANK-FIRST');f.querySelector('[type=checkbox]').checked=true;await submit(f);
 await ctx.w.AltaFulfillment.manage(fixture().row);f=ctx.form('Confirm received bank payment');field(f,'bank_reference','BANK-SECOND');f.querySelector('[type=checkbox]').checked=true;await submit(f);
 assert.notEqual(ctx.writes()[0].receipt_id,ctx.writes()[1].receipt_id);
});
test('supplier sheets use the authenticated API wrapper with blob responses and no writes',async t=>{
 const ctx=await setup(t,fixture());await ctx.button('Download PDF').onclick();await ctx.button('Download CSV').onclick();
 assert.equal(ctx.writes().length,0);assert.equal(ctx.objectURLs.length,2);assert.deepEqual(ctx.downloads.map(d=>d.name),['fulfillment-ORD-TEST91.pdf','fulfillment-ORD-TEST91.csv']);
 const exports=ctx.calls.filter(c=>c.options?.responseType==='blob');assert.equal(exports.length,2);for(const c of exports){const url=new URL(c.url,'https://altapurelabs.com');assert.equal(url.pathname,'/api/admin-orders');assert.equal(url.searchParams.get('view'),'fulfillment-sheet');assert.equal(url.searchParams.get('source'),'commerce');assert.equal(url.searchParams.get('id'),id)}assert.match(ctx.w.document.querySelector('.uc-export').textContent,/HOLD \/ DO NOT SHIP/);
});
test('manual shipment is a complete-order transition and refuses blank tracking',async t=>{
 const ctx=await setup(t,fixture('paid',{allocations:manual()})),f=ctx.form('Update complete order');assert.ok(f);assert.deepEqual([...f.elements.namedItem('status').options].map(o=>o.value),['processing','shipped']);assert.doesNotMatch(ctx.w.document.querySelector('dialog').textContent,/Update line ·|Save line status/);
 field(f,'status','shipped');field(f,'note','Shipment handed to carrier');await submit(f);assert.equal(ctx.writes().length,0);
 field(f,'carrier','UPS');field(f,'tracking','1Z-FIXTURE-123');await submit(f);assert.deepEqual(ctx.writes()[0],{action:'update_order',id,version:7,status:'shipped',note:'Shipment handed to carrier',tracking_carrier:'UPS',tracking_number:'1Z-FIXTURE-123'});
});
test('shipped manual order supports delivery and tracking correction separately',async t=>{
 const ctx=await setup(t,fixture('shipped',{allocations:manual('shipped')}));let f=ctx.form('Correct shipment tracking');assert.ok(f);field(f,'carrier','UPS');field(f,'tracking','1Z-CORRECTED-456');field(f,'note','Correct transposed tracking number');await submit(f);
 assert.deepEqual(ctx.writes()[0],{action:'update_tracking',id,version:7,tracking_carrier:'UPS',tracking_number:'1Z-CORRECTED-456',note:'Correct transposed tracking number'});
 f=ctx.form('Update complete order');assert.deepEqual([...f.elements.namedItem('status').options].map(o=>o.value),['delivered']);field(f,'note','Delivery confirmed by carrier');await submit(f);assert.equal(ctx.writes()[1].action,'update_order');assert.equal(ctx.writes()[1].status,'delivered');
});
test('Lotus controls never offer manual shipment before synced shipping',async t=>{
 const allocations=[{variant_key:'bpc-157|10mg',route:'lotus',supplier_name:'Lotus',status:'pending',version:1}],jobs=[{supplier_id:'lotus-fixture',status:'submitted',provider_status:'owed',reference:'ALTA-FIXTURE',has_payload:true}];
 const pending=await setup(t,fixture('processing',{allocations,jobs}));assert.equal(pending.form('Update complete order'),undefined);assert.equal(pending.form('Correct shipment tracking'),undefined);assert.equal(pending.form('Send shipping label to Lotus'),undefined);assert.doesNotMatch(pending.w.document.querySelector('dialog').textContent,/Update line ·/);
 const shipped=await setup(t,fixture('shipped',{allocations:[{...allocations[0],status:'shipped'}],jobs:[{...jobs[0],status:'shipped',provider_status:'shipped'}]}));assert.equal(shipped.form('Correct shipment tracking'),undefined);assert.deepEqual([...shipped.form('Update complete order').elements.namedItem('status').options].map(o=>o.value),['delivered']);
});
test('Lotus label action appears only after supplier payment and sends exact label data',async t=>{
 const ctx=await setup(t,fixture('processing',{allocations:[{variant_key:'bpc-157|10mg',route:'lotus',status:'pending',version:1}],jobs:[{supplier_id:'lotus-fixture',status:'submitted',provider_status:'paid',reference:'ALTA-FIXTURE',has_payload:true}]})),f=ctx.form('Send shipping label to Lotus');assert.ok(f);field(f,'label_url','https://ship.pirateship.com/fixture');field(f,'tracking','1Z-EXAMPLE-999');await submit(f);assert.deepEqual(ctx.writes()[0],{action:'label',id,url:'https://ship.pirateship.com/fixture',tracking:'1Z-EXAMPLE-999'});
});
test('activity history treats notes, references and actor names as text',async t=>{
 const payload='<img src=x onerror="window.INJECTED=1">',ctx=await setup(t,fixture('paid',{history:[{action:'payment_received',actor:payload,note:payload,reference:payload,from:'accepted',to:'paid',created_at:'2026-11-16T07:00:00Z'}]}));
 const history=[...ctx.w.document.querySelectorAll('details.uc-history')].find(x=>x.querySelector('summary')?.textContent==='Activity history');assert.ok(history);assert.match(history.textContent,/Activity history/);assert.ok(history.textContent.includes(payload));assert.equal(history.querySelector('img'),null);assert.equal(ctx.w.INJECTED,undefined);assert.match(history.textContent,/Awaiting payment → Paid/);
});
function apiWrapper(fetch,logout=()=>{}){const html=fs.readFileSync('admin-orders.html','utf8'),start=html.indexOf('    async function api(path, options = {}) {'),end=html.indexOf('    async function loadOrders()',start);assert.ok(start>=0&&end>start);return new Function('fetch','adminPassword','logout',html.slice(start,end)+'\nreturn api;')(fetch,'fixture-secret',logout)}
test('admin API blob mode keeps authentication and never passes responseType to fetch',async()=>{
 const blob={fixture:true};let seen;const api=apiWrapper(async(path,options)=>{seen={path,options};return{ok:true,status:200,blob:async()=>blob,json:()=>{throw Error('Do not parse a binary download as JSON')}}});
 assert.equal(await api('/api/admin-orders?view=fulfillment-sheet',{responseType:'blob',headers:{Accept:'application/pdf'}}),blob);assert.equal(seen.options.headers['x-admin-password'],'fixture-secret');assert.equal(seen.options.headers.Accept,'application/pdf');assert.equal(seen.options.cache,'no-store');assert.equal('responseType'in seen.options,false);
});
test('admin API binary download errors still enforce logout and readable JSON errors',async()=>{
 let loggedOut=false;const expired=apiWrapper(async()=>({ok:false,status:401,json:async()=>({error:'Unauthorized'})}),()=>{loggedOut=true});await assert.rejects(()=>expired('/export',{responseType:'blob'}),/Session rejected/);assert.equal(loggedOut,true);
 const rejected=apiWrapper(async()=>({ok:false,status:409,json:async()=>({error:'No physical fulfillment order'})}));await assert.rejects(()=>rejected('/export',{responseType:'blob'}),/No physical fulfillment order/);
});
test('unpaid Lotus preview displays the fresh quote without implying paid submission readiness',async t=>{
 const ctx=await setup(t,fixture(),body=>{assert.deepEqual(body,{action:'preview_lotus_order',id});return{preview_only:true,ready:false,quote_available:true,mode:'live',supplier_total_cents:12000,comparison:{comparable:true,remaining_before_other_costs_cents:255},issues:[{code:'awaiting_payment',severity:'hold',message:'Payment has not been confirmed. Supplier submission is on hold.'}]}});
 await ctx.button('Check Lotus availability & cost').onclick();const text=ctx.w.document.querySelector('.uc-preview').textContent;
 assert.match(text,/Current Lotus quote retrieved/);assert.match(text,/No order was submitted/);assert.match(text,/\$120\.00/);assert.match(text,/\$2\.55/);assert.match(text,/Payment has not been confirmed/);assert.match(text,/Before shipping labels, payment fees, tax and other costs/);assert.match(text,/not net profit/);assert.match(text,/live/);assert.equal(ctx.writes().length,1);
});
test('supplier preview does not invent a currency conversion or margin for non-comparable totals',async t=>{
 const ctx=await setup(t,fixture(),()=>({quote_available:true,ready:false,supplier_total_cents:12000,comparison:{comparable:false},issues:[{message:'Customer invoice uses CAD; no exchange-rate comparison is available.'}]}));await ctx.button('Check Lotus availability & cost').onclick();const text=ctx.w.document.querySelector('.uc-preview').textContent;assert.match(text,/\$120\.00/);assert.match(text,/Customer invoice uses CAD/);assert.doesNotMatch(text,/Revenue remaining/);
});
test('confirmed Lotus cancellation unlocks manual supplier reassignment and shipment, not resubmission',async t=>{
 const ctx=await setup(t,fixture('processing',{allocations:manual(),jobs:[{supplier_id:'old-lotus',reference:'OLD-LOTUS',has_payload:true,status:'cancelled',provider_status:'cancelled',takeover_requested:true}],mappings:[{variant_key:'bpc-157|10mg',verified_at:'2026-11-11'},{variant_key:'ghk-cu|50mg',verified_at:'2026-11-11'}]}));
 const f=ctx.form('Update complete order');assert.ok(f,'Manual dispatch should remain manageable after confirmed supplier cancellation');assert.deepEqual([...f.elements.namedItem('status').options].map(o=>o.value),['shipped']);assert.ok(ctx.form('Assign one supplier for the complete order'));assert.equal(ctx.form('Route complete order to Lotus'),undefined);assert.equal(ctx.form('Edit shipping address'),undefined);
});
test('unassigned manual fulfillment explains assignment requirement instead of offering a rejected shipment',async t=>{
 const ctx=await setup(t,fixture('processing',{allocations:manual().map(a=>({...a,supplier_name:''}))}));assert.equal(ctx.form('Update complete order'),undefined);assert.match(ctx.w.document.querySelector('dialog').textContent,/assign.*supplier/i);
});
