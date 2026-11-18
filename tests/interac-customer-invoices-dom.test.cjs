'use strict';
// Local DOM fixtures only. No live account, recipient, invoice, or transfer.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM,VirtualConsole}=require('jsdom');
const id='44444444-4444-4444-8444-444444444444';
const receiver={kind:'interac',label:'Interac e-Transfer',payee:'PURE Fixture Receiver',instructions:'Send CAD to fixture-receiver@example.test.\nUse the order reference. <strong>Text only</strong>'};
function invoice(patch={}){
 return {id,kind:'goods',status:'issued',version:2,terms_version:'fixture-commercial-terms',currency:'CAD',subtotal_cents:28000,discount_cents:4200,shipping_cents:2500,tax_cents:3419,total_cents:29719,created_at:'2026-11-18T10:00:00Z',expires_at:new Date(Date.now()+3600000).toISOString(),payable:true,payment_snapshot:null,
  request_data:{preferred_payment:{provider_key:'interac',currency:'CAD',label:'Interac e-Transfer'},items:[{id:'compound',name:'Compound',size:'10mg',qty:2,unit_price_usd_cents:10000}]},
  pricing:{fx_ppm:1400000,lines:[{name:'Compound',size:'10mg',qty:2,line_total_cents:23800}]},...patch};
}
function fixture({record=invoice(),acceptError=null,allInvoices=null}={}){
 const dom=new JSDOM('<main id="root"></main>',{url:'https://getpurelabs.test/account/purchases?id='+id,runScripts:'outside-only',virtualConsole:new VirtualConsole()}),w=dom.window,requests=[];
 const auth={auth:{getSession:async()=>({data:{session:{access_token:'isolated-invoice-test-token'}}})}};
 w.fetch=async(url,options={})=>{
  const body=options.body?JSON.parse(options.body):null;requests.push({url:String(url),body});
  if(body){
   if(acceptError)return{ok:false,json:async()=>({error:acceptError})};
   assert.equal(body.action,'accept');record={...record,status:'accepted',version:record.version+1,payment_snapshot:receiver};
   return{ok:true,json:async()=>({id,status:'accepted'})};
  }
  return{ok:true,json:async()=>String(url).includes('commerce=customer')?{invoices:allInvoices||[record]}:{balances:{points:500,credit_cents:1000},events:[]}};
 };
 for(const file of ['readiness-ui.js','direct-checkout-client.js'])w.eval(fs.readFileSync(file,'utf8'));
 const root=w.document.getElementById('root');
 return{dom,w,root,requests,auth,async open(){await w.DirectCheckout.orders(root,auth,{});}};
}

test('new accepted CAD order immediately shows saved Interac details and reference with no invoice or acceptance step',async()=>{
 const paymentReference='AP4444444444';
 const f=fixture({record:invoice({checkout_version:'interac-direct-cad-v1',status:'accepted',payment_snapshot:{...receiver,payment_reference:paymentReference}})});
 try{
  await f.open();assert.match(f.root.textContent,/Order total · CAD/);assert.match(f.root.textContent,/Pay by Interac e-Transfer/);
  assert.match(f.root.textContent,/Payee: PURE Fixture Receiver/);assert.match(f.root.textContent,/fixture-receiver@example\.test/);
  assert.match(f.root.textContent,new RegExp('Order reference: '+paymentReference));assert.doesNotMatch(f.root.textContent,/INV-|invoice|confirm your order|under review/i);
  assert.equal(f.root.querySelector('[name=confirm_cad_order]'),null);assert.equal(f.root.querySelector('.dc-clean-order-right span').textContent,'Awaiting Interac payment');
  assert.equal(f.requests.filter(r=>r.body).length,0);assert.match(f.root.textContent,/remains unpaid until that confirmation/);
 }finally{f.dom.window.close();}
});

test('requested Interac invoice has no fake payable total or receiving instructions before staff review',async()=>{
 const f=fixture({record:invoice({status:'requested',currency:null,total_cents:null,pricing:null,payable:false,payment_snapshot:receiver})});
 try{
  await f.open();assert.match(f.root.textContent,/CAD total pending/);assert.match(f.root.textContent,/No payment is due yet/);
  assert.doesNotMatch(f.root.textContent,/\$0\.00|PURE Fixture Receiver|fixture-receiver@example\.test|INV-/);
  assert.equal(f.root.querySelector('button'),null);assert.equal(f.requests.filter(r=>r.body).length,0);
 }finally{f.dom.window.close();}
});

