'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),{JSDOM}=require('jsdom');
const source=fs.readFileSync('cart-reference.js','utf8');
const wait=()=>new Promise(resolve=>setTimeout(resolve,25));
function fixture(authorized=false){
 const dom=new JSDOM('<div id="cart"><p>Old cart</p></div>',{url:'https://altapurelabs.com/shop',runScripts:'outside-only'}),w=dom.window,requests=[];
 let cart=[{id:'compound',key:'compound:5mg',name:'Research compound',size:'5mg',qty:2,price:50}];
 const catalog=[{id:'compound',name:'Research compound',variants:[{size:'5mg',price:50}]},{id:'extra',name:'Research add-on',variants:[{size:'10mg',price:20}]}];
 w.AltaStore={get cart(){return cart},catalog,product:id=>catalog.find(p=>p.id===id),image:()=>'/fixture.webp'};
 w.AltaCartNmi={open(){}};
 w.fetch=async(url,options={})=>{
  requests.push({url,body:options.body?JSON.parse(options.body):undefined});
  if(String(url).includes('checkout=public'))return{ok:true,json:async()=>({methods:authorized?[{id:'method-1',native_provider:'nmi',kind:'card'}]:[],delivery_options:[{id:'protection',enabled:true,price_cents:500}],nmi:authorized?{ready:true,method_id:'method-1',wallets:{apple:true,google:true}}:null})};
  const b=JSON.parse(options.body);
  const protectedFee=b.delivery.extras.includes('protection')?500:0;
  return{ok:true,json:async()=>({subtotal_cents:10000,discount_cents:b.coupon==='BLACKFRIDAY15'?1500:0,total_cents:11495+protectedFee-(b.coupon==='BLACKFRIDAY15'?1500:0),free_shipping_threshold_cents:15000,free_shipping_remaining_cents:5000+(b.coupon==='BLACKFRIDAY15'?1500:0),pricing:{coupon_code:b.coupon==='BLACKFRIDAY15'?'BLACKFRIDAY15':null,delivery:{shipping_cents:1495,extras:protectedFee?[{id:'protection',label:'Shipping Protection',amount_cents:500}]:[]}}})};
 };
 w.eval(source);
 return{dom,w,cart:dom.window.document.getElementById('cart'),requests};
}
test('cart has editable rows, recommendations, coupon, protection and one honest checkout action',async()=>{
 const f=fixture();try{
  await f.w.AltaCartNmi.offer(f.cart);await wait();
  assert.match(f.cart.textContent,/Research compound/);
  assert.match(f.cart.textContent,/RECOMMENDED ADD-ONS/);
  assert.ok(f.cart.querySelector('[data-action="add"][data-id="extra"]'));
  assert.ok(f.cart.querySelector('[data-action="cart-quantity"]'));
  assert.ok(f.cart.querySelector('[name=nlc_coupon]'));
  assert.equal(f.cart.querySelector('[name=nlc_protection]'),null,'No shipping protection checkbox or removal action');
  assert.ok(f.cart.querySelector('.nlc-protection-static'),'Shipping protection must appear as a fixed line item');
  assert.doesNotMatch(f.cart.textContent,/OR PAY INSTANTLY|Apple Pay|Google Pay/);
  assert.ok(f.cart.querySelector('[data-nlc-estimate]').textContent.includes('–'));
  assert.match(f.cart.textContent,/Choose Card or Crypto at checkout/);
  assert.match(f.cart.textContent,/Shipping Protection/);
  assert.match(f.cart.textContent,/Proceed to Checkout/);
  assert.equal(f.cart.querySelectorAll('[data-nlc-wallets] button').length,0);
  assert.ok(f.cart.textContent.includes('$119.95'));
  assert.equal(f.requests.find(x=>String(x.url).includes('checkout=cart')).body.method_id,null);
  f.cart.querySelector('[name=nlc_coupon]').value='BLACKFRIDAY15';
  f.cart.querySelector('[data-nlc-apply]').click();await wait();
  assert.equal(f.w.localStorage.getItem('ap-checkout-coupon'),'BLACKFRIDAY15');
 }finally{f.dom.window.close();}
});
test('legacy NMI configuration cannot add a retired payment option to the new cart',async()=>{
 const f=fixture(true);try{
  await f.w.AltaCartNmi.offer(f.cart);await wait();
  assert.equal(f.cart.querySelector('[data-nlc-wallets]'),null);
  assert.equal(f.requests.find(x=>String(x.url).includes('checkout=cart')).body.method_id,null);
 }finally{f.dom.window.close();}
});

test('an already-open cart follows a checkout protection opt-out on its next quote',async()=>{
 const f=fixture();try{
  await f.w.AltaCartNmi.offer(f.cart);await wait();
  assert.ok(f.cart.querySelector('.nlc-protection-static'));
  f.w.sessionStorage.setItem('ap-checkout-protection','false');
  f.cart.querySelector('[name=nlc_coupon]').value='BLACKFRIDAY15';
  f.cart.querySelector('[data-nlc-apply]').click();await wait();
  assert.deepEqual(f.requests.at(-1).body.delivery.extras,[]);
  assert.equal(f.cart.querySelector('.nlc-protection-static'),null);
  f.w.sessionStorage.setItem('ap-checkout-protection','true');
  f.cart.querySelector('[data-nlc-remove-coupon]').click();await wait();
  assert.deepEqual(f.requests.at(-1).body.delivery.extras,['protection']);
  assert.ok(f.cart.querySelector('.nlc-protection-static'));
 }finally{f.dom.window.close();}
});

test('an old international cart without a protection control receives the new default',async()=>{
 const f=fixture();try{
  f.w.localStorage.setItem('ap-shipping-country','CA');
  f.w.sessionStorage.setItem('ap-v2-cart-extras:'+JSON.stringify([{id:'compound',size:'5mg',qty:2}]),'[]');
  await f.w.AltaCartNmi.offer(f.cart);await wait();
  assert.equal(f.requests.at(-1).body.country,'CA');
  assert.deepEqual(f.requests.at(-1).body.delivery.extras,['protection']);
  assert.ok(f.cart.querySelector('.nlc-protection-static'));
 }finally{f.dom.window.close();}
});

test('final storefront build selects the new cart and never invokes the retired duplicate coupon panel',()=>{
 const src=fs.readFileSync('conversion-build.cjs','utf8');
 const storefront=fs.readFileSync('storefront-v2.js','utf8');
 assert.doesNotMatch(src,/renderCart=/);
 assert.doesNotMatch(src,/window\.ConversionUI\.cart\(root,cart\)/);
 assert.match(storefront,/window\.AltaCartNmi\?\.offer\(root\)/);
});
