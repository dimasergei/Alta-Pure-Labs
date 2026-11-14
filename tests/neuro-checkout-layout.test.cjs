'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),{JSDOM}=require('jsdom');
const path=require('path');
const base=path.join(__dirname,'..');
const delivery=require('../config/delivery-options.json'),config=require('../config/checkout.json'),zones=require('../config/shipping-zones.json');
const billingData={terms:{conversion:require('../config/conversion.json')},balances:{points:0,credit_cents:0},delivery_options:delivery,shipping_zones:zones,
 config,methods:[{id:'11111111-1111-4111-8111-111111111111',kind:'hosted_link',native_provider:'rampex',label:'Card through Rampex'}],nmi:null};
const user={id:'22222222-2222-4222-8222-222222222222',email:'buyer@example.test',user_metadata:{full_name:'Sample Researcher',alta_profile:{shipping:{name:'Sample Researcher',line1:'123 Research Lane',city:'Miami',region:'FL',postal_code:'33101',country:'US',phone:'305-555-0157'}}}};
const wait=()=>new Promise(resolve=>setTimeout(resolve,35));
const source=fs.readFileSync(path.join(base,'checkout-reference.js'),'utf8');
function fixture(ready=false){
 const dom=new JSDOM('<main id="checkout"></main>',{url:'https://altapurelabs.com/checkout',runScripts:'outside-only'});
 const w=dom.window,orders=[],quotes=[];
 w.HTMLElement.prototype.scrollIntoView=()=>{};
 Object.defineProperty(w.crypto,'randomUUID',{value:()=> '33333333-3333-4333-8333-333333333333',configurable:true});
 const data=JSON.parse(JSON.stringify(billingData));
 if(ready){data.nmi={ready:true,method_id:'11111111-1111-4111-8111-111111111111',tokenization_key:'public-fixture-key',wallets:{apple:true,google:true}};data.methods[0].native_provider='nmi';}
 const products=[{id:'fixture',name:'Research compound',variants:[{size:'5mg',price:100}]}];
 let cart=[{key:'fixture:5mg',id:'fixture',name:'Research compound',size:'5mg',qty:2,price:100}];
 w.AltaStore={get cart(){return cart},product:()=>products[0],image:()=>'/assets/compound.png',adjustQuantity(key,delta){
  cart=cart.map(x=>x.key===key?{...x,qty:x.qty+delta}:x);return true;}};
 w.DirectCheckout={checkout:async()=>{},api:async(_auth,body)=>{
  if(!body)return data;
  orders.push(body);
  if(body.action==='quote')return{...quotes.at(-1),quote:'a'.repeat(64)};
  if(body.action==='place')return{id:'44444444-4444-4444-8444-444444444444',status:'accepted'};
  throw Error('Unexpected action');
 }};
 w.fetch=async(_url,opt)=>{
  if(String(_url).includes('native=customer&invoice=')){
   orders.push({...JSON.parse(opt.body),action:'native_pay'});
   return{ok:true,json:async()=>({state:'paid'})};
  }
  const body=JSON.parse(opt.body);
  const items=(w.AltaStore.cart||[]),subtotal=items.reduce((n,x)=>x.qty*10000+n,0);
  const shipping=zones[body.country]||zones.OTHER;
  const chosen=body.delivery;
  const charges=(chosen.extras||[]).map(x=>({id:x,label:delivery.find(d=>d.id===x)?.label,amount_cents:delivery.find(d=>d.id===x)?.price_cents}));
  const total=subtotal+shipping[chosen.shipping]+charges.reduce((n,x)=>n+x.amount_cents,0);
  const q={subtotal_cents:subtotal,discount_cents:0,shipping_cents:shipping[chosen.shipping]+charges.reduce((n,x)=>n+x.amount_cents,0),
   total_cents:total,currency:'USD',earned_points:Math.floor(subtotal/100),pricing:{delivery:{shipping_cents:shipping[chosen.shipping],extras:charges}}};
  quotes.push(q);
  return{ok:true,json:async()=>q};
 };
 const auth={auth:{getSession:async()=>({data:{session:{access_token:'fixture-access-token'}}})}};
 w.eval(source);
 return{dom,w,root:w.document.getElementById('checkout'),data,orders,quotes,auth};
}
test('three-step checkout shows preselected US protection, editable order summary, points and global country dropdown',async()=>{
 const f=fixture();
 try{
  await f.w.DirectCheckout.checkout(f.root,f.auth,user);
  await wait();
  assert.equal(f.root.querySelectorAll('[data-nlx-step]').length,3);
  assert.match(f.root.textContent,/Order Summary/);
  assert.match(f.root.textContent,/Earn .* points/);
  assert.match(f.root.textContent,/Shipping Protection/);
  assert.equal(f.root.querySelector('[data-nlx-extra="protection"]').checked,true);
  const countries=f.root.querySelector('select[name=country]');
  assert.ok(countries.options.length>200);
  assert.equal(countries.value,'US');
  assert.ok([...countries.options].some(x=>x.value==='CA'));
  assert.ok([...countries.options].some(x=>x.value==='GB'));
  assert.equal(f.quotes.at(-1).total_cents,21995);
  assert.match(f.root.textContent,/Country \/ Region/);
 }finally{f.dom.window.close();}
});
test('customer-selected country updates authoritative quote; US-only next-day excluded for Canadian delivery; extra fees are opt-in',async()=>{
 const f=fixture();
 try{
  await f.w.DirectCheckout.checkout(f.root,f.auth,user);await wait();
  const country=f.root.querySelector('select[name=country]');
  country.value='CA';country.dispatchEvent(new f.w.Event('change',{bubbles:true}));
  await new Promise(r=>setTimeout(r,290));
  assert.equal(f.root.querySelector('[data-nlx-extra="protection"]'),null,'US-only shipping protection must not be offered for international destinations');
  assert.equal(f.quotes.at(-1).total_cents,23995);
  f.root.querySelector('[data-nlx-next]').click();await wait();
  assert.match(f.root.textContent,/Delivery speed/);
  assert.equal(f.root.querySelector('input[name=delivery_speed][value=next_day]').disabled,true);
  f.root.querySelector('[data-nlx-extra=priority]').checked=true;
  f.root.querySelector('[data-nlx-extra=priority]').dispatchEvent(new f.w.Event('change',{bubbles:true}));
  await new Promise(r=>setTimeout(r,260));
  assert.equal(f.quotes.at(-1).total_cents,24994);
  assert.match(f.root.textContent,/Priority Processing/);
  f.root.querySelector('[data-nlx-next]').click();await wait();
  assert.match(f.root.textContent,/EXPRESS CHECKOUT/);
  assert.match(f.root.textContent,/OR PAY ANOTHER WAY/);
  assert.match(f.root.textContent,/Card payments are not available until processor activation/);
  assert.equal(f.root.querySelectorAll('.nlx-terms input[type=checkbox]').length,2);
  assert.equal(f.root.querySelectorAll('.nlx-wallet-unavailable').length,2);
  assert.ok([...f.root.querySelectorAll('.nlx-wallet-unavailable')].every(b=>b.disabled),'Wallet buttons cannot claim acceptance before onboarding');
 }finally{f.dom.window.close();}
});
test('protected line is added/removed from server quote and cart quantities update via AltaStore',async()=>{
 const f=fixture();
 try{
  await f.w.DirectCheckout.checkout(f.root,f.auth,user);await wait();
  const protection=f.root.querySelector('[data-nlx-extra=protection]');
  protection.checked=false;protection.dispatchEvent(new f.w.Event('change',{bubbles:true}));
  await new Promise(r=>setTimeout(r,280));
  assert.equal(f.quotes.at(-1).total_cents,21495);
  f.root.querySelector('[data-nlx-qty="1"]').click();await new Promise(r=>setTimeout(r,280));
  assert.equal(f.w.AltaStore.cart[0].qty,3);
  assert.equal(f.quotes.at(-1).total_cents,31495);
 }finally{f.dom.window.close();}
});
test('NMI absent never submits an order or creates a fake wallet payment',async()=>{
 const f=fixture();
 try{
  await f.w.DirectCheckout.checkout(f.root,f.auth,user);await wait();
  f.root.querySelector('[data-nlx-next]').click();await wait();
  f.root.querySelector('[data-nlx-next]').click();await wait();
  assert.equal(f.root.querySelector('[data-nlx-place]').disabled,true);
  assert.equal(f.orders.length,0);
 }finally{f.dom.window.close();}
});

test('card and wallet displays stay disabled even with legacy NMI configuration',async()=>{
 const f=fixture(true);
 let mounts=0;
 f.w.AltaNmiInline={available:()=>true,mount:async()=>{mounts++;return{destroy(){}}}};
 try{
  await f.w.DirectCheckout.checkout(f.root,f.auth,user);await wait();
  f.root.querySelector('[data-nlx-next]').click();await wait();
  f.root.querySelector('[data-nlx-next]').click();await wait();
  const boxes=f.root.querySelectorAll('.nlx-terms input[type=checkbox]');
  boxes.forEach(b=>{b.checked=true;b.dispatchEvent(new f.w.Event('change',{bubbles:true}));});
  await wait();
  assert.equal(mounts,0,'No card processor should mount in the bank-only layout');
  assert.ok([...f.root.querySelectorAll('.nlx-wallet-unavailable')].every(b=>b.disabled));
  assert.equal(f.root.querySelector('[data-nlx-place]').disabled,true);
  assert.equal(f.orders.filter(x=>x.action==='place').length,0);
 }finally{f.dom.window.close();}
});
