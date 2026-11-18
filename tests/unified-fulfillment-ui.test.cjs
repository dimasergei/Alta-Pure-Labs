'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
const source=fs.readFileSync('admin-fulfillment.js','utf8'),tick=()=>new Promise(r=>setImmediate(r));
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
function setup(rows,detail,writeResponse){
 const dom=new JSDOM('<div id="fulfillment-hub"></div>',{url:'https://altapurelabs.com/admin-orders.html',runScripts:'outside-only'});
 const w=dom.window,confirmations=[],shippingMounts=[];w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false};w.confirm=message=>{confirmations.push(message);return true};w.PureShippingLabels={mount(input){shippingMounts.push({row:input.row,host:input.host})}};w.eval(source);
 const calls=[];w.AltaFulfillment.mount(async(url,options)=>{calls.push({url,options});if(options?.body)return writeResponse?writeResponse(JSON.parse(options.body)):options.method==='PATCH'?{order:rows[0],notification:{status:'not_required'}}:{status:'void',saved:true};
  if(options?.responseType==='blob')return new w.Blob(['fixture'],{type:url.includes('format=pdf')?'application/pdf':'text/csv'});
  if(url.includes('view=detail'))return detail;
  return{orders:rows,pagination:{page:1,total:rows.length,has_previous:false,has_next:false}}});
 return{dom,w,calls,confirmations,shippingMounts};
}
test('single hub shows source-specific orders and safe unpaid cancellation',async()=>{
 const id=uuid(1),order={id,source:'commerce',kind:'goods',commerce_status:'accepted',payment_status:'pending',fulfillment_status:'unfulfilled',order_number:'ORD-00000000',version:1,customer_name:'<img src=x>',customer_email:'fixture@example.test',total_cents:10000,subtotal_cents:8500,shipping_cents:1500,discount_cents:0,currency:'USD',created_at:new Date().toISOString(),store_order_items:[]};
 const raw={...order,status:'accepted',pricing:{lines:[{name:'Fixture',size:'5mg',qty:2,line_total_cents:8500}]},request_data:{items:[],address:{country:'US'}}};
 const{dom,w,calls}=setup([order],{order:raw,allocations:[],jobs:[]});await tick();
 assert.match(w.document.body.textContent,/ORD-00000000/);assert.equal(w.document.querySelector('img'),null);
 const manage=[...w.document.querySelectorAll('button')].find(b=>b.textContent==='Manage order');manage.click();await tick();
 assert.match(w.document.querySelector('dialog').textContent,/Fixture · 5mg/);
 assert.match(w.document.querySelector('dialog').textContent,/Cancel unpaid order/);
 const cancel=[...w.document.querySelectorAll('dialog button')].find(b=>b.textContent==='Cancel unpaid order');await cancel.onclick();
 assert.equal(calls.filter(x=>x.options?.body&&JSON.parse(x.options.body).action==='cancel_order').length,1);
 w.AltaFulfillment.clear();dom.window.close();
});
test('admin accepts pending crypto cancellation and shows the hold after refresh',async()=>{
 const row={id:uuid(10),source:'commerce',kind:'goods',commerce_status:'accepted',payment_status:'pending',total_cents:950,currency:'USD',created_at:new Date().toISOString()},raw={...row,status:'accepted',request_data:{items:[]}};
 const{dom,w}=setup([row],{order:raw,allocations:[],jobs:[]},()=>{row.cancellation_status=raw.cancellation_status='pending';return{status:'accepted',cancellation_status:'pending'};});await tick();
 w.document.querySelector('.uc-order-row button').click();await tick();await [...w.document.querySelectorAll('dialog button')].find(x=>x.textContent==='Cancel unpaid order').onclick();
 const dialog=w.document.querySelector('dialog');assert.equal(dialog.open,true);assert.match(dialog.textContent,/Cancellation pending/);assert.match(dialog.textContent,/payment is checked automatically/);assert.doesNotMatch(dialog.textContent,/Cancellation was not confirmed/);
 assert.ok([...dialog.querySelectorAll('button')].some(x=>x.textContent==='Check cancellation'));
 assert.ok(![...dialog.querySelectorAll('button')].some(x=>x.textContent==='Save fulfillment status'));
 w.AltaFulfillment.clear();dom.window.close();
});
test('legacy order uses one Manage dialog and PATCH; research record is read-only',async()=>{
 const legacy={id:uuid(2),source:'store',kind:'goods',order_number:'AP-123',customer_name:'Old order',customer_email:'legacy@example.test',payment_status:'paid',fulfillment_status:'unfulfilled',supplier_status:'Lotus accepted the batch',created_at:new Date().toISOString(),total_cents:3000,currency:'USD',store_order_items:[{product_name:'Sample',variant_size:'10mg',quantity:1,unit_price_cents:3000,supplier_name:'99Purity Peptides',supplier_sku:'LOTUS-SKU',lot_number:'LOT-01',fulfillment_notes:'Send to Another Supplier'}]};
 const research={id:uuid(3),source:'research_subscription',kind:'research_subscription',customer_email:'research@example.test',research_status:'pending_payment',payment_status:'pending',created_at:new Date().toISOString(),monthly_cents:10000,total_cents:10000,currency:'USD',paid_cycles:0,lines:[]};
 const{dom,w,calls}=setup([legacy,research]);await tick();assert.match(w.document.body.textContent,/Earlier store order/);assert.match(w.document.body.textContent,/Research subscription/);
 const manage=[...w.document.querySelectorAll('button')].find(b=>b.textContent==='Manage order');manage.click();await tick();
 const dialog=w.document.querySelector('dialog');assert.doesNotMatch(dialog.textContent,/99Purity|Lotus|LOTUS-SKU|Another Supplier|Supplier status/i);assert.match(dialog.textContent,/Lot: LOT-01/);assert.equal(dialog.querySelector('[name=supplier_status]'),null);
 const save=[...w.document.querySelectorAll('dialog button')].find(b=>b.textContent==='Save order');assert.ok(save);const f=save.closest('form');f.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await tick();
 const writes=calls.filter(x=>x.options?.method==='PATCH');assert.equal(writes.length,1);assert.equal(Object.hasOwn(JSON.parse(writes[0].options.body),'supplier_status'),false);assert.equal(legacy.supplier_status,'Lotus accepted the batch');w.document.querySelector('dialog').close();
 const researchButton=[...w.document.querySelectorAll('button')].find(b=>b.textContent==='View subscription');researchButton.click();await tick();
 assert.match(w.document.querySelector('dialog').textContent,/Recurring checkout is unavailable/);assert.ok(![...w.document.querySelectorAll('dialog button')].some(b=>b.textContent.includes('Save')));
 w.AltaFulfillment.clear();dom.window.close();
});
test('membership purchase exposes refund but no shipping',async()=>{
 const membership={id:uuid(4),source:'commerce',kind:'membership',commerce_status:'paid',payment_status:'paid',fulfillment_status:'unfulfilled',order_number:'ORD-MEMBER',customer_email:'m@example.test',total_cents:1999,currency:'USD',created_at:new Date().toISOString()};
 const raw={...membership,status:'paid',plan:'vip',version:2,request_data:{address:{country:'US'},items:[]}};
 const {dom,w}=setup([membership],{order:raw,allocations:[],jobs:[]});await tick();w.document.querySelector('.uc-order-row button').click();await tick();
 const text=w.document.querySelector('dialog').textContent;assert.match(text,/Membership purchase/);assert.match(text,/Record a completed full refund/);assert.doesNotMatch(text,/Edit shipping address|Update fulfillment status|Supplier and fulfillment/);
 w.AltaFulfillment.clear();dom.window.close();
});
test('bulk order removes supplier details while preserving an existing shipment hold',async t=>{
 const row={id:uuid(5),source:'commerce',kind:'bulk',commerce_status:'paid',payment_status:'paid',fulfillment_status:'unfulfilled',order_number:'ORD-BULK',customer_email:'bulk@example.test',total_cents:60000,currency:'USD',created_at:new Date().toISOString()};
 const raw={...row,kind:'goods',status:'paid',version:1,request_data:{bulk_order:true,address:{line1:'123 Main Street',city:'Miami',region:'FL',postal_code:'33101',country:'US'},items:[{id:'a',name:'A',size:'10mg',qty:10}]}};
 const allocation={variant_key:'a|10mg',route:'lotus',supplier_name:'Lotus',status:'pending',version:1};
 const {dom,w,shippingMounts}=setup([row],{order:raw,allocations:[allocation],jobs:[{reference:'ALTA-BULK',status:'submitted',supplier_id:'remote-123',has_payload:true,last_error:'Lotus must verify'}],mappings:[],supplier_enabled:true});t.after(()=>{w.AltaFulfillment.clear();dom.window.close()});
 await tick();w.document.querySelector('.uc-order-row button').click();await tick();
 const dialog=w.document.querySelector('dialog'),text=dialog.textContent;assert.match(text,/Bulk order/);assert.match(text,/Fulfillment sheet/);assert.match(text,/Fulfillment has already started/);assert.doesNotMatch(text,/Supplier|99Purity|Lotus|ALTA-BULK|remote-123|Save address/i);assert.equal(dialog.querySelector('.uc-supplier'),null);assert.ok(![...dialog.querySelectorAll('select[name=status] option')].some(option=>option.value==='shipped'));assert.equal(shippingMounts.length,1);
});
test('paid manual orders record complete shipment without supplier assignment or branding',async t=>{
 const row={id:uuid(6),source:'commerce',kind:'bulk',commerce_status:'paid',payment_status:'paid',fulfillment_status:'unfulfilled',customer_email:'bulk@example.test',total_cents:90000,currency:'USD',created_at:new Date().toISOString()};
 const raw={...row,kind:'goods',status:'paid',version:1,request_data:{bulk_order:true,address:{line1:'123 Main Street',city:'Miami',region:'FL',postal_code:'33101',country:'US'},items:[{id:'a',name:'A',size:'10mg',qty:10},{id:'b',name:'B',size:'5mg',qty:20}]}};
 const allocations=[{variant_key:'a|10mg',route:'manual',supplier_name:'',status:'pending',version:3},{variant_key:'b|5mg',route:'manual',supplier_name:'',status:'pending',version:4}];
 const mappings=allocations.map(x=>({variant_key:x.variant_key,verified_at:'2026-11-15T00:00:00Z'}));
 const {dom,w,calls}=setup([row],{order:raw,allocations,jobs:[],mappings,supplier_enabled:true});t.after(()=>{w.AltaFulfillment.clear();dom.window.close()});await tick();w.document.querySelector('.uc-order-row button').click();await tick();
 const dialog=w.document.querySelector('dialog');assert.equal(dialog.querySelector('.uc-supplier'),null);assert.doesNotMatch(dialog.textContent,/99Purity|Lotus|supplier|Assign complete/i);
 const action=[...dialog.querySelectorAll('form')].find(f=>f.textContent.includes('Update complete order'));assert.ok(action);
 action.elements.namedItem('status').value='shipped';action.elements.namedItem('carrier').value='Canada Post';action.elements.namedItem('tracking').value='CA-TRACK-123';action.elements.namedItem('note').value='Complete order dispatched';action.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await tick();
 const writes=calls.filter(x=>x.options?.body).map(x=>JSON.parse(x.options.body));
 assert.equal(writes.length,1);assert.deepEqual(writes[0],{action:'update_order',id:row.id,version:1,status:'shipped',note:'Complete order dispatched',tracking_carrier:'Canada Post',tracking_number:'CA-TRACK-123'});assert.ok(!writes.some(write=>write.action==='assign'));
});
