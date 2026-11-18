'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
const source=fs.readFileSync('admin-fulfillment.js','utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const id='00000000-0000-4000-8000-000000000091';
function fixture(status='accepted',overrides={}){
 const row={id,source:'commerce',kind:'goods',commerce_status:status,payment_status:status==='accepted'?'pending':'paid',order_number:'ORD-TEST91',customer_name:'Fixture customer',customer_email:'fixture@example.test',total_cents:12255,currency:'USD',created_at:'2026-11-16T06:27:25Z'};
 const order={...row,status,version:7,checkout_version:2,method_id:'wire-us',pricing:{lines:[{name:'BPC-157',size:'10mg',qty:4,line_total_cents:10800}]},request_data:{items:[{id:'bpc-157',size:'10mg',qty:4}],address:{line1:'123 Example Street',city:'Miami',region:'FL',postal_code:'33101',country:'US'}},tracking_carrier:status==='shipped'?'UPS':'',tracking_number:status==='shipped'?'TRACK-EXISTING':''};
 return{row,detail:{order,allocations:[],jobs:[],mappings:[],supplier_enabled:false,manual_payment_allowed:false,history:[],...overrides}};
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
function manual(status='pending'){return[{variant_key:'bpc-157|10mg',route:'manual',supplier_name:'99Purity Peptides',status,version:4},{variant_key:'ghk-cu|50mg',route:'manual',supplier_name:'99Purity Peptides',status,version:3}]}

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
test('generic fulfillment sheets use the authenticated API wrapper with blob responses and no writes',async t=>{
 const ctx=await setup(t,fixture());await ctx.button('Download PDF').onclick();await ctx.button('Download CSV').onclick();
 assert.equal(ctx.writes().length,0);assert.equal(ctx.objectURLs.length,2);assert.deepEqual(ctx.downloads.map(d=>d.name),['fulfillment-ORD-TEST91.pdf','fulfillment-ORD-TEST91.csv']);
 const exports=ctx.calls.filter(c=>c.options?.responseType==='blob');assert.equal(exports.length,2);for(const c of exports){const url=new URL(c.url,'https://altapurelabs.com');assert.equal(url.pathname,'/api/admin-orders');assert.equal(url.searchParams.get('view'),'fulfillment-sheet');assert.equal(url.searchParams.get('source'),'commerce');assert.equal(url.searchParams.get('id'),id)}assert.match(ctx.w.document.querySelector('.uc-export').textContent,/HOLD \/ DO NOT SHIP/);assert.equal(ctx.w.document.querySelector('.uc-export h4').textContent,'Fulfillment sheet');assert.doesNotMatch(ctx.w.document.querySelector('.uc-export').textContent,/99Purity|Lotus|supplier/i);
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
test('historical integration orders cannot offer a duplicate manual shipment',async t=>{
 const allocations=[{variant_key:'bpc-157|10mg',route:'lotus',supplier_name:'Lotus',status:'pending',version:1}],jobs=[{supplier_id:'lotus-fixture',status:'submitted',provider_status:'owed',reference:'ALTA-FIXTURE',has_payload:true}];
 const pending=await setup(t,fixture('processing',{allocations,jobs}));assert.equal(pending.form('Update complete order'),undefined);assert.equal(pending.form('Correct shipment tracking'),undefined);assert.equal(pending.form('Send shipping label to Lotus'),undefined);assert.doesNotMatch(pending.w.document.querySelector('dialog').textContent,/Update line ·/);
 const shipped=await setup(t,fixture('shipped',{allocations:[{...allocations[0],status:'shipped'}],jobs:[{...jobs[0],status:'shipped',provider_status:'shipped'}]}));assert.equal(shipped.form('Correct shipment tracking'),undefined);assert.deepEqual([...shipped.form('Update complete order').elements.namedItem('status').options].map(o=>o.value),['delivered']);
});
test('historical supplier data remains hidden while duplicate shipment controls stay blocked',async t=>{
 const ctx=await setup(t,fixture('processing',{supplier_enabled:true,allocations:[{variant_key:'bpc-157|10mg',route:'lotus',status:'pending',version:1}],jobs:[{supplier_id:'lotus-fixture',status:'submitted',provider_status:'paid',reference:'ALTA-FIXTURE',has_payload:true}]}));
 const text=ctx.w.document.querySelector('dialog').textContent;
 assert.equal(ctx.w.document.querySelector('.uc-supplier'),null);assert.doesNotMatch(text,/Previous supplier record|ALTA-FIXTURE|99Purity|Lotus/i);assert.match(text,/existing fulfillment record needs review/i);assert.match(text,/Fulfillment has already started/);
 for(const label of ['Check Lotus availability & cost','Attach label to Lotus order','Assign complete order to Lotus','Retry Lotus job','Request supplier cancellation'])assert.equal(ctx.button(label),undefined,label);
 assert.equal(ctx.form('Assign complete order to 99Purity Peptides'),undefined);assert.equal(ctx.form('Update complete order'),undefined);assert.equal(ctx.writes().length,0);
});
test('activity history treats notes, references and actor names as text',async t=>{
 const payload='<img src=x onerror="window.INJECTED=1">',ctx=await setup(t,fixture('paid',{history:[{action:'payment_received',actor:payload,note:payload,reference:payload,from:'accepted',to:'paid',created_at:'2026-11-16T07:00:00Z'}]}));
 const history=[...ctx.w.document.querySelectorAll('details.uc-history')].find(x=>x.querySelector('summary')?.textContent==='Activity history');assert.ok(history);assert.match(history.textContent,/Activity history/);assert.ok(history.textContent.includes(payload));assert.equal(history.querySelector('img'),null);assert.equal(ctx.w.INJECTED,undefined);assert.match(history.textContent,/Awaiting payment → Paid/);
});
test('supplier assignment history uses a generic summary while retaining ordinary order history',async t=>{
 const ctx=await setup(t,fixture('paid',{history:[
  {action:'fulfillment_assign',actor:'Lotus worker',note:'Send full order to 99Purity Peptides',reference:'99P-SUPPLIER-123',created_at:'2026-11-16T07:00:00Z'},
  {action:'lotus_manual_takeover',actor:'Lotus',note:'Lotus cancellation was confirmed',reference:'LOTUS-123',created_at:'2026-11-16T07:01:00Z'},
  {action:'edit_shipping',actor:'admin',note:'Apartment number corrected',created_at:'2026-11-16T07:02:00Z'},
  {action:'payment_received',actor:'admin',reference:'BANK-ORDER-123',from:'accepted',to:'paid',created_at:'2026-11-16T07:03:00Z'}
 ]}));
 const history=[...ctx.w.document.querySelectorAll('details.uc-history')].find(x=>x.querySelector('summary')?.textContent==='Activity history');
 assert.equal(history.querySelectorAll('.uc-history-item').length,4);assert.match(history.textContent,/Fulfillment record updated/);assert.match(history.textContent,/Apartment number corrected/);assert.match(history.textContent,/BANK-ORDER-123/);assert.match(history.textContent,/Awaiting payment → Paid/);assert.doesNotMatch(history.textContent,/99Purity|Lotus|99P-SUPPLIER-123/i);assert.equal(ctx.writes().length,0);
});
function apiWrapper(fetch,logout=()=>{}){const html=fs.readFileSync('admin-orders.html','utf8'),start=html.indexOf('    async function api(path, options = {}) {'),end=html.indexOf('    async function loadOrders()',start);assert.ok(start>=0&&end>start);return new Function('window','logout',html.slice(start,end)+'\nreturn api;')({PureAdminAuth:{fetch}},logout)}
test('admin API blob mode uses the shared authenticated client without forwarding responseType',async()=>{
 const blob={fixture:true};let seen;const api=apiWrapper(async(path,options)=>{seen={path,options};return{ok:true,status:200,blob:async()=>blob,json:()=>{throw Error('Do not parse a binary download as JSON')}}});
 assert.equal(await api('/api/admin-orders?view=fulfillment-sheet',{responseType:'blob',headers:{Accept:'application/pdf'}}),blob);assert.equal(seen.path,'/api/admin-orders?view=fulfillment-sheet');assert.equal(seen.options.headers.Accept,'application/pdf');assert.equal('responseType'in seen.options,false);
});
test('admin API binary download errors still enforce logout and readable JSON errors',async()=>{
 let loggedOut=false;const expired=apiWrapper(async()=>({ok:false,status:401,json:async()=>({error:'Unauthorized'})}),()=>{loggedOut=true});await assert.rejects(()=>expired('/export',{responseType:'blob'}),/Session rejected/);assert.equal(loggedOut,true);
 const rejected=apiWrapper(async()=>({ok:false,status:409,json:async()=>({error:'No physical fulfillment order'})}));await assert.rejects(()=>rejected('/export',{responseType:'blob'}),/No physical fulfillment order/);
});
test('unpaid orders keep generic preparation and payment controls without supplier panels or writes',async t=>{
 const ctx=await setup(t,fixture('accepted',{supplier_enabled:true,manual_payment_allowed:true}));
 assert.equal(ctx.w.document.querySelector('.uc-supplier'),null);assert.doesNotMatch(ctx.w.document.querySelector('dialog').textContent,/99Purity|Lotus|supplier/i);assert.match(ctx.w.document.querySelector('.uc-export').textContent,/HOLD \/ DO NOT SHIP/);
 assert.match(ctx.form('Confirm received bank payment').textContent,/Verify that the full amount has arrived/);assert.equal(ctx.form('Update complete order'),undefined);assert.equal(ctx.button('Check Lotus availability & cost'),undefined);assert.equal(ctx.writes().length,0);
});
test('stale Lotus enable flag and mappings cannot expose supplier submission actions',async t=>{
 const allocations=manual(),ctx=await setup(t,fixture('paid',{supplier_enabled:true,allocations,mappings:allocations.map(a=>({variant_key:a.variant_key,verified_at:'2026-11-11'}))}));
 const labels=[...ctx.w.document.querySelectorAll('dialog button')].map(b=>b.textContent).join(' | ');
 assert.doesNotMatch(labels,/Lotus|supplier cancellation/);assert.equal(ctx.form('Assign complete order to 99Purity Peptides'),undefined);assert.equal(ctx.w.document.querySelector('.uc-supplier'),null);assert.doesNotMatch(ctx.w.document.querySelector('dialog').textContent,/99Purity|Lotus|supplier/i);assert.equal(ctx.writes().length,0);
});
test('confirmed previous cancellation allows complete manual shipment without restoring supplier assignment',async t=>{
 const ctx=await setup(t,fixture('processing',{allocations:manual().map(a=>({...a,supplier_name:'Previous supplier'})),jobs:[{supplier_id:'old-lotus',reference:'OLD-LOTUS',has_payload:true,status:'cancelled',provider_status:'cancelled',takeover_requested:true}],mappings:[{variant_key:'bpc-157|10mg',verified_at:'2026-11-11'},{variant_key:'ghk-cu|50mg',verified_at:'2026-11-11'}]}));
 const f=ctx.form('Update complete order');assert.ok(f,'Manual dispatch should remain manageable after confirmed supplier cancellation');assert.deepEqual([...f.elements.namedItem('status').options].map(o=>o.value),['shipped']);assert.equal(ctx.form('Assign complete order to 99Purity Peptides'),undefined);assert.equal(ctx.form('Route complete order to Lotus'),undefined);assert.equal(ctx.form('Edit shipping address'),undefined);assert.doesNotMatch(ctx.w.document.querySelector('dialog').textContent,/Previous supplier|OLD-LOTUS|99Purity/i);
});
test('manual fulfillment with no named supplier can record actual dispatch with tracking',async t=>{
 const ctx=await setup(t,fixture('processing',{allocations:manual().map(a=>({...a,supplier_name:''}))})),f=ctx.form('Update complete order');assert.ok(f);assert.deepEqual([...f.elements.namedItem('status').options].map(o=>o.value),['shipped']);assert.doesNotMatch(ctx.w.document.querySelector('dialog').textContent,/assign.*supplier/i);
 field(f,'carrier','Canada Post');field(f,'tracking','CA-FIXTURE-123');field(f,'note','All items packed and dispatched');await submit(f);assert.deepEqual(ctx.writes(),[{action:'update_order',id,version:7,status:'shipped',note:'All items packed and dispatched',tracking_carrier:'Canada Post',tracking_number:'CA-FIXTURE-123'}]);
});
