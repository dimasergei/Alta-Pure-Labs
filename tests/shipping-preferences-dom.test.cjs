'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM,VirtualConsole}=require('jsdom'),{webcrypto}=require('node:crypto');
const {price}=require('../lib/direct-checkout');
const config=require('../config/checkout.json'),delivery=require('../config/delivery-options.json'),zones=require('../config/shipping-zones.json');
const tick=()=>new Promise(resolve=>setTimeout(resolve,230));
const method={id:'11111111-1111-4111-8111-111111111111',kind:'hosted_link',native_provider:'rampex',rampex_provider:'hosted',label:'Card',sale_scope:'goods',currency:'USD',active:true,countries:['US','CA','GB']};
function fixture(route='',country='US'){
 const dom=new JSDOM('<main id="checkout"></main><div id="cart"></div>',{url:'https://getpurelabs.test/checkout'+route,runScripts:'outside-only',virtualConsole:new VirtualConsole()}),w=dom.window;
 Object.defineProperty(w,'crypto',{value:webcrypto});w.TextEncoder=TextEncoder;w.HTMLElement.prototype.scrollIntoView=()=>{};
 let cart=[{id:'compound',key:'compound:10mg',name:'Research compound',size:'10mg',qty:2,price:100}];
 const product={id:'compound',name:'Research compound',variants:[{size:'10mg',price:100}]};
 w.localStorage.setItem('ap-bulk-draft-v2',JSON.stringify(cart));
 w.AltaStore={get cart(){return cart;},catalog:[product],product:()=>product,image:()=>'/fixture.webp',
  read:(key,fallback)=>JSON.parse(w.localStorage.getItem(key)||JSON.stringify(fallback)),normalizeLines:lines=>lines,
  adjustQuantity(key,delta){cart=cart.map(item=>item.key===key?{...item,qty:item.qty+delta}:item);}};
 const data={config,delivery_options:delivery,shipping_zones:zones,methods:[method],nmi:null,balances:{points:0,credit_cents:0},capabilities:{card:false},events:[]};
 const requests=[],quotes=[];
 w.fetch=async(url,options={})=>{
  if(!options.body)return{ok:true,json:async()=>data};
  const body=JSON.parse(options.body);requests.push(body);
  const quote=price({kind:'goods',request:{items:body.items.map(item=>({...item,name:'Research compound',unit_price_usd_cents:10000})),address:{country:body.country||body.address?.country||'US'},checkout:{coupon:body.coupon||'',points:0,credit_cents:0,delivery:body.delivery}}},method,null,data.balances,null,delivery);
  const q={...quote,quote:'isolated-shipping-quote',free_shipping_threshold_cents:15000,free_shipping_remaining_cents:Math.max(0,15000-quote.subtotal_cents+quote.discount_cents)};
  quotes.push(q);return{ok:true,json:async()=>q};
 };
 const user={email:'fixture@example.test',user_metadata:{full_name:'Fixture Researcher',alta_profile:{shipping:{name:'Fixture Researcher',line1:'123 Test Street',city:'Test City',region:country==='CA'?'ON':'FL',postal_code:country==='CA'?'N2L 1A1':'33101',country,phone:'3055550157'}}}};
 const auth={auth:{getSession:async()=>({data:{session:{access_token:'isolated-shipping-fixture'}}})}};
 for(const file of ['readiness-ui.js','direct-checkout-client.js','checkout-reference.js','cart-reference.js'])w.eval(fs.readFileSync(file,'utf8'));
 const root=w.document.getElementById('checkout'),cartRoot=w.document.getElementById('cart');
 return{dom,w,root,cartRoot,requests,quotes,async open(path=route){w.history.replaceState({},'','/checkout'+path);await w.DirectCheckout.checkout(root,auth,user);await tick();}};
}
const protection=f=>f.root.querySelector('[data-nlx-extra="protection"],[name=delivery_extra][value=protection]');
function choose(f,input,value){if(input.type==='checkbox'||input.type==='radio')input.checked=value;else input.value=value;input.dispatchEvent(new f.w.Event('change',{bubbles:true}));}

for(const route of ['', '?bulk=1', '?balance=1'])test('Canadian next-day and default protection use the same server quote in '+(route||'regular checkout'),async()=>{
 const f=fixture(route,'CA');
 try{
  await f.open();
  assert.equal(f.root.querySelector('[name=country]').value,'CA');
  assert.equal(protection(f).checked,true);
  assert.deepEqual(f.requests.at(-1).delivery.extras,['protection']);
  assert.equal(f.quotes.at(-1).shipping_cents,4495);
  f.root.querySelector('[data-nlx-next],[data-step-next="0"]').click();await tick();
  const nextDay=f.root.querySelector('[name=delivery_speed][value=next_day],[name=shipping_speed][value=next_day]');
  assert.equal(nextDay.disabled,false);
  choose(f,nextDay,true);await tick();
  assert.equal(f.requests.at(-1).delivery.shipping,'next_day');
  assert.equal(f.quotes.at(-1).pricing.delivery.shipping_cents,6995);
  assert.equal(f.quotes.at(-1).shipping_cents,7495);
  choose(f,protection(f),false);await tick();
  assert.equal(f.quotes.at(-1).shipping_cents,6995);
  assert.deepEqual(f.requests.at(-1).delivery.extras,[]);
 }finally{f.dom.window.close();}
});

test('checkout opt-out persists across country, quantity, cart, reload, bulk and balance changes until re-enabled',async()=>{
 const f=fixture();
 try{
  await f.open();assert.equal(protection(f).checked,true);
  choose(f,protection(f),false);await tick();
  choose(f,f.root.querySelector('[name=country]'),'CA');await tick();
  f.root.querySelector('[data-nlx-qty="1"]').click();await tick();
  assert.equal(f.w.AltaStore.cart[0].qty,3);
  assert.equal(protection(f).checked,false);
  assert.deepEqual(f.requests.at(-1).delivery.extras,[]);
  assert.equal(f.quotes.at(-1).shipping_cents,3995);
  await f.w.AltaCartNmi.offer(f.cartRoot);await tick();
  assert.deepEqual(f.requests.at(-1).delivery.extras,[]);
  assert.equal(f.cartRoot.querySelector('.nlc-protection-static'),null);
  for(const route of ['', '?bulk=1', '?balance=1']){
   await f.open(route);assert.equal(protection(f).checked,false,'Explicit opt-out retained in '+route);
   assert.deepEqual(f.requests.at(-1).delivery.extras,[]);
  }
  choose(f,protection(f),true);await tick();
  await f.open();assert.equal(protection(f).checked,true);
  await f.w.AltaCartNmi.offer(f.cartRoot);await tick();
  assert.deepEqual(f.requests.at(-1).delivery.extras,['protection']);
  assert.ok(f.cartRoot.querySelector('.nlc-protection-static'));
 }finally{f.dom.window.close();}
});

test('changing to a destination without next-day falls back to standard without changing protection',async()=>{
 const f=fixture('?bulk=1','CA');
 try{
  await f.open();
  choose(f,f.root.querySelector('[name=shipping_speed][value=next_day]'),true);await tick();
  choose(f,f.root.querySelector('[name=country]'),'GB');await tick();
  assert.equal(f.root.querySelector('[name=shipping_speed][value=next_day]').disabled,true);
  assert.equal(f.requests.at(-1).delivery.shipping,'standard');
  assert.deepEqual(f.requests.at(-1).delivery.extras,['protection']);
  assert.equal(f.quotes.at(-1).shipping_cents,6495);
 }finally{f.dom.window.close();}
});
