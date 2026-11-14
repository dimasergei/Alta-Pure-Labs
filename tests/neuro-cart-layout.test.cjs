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
  return{ok:true,json:async()=>({subtotal_cents:10000,discount_cents:0,total_cents:11495+protectedFee,pricing:{delivery:{shipping_cents:1495,extras:protectedFee?[{id:'protection',label:'Shipping Protection',amount_cents:500}]:[]}}})};
 };
 w.eval(source);
 return{dom,w,cart:dom.window.document.getElementById('cart'),requests};
}
test('cart has editable rows, product recommendations, coupon, protection, checkout and wallet positions',async()=>{
 const f=fixture();try{
  await f.w.AltaCartNmi.offer(f.cart);await wait();
  assert.match(f.cart.textContent,/Research compound/);
  assert.match(f.cart.textContent,/RECOMMENDED ADD-ONS/);
  assert.ok(f.cart.querySelector('[data-action="add"][data-id="extra"]'));
  assert.ok(f.cart.querySelector('[data-action="cart-quantity"]'));
  assert.ok(f.cart.querySelector('[name=nlc_coupon]'));
  assert.equal(f.cart.querySelector('[name=nlc_protection]'),null,'No shipping protection checkbox or removal action');
  assert.ok(f.cart.querySelector('.nlc-protection-static'),'Shipping protection must appear as a fixed line item');
  assert.match(f.cart.textContent,/OR PAY INSTANTLY\s*\$119\.95/);
  assert.ok(f.cart.querySelector('[data-nlc-estimate]').textContent.includes('–'));
  assert.match(f.cart.querySelector('[data-nlc-wallets]').textContent,/Pay/);
  assert.match(f.cart.textContent,/Shipping Protection/);
  assert.match(f.cart.textContent,/Proceed to Checkout/);
  assert.equal(f.cart.querySelectorAll('[data-nlc-wallets] button').length,2);
  assert.ok([...f.cart.querySelectorAll('[data-nlc-wallets] button')].every(x=>x.disabled));
  assert.ok(f.cart.textContent.includes('$119.95'));
  assert.equal(f.requests.find(x=>String(x.url).includes('checkout=cart')).body.method_id,null);
  f.cart.querySelector('[name=nlc_coupon]').value='BOGO';
  f.cart.querySelector('[data-nlc-apply]').click();await wait();
  assert.equal(f.w.localStorage.getItem('ap-checkout-coupon'),'BOGO');
 }finally{f.dom.window.close();}
});
test('cart widget only enables actual wallet controls when a verified NMI account exists',async()=>{
 const f=fixture(true);try{
  await f.w.AltaCartNmi.offer(f.cart);await wait();
  assert.ok([...f.cart.querySelectorAll('[data-nlc-wallets] button')].every(x=>!x.disabled));
 }finally{f.dom.window.close();}
});

test('final storefront build selects the new cart and never invokes the retired duplicate coupon panel',()=>{
 const src=fs.readFileSync('conversion-build.cjs','utf8');
 const storefront=fs.readFileSync('storefront-v2.js','utf8');
 assert.match(src,/window\.AltaCartNmi\?\.offer\(root\)/);
 assert.doesNotMatch(src,/window\.ConversionUI\.cart\(root,cart\)/);
 assert.match(storefront,/window\.AltaCartNmi\?\.offer\(root\)/);
});