test('canceled or refunded requests without an issued amount do not display a false zero-dollar invoice',async()=>{
 for(const status of ['void','refunded']){
  const f=fixture({record:invoice({status,currency:null,total_cents:null,pricing:null,payable:false})});
  try{await f.open();assert.match(f.root.textContent,/CAD total unavailable/);assert.match(f.root.textContent,/No payment is due/);assert.doesNotMatch(f.root.textContent,/\$0\.00/);}
  finally{f.dom.window.close();}
 }
});

test('final CAD invoice shows the reviewed seller, tax basis, tax registrations, and delivery without private review fields',async()=>{
 const f=fixture({record:invoice({pricing:{fx_ppm:1400000,delivery_tax:{seller_name:'PURE Fixture Company',tax_basis:'Reviewed taxable supply in Ontario.',taxes:[{label:'HST',rate_ppm:130000,amount_cents:3419,registration_number:'123456789RT0001'}],private_review:{route_review:'PRIVATE ROUTE REVIEW',shipping_quote_reference:'PRIVATE QUOTE REFERENCE'},delivery:{carrier:'Fixture Carrier',service:'Tracked',handling_max_days:2,transit_min_days:3,transit_max_days:5,duties:'customer'}}}})});
 try{
  await f.open();assert.match(f.root.textContent,/Seller: PURE Fixture Company/);assert.match(f.root.textContent,/Tax treatment: Reviewed taxable supply in Ontario/);
  assert.match(f.root.textContent,/HST 13%: CA\$34\.19 · Registration \/ authority: 123456789RT0001/);
  assert.match(f.root.textContent,/Fixture Carrier · Tracked/);assert.match(f.root.textContent,/customer handles import duties/);
  assert.doesNotMatch(f.root.textContent,/PRIVATE ROUTE REVIEW|PRIVATE QUOTE REFERENCE/);
 }finally{f.dom.window.close();}
});

test('malformed or native-hybrid Interac configuration fails closed before any payment request',async()=>{
 const f=fixture(),method={kind:'interac',provider_key:'interac',currency:'CAD'};
 try{
  assert.equal(f.w.DirectCheckout.paymentKind(method),'interac');
  for(const bad of [{...method,provider_key:undefined},{...method,currency:'USD'},{...method,native_provider:'rampex',rampex_provider:'hosted'},{...method,kind:'hosted_link',native_provider:'polygon_usdc'}]){
   assert.equal(f.w.DirectCheckout.paymentKind(bad),null);
   await assert.rejects(f.w.DirectCheckout.openHostedPayment(f.auth,id,10000,'CAD',bad),/unavailable/);
  }
  assert.equal(f.requests.length,0);
 }finally{f.dom.window.close();}
});

test('final CAD acceptance uses the exact version and terms, then reveals instructions only after authenticated refresh',async()=>{
 // The issued fixture intentionally contains a snapshot to verify the UI still withholds it.
 const f=fixture({record:invoice({payment_snapshot:receiver})});
 try{
  await f.open();assert.match(f.root.textContent,/Order total · CAD/);assert.match(f.root.textContent,/Total \(CAD\)CA\$297\.19/);
  assert.match(f.root.textContent,/1 USD = 1\.4 CAD/);assert.match(f.root.textContent,/Payment deadline/);
  assert.doesNotMatch(f.root.textContent,/PURE Fixture Receiver|fixture-receiver@example\.test|INV-/);
  const button=f.root.querySelector('.dc-interac-invoice button');
  await button.onclick();assert.equal(f.requests.filter(r=>r.body).length,0);assert.match(f.root.textContent,/Confirm the final CAD amount first/);
  f.root.querySelector('[name=confirm_cad_order]').checked=true;await button.onclick();
  const post=f.requests.find(r=>r.body);assert.match(post.url,/commerce=customer$/);
  assert.deepEqual(post.body,{action:'accept',id,version:2,terms_version:'fixture-commercial-terms',consent:true});
  assert.equal(f.requests.filter(r=>!r.body&&r.url.includes('commerce=customer')).length,2);
  assert.match(f.root.textContent,/Payee: PURE Fixture Receiver/);assert.match(f.root.textContent,/fixture-receiver@example\.test/);
  assert.match(f.root.textContent,new RegExp('INV-'+id.toUpperCase()));assert.match(f.root.textContent,/remains unpaid until that confirmation/);
  assert.equal(f.root.querySelector('.dc-clean-order-right span').textContent,'Awaiting Interac payment');
  assert.equal(f.root.querySelector('.dc-invoice-instructions strong'),null,'Receiving text is not interpreted as markup');
  assert.equal(f.root.querySelector('.dc-interac-invoice button'),null);
  assert.deepEqual(f.requests.filter(r=>r.body).map(r=>r.body.action),['accept'],'The customer cannot record or confirm bank receipt');
 }finally{f.dom.window.close();}
});

