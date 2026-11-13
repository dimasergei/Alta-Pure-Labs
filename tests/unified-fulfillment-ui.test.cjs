const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),{JSDOM}=require('jsdom');
const source=fs.readFileSync('admin-fulfillment.js','utf8'),tick=()=>new Promise(r=>setImmediate(r));
test('single Manage order screen shows checkout orders and safe cancellation without legacy Lotus links',async()=>{
 const dom=new JSDOM('<div id="fulfillment-hub"></div>',{url:'https://altapurelabs.com/admin-orders.html',runScripts:'outside-only'});
 const w=dom.window;w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false};w.confirm=()=>true;
 w.eval(source);
 const id='00000000-0000-4000-8000-000000000001',order={id,kind:'goods',version:1,customer_name:'<img src=x>',customer_email:'fixture@example.test',total_cents:10000,subtotal_cents:8500,shipping_cents:1500,discount_cents:0,currency:'USD',status:'accepted',created_at:new Date().toISOString(),pricing:{lines:[{name:'Fixture',size:'5mg',qty:2,line_total_cents:8500}]},request_data:{items:[],address:{country:'US'}}};
 const calls=[];
 w.AltaFulfillment.mount(async(url,options)=>{calls.push({url,options});return options?.body?{status:'void'}:url.includes('view=detail')?{order,allocations:[],jobs:[]}:{orders:[order],has_more:false}});
 await tick();assert.match(w.document.body.textContent,/AP0000000000/);assert.match(w.document.body.textContent,/Manage order/);
 assert.equal(w.document.querySelector('img'),null);
 const manage=[...w.document.querySelectorAll('button')].find(b=>b.textContent==='Manage order');assert.ok(manage);manage.click();await tick();
 assert.match(w.document.querySelector('dialog').textContent,/Fixture · 5mg/);
 assert.match(w.document.querySelector('dialog').textContent,/Cancel unpaid order/);
 assert.doesNotMatch(w.document.querySelector('dialog').textContent,/Lotus|Advanced|Payment desk/);
 const cancel=[...w.document.querySelectorAll('dialog button')].find(b=>b.textContent==='Cancel unpaid order');
 await cancel.onclick();assert.equal(calls.filter(c=>c.options?.body&&JSON.parse(c.options.body).action==='cancel_order').length,1);
 w.AltaFulfillment.clear();assert.equal(w.document.querySelector('dialog'),null);dom.window.close();
});
