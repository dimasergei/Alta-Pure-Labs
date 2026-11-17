'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM,VirtualConsole}=require('jsdom');
const {price}=require('../lib/direct-checkout');
const config=require('../config/checkout.json'),delivery=require('../config/delivery-options.json'),zones=require('../config/shipping-zones.json');
const bank={id:'22222222-2222-4222-8222-222222222222',kind:'bank_transfer',sale_scope:'goods',currency:'USD',label:'Same-Day Bank Payment',active:true};
const card={id:'11111111-1111-4111-8111-111111111111',kind:'hosted_link',sale_scope:'goods',currency:'USD',label:'Card',native_provider:'rampex',rampex_provider:'hosted',countries:['US','CA']};
const user={email:'researcher@example.test',user_metadata:{full_name:'Fixture Researcher',alta_profile:{shipping:{name:'Fixture Researcher',line1:'123 Research Lane',city:'Miami',region:'FL',postal_code:'33101',country:'US',phone:'3055550157'}}}};
const tick=()=>new Promise(resolve=>setTimeout(resolve,20));
function fixture(surface,{legacyCoupon=false,balances={points:0,credit_cents:0}}={}){
 const dom=new JSDOM('<main id="root"></main>',{url:'https://pure-labs.live/'+(surface==='cart'?'shop':'checkout'),runScripts:'outside-only',virtualConsole:new VirtualConsole()}),w=dom.window,requests=[],orderRequests=[];
 let cart=[{id:'fixture',key:'fixture:5mg',name:'Fixture compound',size:'5mg',qty:2,price:80}];
 const products=[{id:'fixture',name:'Fixture compound',variants:[{size:'5mg',price:80}]},{id:'addon',name:'Research add-on',variants:[{size:'10mg',price:30}]}];
 const data={config,delivery_options:delivery,shipping_zones:zones,methods:[card,bank],nmi:null,balances,events:[]};
 w.AltaStore={get cart(){return cart;},catalog:products,product:id=>products.find(p=>p.id===id),image:()=>'/fixture.svg',adjustQuantity(key,delta){cart=cart.map(item=>item.key===key?{...item,qty:item.qty+delta}:item).filter(item=>item.qty>0);}};
 function quote(body){
  const q=price({kind:'goods',request:{items:body.items.map(item=>({...item,name:'Fixture compound',unit_price_usd_cents:8000})),address:{country:body.country||body.address?.country||'US'},checkout:{coupon:body.coupon||'',points:body.points||0,credit_cents:body.credit_cents||0,delivery:body.delivery}}},bank,null,balances,null,delivery);
  return {...q,free_shipping_threshold_cents:15000,free_shipping_remaining_cents:Math.max(0,15000-q.subtotal_cents+q.discount_cents)};
 }
 w.fetch=async(url,options={})=>{
  if(String(url).includes('checkout=public'))return {ok:true,json:async()=>data};
  const body=JSON.parse(options.body);requests.push(body);
  try{return {ok:true,json:async()=>quote(body)};}catch(error){return {ok:false,json:async()=>({error:error.message})};}
 };
 const auth={auth:{getSession:async()=>({data:{session:{access_token:'isolated-fixture-token'}}})}};
 w.DirectCheckout={checkout:async()=>{},openHostedPayment:async()=>({paid:true}),api:async(_auth,body)=>{if(!body)return data;orderRequests.push(body);if(body.action==='quote')return {...quote(body),quote:'fixture-signed-quote'};if(body.action==='place')return {id:body.id};throw Error('Unexpected checkout action');}};
 if(legacyCoupon){w.localStorage.setItem('ap-checkout-coupon','BOGO');w.localStorage.setItem('ap-cart-coupon','BOGO');}
 w.eval(fs.readFileSync(surface==='cart'?'cart-reference.js':'checkout-reference.js','utf8'));
 return {dom,w,root:w.document.querySelector('main'),requests,orderRequests,auth,user};
}
for(const surface of ['cart','checkout'])test(surface+': regular purchased quantity, explicit 15% coupon, invalid-code recovery and removal use server totals',async()=>{
 const f=fixture(surface,{legacyCoupon:true});
 try{
  if(surface==='cart')await f.w.AltaCartNmi.offer(f.root);else await f.w.DirectCheckout.checkout(f.root,f.auth,f.user);
  await tick();
  assert.equal(f.requests[0].items[0].qty,2);
  assert.equal(f.requests[0].coupon,'');
  assert.equal(f.w.localStorage.getItem('ap-checkout-coupon'),null);
  assert.match(f.root.textContent,/\$160\.00/);
  assert.match(f.root.textContent,/\$165\.00/);
  assert.doesNotMatch(f.root.textContent,/BOGO|\+\d+ FREE|member(ship)?|\b5% off|Free BAC|Free Priority/i);
  assert.equal(f.root.querySelector('s,del'),null);
  const input=f.root.querySelector(surface==='cart'?'[name=nlc_coupon]':'[name=sidebar_coupon]');
  const apply=f.root.querySelector(surface==='cart'?'[data-nlc-apply]':'[data-nlx-coupon]');
  const remove=f.root.querySelector(surface==='cart'?'[data-nlc-remove-coupon]':'[data-nlx-remove-coupon]');
  input.value=' blackfriday15 ';apply.click();await tick();
  assert.equal(f.requests.at(-1).coupon,'BLACKFRIDAY15');
  assert.equal(f.requests.at(-1).items[0].qty,2);
  assert.equal(f.w.localStorage.getItem('ap-checkout-coupon'),'BLACKFRIDAY15');
  assert.equal(f.w.localStorage.getItem('ap-cart-coupon'),'BLACKFRIDAY15');
  assert.equal(remove.hidden,false);
  assert.match(f.root.textContent,/BLACKFRIDAY15 applied/);
  assert.match(f.root.textContent,/\$24\.00/);
  assert.match(f.root.textContent,/\$155\.95/);
  if(surface==='cart')assert.match(f.root.querySelector('[data-nlc-unlock-copy]').textContent,/\$14\.00/);
  input.value='BOGO';apply.click();await tick();await tick();
  assert.equal(f.w.localStorage.getItem('ap-checkout-coupon'),'BLACKFRIDAY15','Rejected code cannot replace the applied coupon');
  assert.match(f.root.textContent,/\$155\.95/);
  assert.doesNotMatch(f.root.textContent,/BOGO applied/);
  remove.click();await tick();
  assert.equal(f.requests.at(-1).coupon,'');
  assert.equal(f.w.localStorage.getItem('ap-checkout-coupon'),null);
  assert.equal(f.w.localStorage.getItem('ap-cart-coupon'),null);
  assert.equal(remove.hidden,true);
  assert.match(f.root.textContent,/Coupon removed/);
  assert.match(f.root.textContent,/\$165\.00/);
  if(surface==='cart')assert.match(f.root.querySelector('[data-nlc-unlock-copy]').textContent,/Free standard US shipping included/);
 }finally{f.dom.window.close();}
});
test('checkout Card order quotes and places the same purchased quantity and confirmed coupon',async()=>{
 const f=fixture('checkout');
 try{
  await f.w.DirectCheckout.checkout(f.root,f.auth,f.user);await tick();
  f.root.querySelector('[name=sidebar_coupon]').value='BLACKFRIDAY15';f.root.querySelector('[data-nlx-coupon]').click();await tick();
  f.root.querySelector('[data-nlx-next]').click();f.root.querySelector('[data-nlx-next]').click();await tick();
  const cardChoice=f.root.querySelector('[name=payment_choice][value=card]');cardChoice.checked=true;cardChoice.dispatchEvent(new f.w.Event('change',{bubbles:true}));await tick();
  for(const name of ['ruo','responsibility']){const input=f.root.querySelector('[name='+name+']');input.checked=true;input.dispatchEvent(new f.w.Event('change',{bubbles:true}));}
  const place=f.root.querySelector('[data-nlx-place]');assert.equal(place.disabled,false);place.click();await tick();
  assert.equal(f.orderRequests.length,2);
  assert.equal(f.orderRequests[0].action,'quote');assert.equal(f.orderRequests[1].action,'place');
  for(const body of f.orderRequests){assert.equal(body.items[0].qty,2);assert.equal(body.coupon,'BLACKFRIDAY15');assert.equal(body.kind,'goods');assert.equal(body.method_id,card.id);assert.equal(body.checkout_version,config.version);assert.equal(body.plan,undefined);assert.equal(body.research_builder,undefined);}
  assert.equal(f.orderRequests[1].quote,'fixture-signed-quote');
 }finally{f.dom.window.close();}
});
test('checkout exposes existing balances without promising new rewards',async()=>{
 const f=fixture('checkout',{balances:{points:200,credit_cents:500}});
 try{await f.w.DirectCheckout.checkout(f.root,f.auth,f.user);await tick();assert.ok(f.root.querySelector('a[href="/checkout?balance=1"]'));assert.match(f.root.textContent,/200 points/);assert.doesNotMatch(f.root.textContent,/Earn .*points|membership/i);}finally{f.dom.window.close();}
});