test('rejected or stale invoice acceptance retains instructions privacy and allows a controlled retry',async()=>{
 const f=fixture({acceptError:'This invoice changed. Reload before accepting.'});
 try{
  await f.open();f.root.querySelector('[name=confirm_cad_order]').checked=true;const button=f.root.querySelector('.dc-interac-invoice button');await button.onclick();
  assert.match(f.root.textContent,/invoice changed/);assert.doesNotMatch(f.root.textContent,/PURE Fixture Receiver|fixture-receiver@example\.test/);
  assert.equal(button.disabled,false);assert.equal(f.root.querySelector('[name=confirm_cad_order]').disabled,false);
  assert.equal(f.requests.filter(r=>r.body).length,1);
 }finally{f.dom.window.close();}
});

test('expired, unavailable, canceled, or wrong-currency Interac invoices never reveal receiving details',async()=>{
 for(const patch of [{payable:false},{expires_at:new Date(Date.now()-1000).toISOString()},{cancellation_status:'pending'},{currency:'USD'},{payment_snapshot:{...receiver,currency:'USD'}}]){
  const f=fixture({record:invoice({status:'accepted',payment_snapshot:receiver,...patch})});
  try{
   await f.open();assert.doesNotMatch(f.root.textContent,/PURE Fixture Receiver|fixture-receiver@example\.test|INV-/);
   assert.equal(f.root.querySelector('.dc-interac-invoice button'),null);assert.equal(f.requests.filter(r=>r.body).length,0);
  }finally{f.dom.window.close();}
 }
});

test('account overview keeps paid USD and CAD totals separate and labels unpriced CAD requests',async()=>{
 const f=fixture({allInvoices:[invoice({status:'paid',currency:'USD',total_cents:10000}),invoice({id:'55555555-5555-4555-8555-555555555555',status:'paid',total_cents:29719}),invoice({id:'66666666-6666-4666-8666-666666666666',status:'requested',total_cents:null,currency:null})]});
 try{
  await f.w.ReadinessUI.overview(f.root,f.auth,{user_metadata:{full_name:'Fixture Researcher'}});
  const stat=f.root.querySelectorAll('.rd-stat-grid article')[1].textContent;
  assert.match(stat,/\$100\.00 · CA\$297\.19/);assert.doesNotMatch(stat,/\$397\.19/);
  assert.match(f.root.querySelector('tbody').textContent,/CA\$297\.19/);assert.match(f.root.querySelector('tbody').textContent,/CAD order total pending/);
 }finally{f.dom.window.close();}
});

test('payment options advertise direct CAD checkout without publishing receiving details',async()=>{
 const dom=new JSDOM('<main id="payment-options-live"></main>',{url:'https://getpurelabs.test/payment-options.html',runScripts:'outside-only',virtualConsole:new VirtualConsole()}),w=dom.window;
 try{
  w.fetch=async()=>({ok:true,json:async()=>({payment_options:[{key:'card',name:'Card',status:'available',method_id:'card'},{key:'interac',name:'Interac e-Transfer',status:'available',method_id:'interac',description:'Pay in CAD by Interac e-Transfer.',...receiver}]})});
  w.eval(fs.readFileSync('checkout-payment-options.js','utf8'));await new Promise(resolve=>setTimeout(resolve,15));
  const root=w.document.getElementById('payment-options-live');assert.match(root.textContent,/Card or Crypto in USD/);assert.match(root.textContent,/Canadian shipping address/);
  assert.match(root.textContent,/Interac e-Transfer \(CAD\)/);assert.equal(root.querySelector('a[href="/checkout?method=interac"]').textContent,'CONTINUE TO CHECKOUT');
  assert.doesNotMatch(root.textContent,/PURE Fixture Receiver|fixture-receiver@example\.test/);
 }finally{dom.window.close();}
});
