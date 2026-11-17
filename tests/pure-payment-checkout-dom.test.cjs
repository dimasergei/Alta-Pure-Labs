'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{webcrypto}=require('node:crypto');
const {JSDOM,VirtualConsole}=require('jsdom');
const checkout=require('../lib/direct-checkout'),config=require('../config/checkout.json'),delivery=require('../config/delivery-options.json'),zones=require('../config/shipping-zones.json');
const tick=()=>new Promise(resolve=>setTimeout(resolve,45));
const card={id:'11111111-1111-4111-8111-111111111111',kind:'hosted_link',native_provider:'rampex',rampex_provider:'hosted',countries:['US','CA'],currency:'USD',version:2,sale_scope:'goods',label:'Card'};
const cryptoMethod={...card,id:'22222222-2222-4222-8222-222222222222',native_provider:'polygon_usdc',rampex_provider:null,label:'Crypto'};
function fixture({cryptoReady=false,payment={state:'unknown'},country='US',mobile=false,wallet=null}={}){
 const dom=new JSDOM('<main id="root"></main>',{url:'https://getpurelabs.test/checkout'+(wallet?'?wallet='+wallet:''),runScripts:'outside-only',virtualConsole:new VirtualConsole()}),w=dom.window;
 const media={matches:mobile,listeners:new Set(),addEventListener(_event,callback){this.listeners.add(callback);},removeEventListener(_event,callback){this.listeners.delete(callback);}};w.matchMedia=()=>media;
 Object.defineProperty(w,'crypto',{value:webcrypto});w.TextEncoder=TextEncoder;w.HTMLElement.prototype.scrollIntoView=()=>{};
 const cart=[{id:'compound',key:'compound:10mg',name:'Compound',size:'10mg',qty:2,price:100}],methods=cryptoReady?[card,cryptoMethod]:[card];
 w.localStorage.setItem('pp-cart',JSON.stringify(cart));
 w.AltaStore={cart,catalog:[],product:()=>({}),image:()=>'/fixture.webp'};
 const data={config,delivery_options:delivery,shipping_zones:zones,methods,balances:{points:0,credit_cents:0},events:[]};
 const requests=[];
 const quote=body=>{
  const method=methods.find(m=>m.id===body.method_id)||{kind:'hosted_link',sale_scope:'goods'};
  const record={kind:'goods',request:{items:body.items.map(item=>({...item,name:'Compound',unit_price_usd_cents:10000})),address:{country:body.country||body.address?.country||country},checkout:{coupon:body.coupon||'',points:0,credit_cents:0,delivery:body.delivery}}};
  const priced=checkout.price(record,method,null,{points:0,credit_cents:0});
  return {...priced,quote:'fixture-verified-quote',free_shipping_threshold_cents:15000,free_shipping_remaining_cents:Math.max(0,15000-priced.subtotal_cents+priced.discount_cents)};
 };
 w.fetch=async(url,options={})=>{
  const body=options.body?JSON.parse(options.body):null;if(body)requests.push({url:String(url),body});
  if(String(url).includes('native=customer'))return{ok:true,json:async()=>payment};
  if(body?.action==='place')return{ok:true,json:async()=>({id:body.id,status:'accepted'})};
  if(body)return{ok:true,json:async()=>quote(body)};
  return{ok:true,json:async()=>data};
 };
 const auth={auth:{getSession:async()=>({data:{session:{access_token:'isolated-dom-checkout-token'}}})}};
 const user={email:'fixture@example.test',user_metadata:{full_name:'Fixture Researcher',alta_profile:{shipping:{name:'Fixture Researcher',line1:'123 Test Street',city:'Test City',region:'ON',postal_code:'N2L 1A1',country,phone:'3055550157'}}}};
 for(const file of ['readiness-ui.js','direct-checkout-client.js','checkout-reference.js'])w.eval(fs.readFileSync(file,'utf8'));
 const root=w.document.getElementById('root');
 return{dom,w,root,requests,auth,setMobile(value){media.matches=value;for(const callback of media.listeners)callback(media);},async open(){await w.DirectCheckout.checkout(root,auth,user);await tick();},async paymentStep(){root.querySelector('[data-nlx-next]').click();await tick();root.querySelector('[data-nlx-next]').click();await tick();}};
}
function change(f,control,value){if(control.type==='checkbox'||control.type==='radio')control.checked=value;else control.value=value;control.dispatchEvent(new f.w.Event('change',{bubbles:true}));}
function consent(f){for(const name of ['ruo','responsibility'])change(f,f.root.querySelector('[name='+name+']'),true);}

test('regular checkout has two honest choices and one saved-order handoff; unknown result cannot duplicate payment',async()=>{
 const f=fixture();
 try{
  await f.open();await f.paymentStep();
  assert.deepEqual([...f.root.querySelectorAll('[name=payment_choice]')].map(control=>control.value),['card','crypto']);
  assert.equal(f.root.querySelector('[value=crypto]').disabled,true);
  assert.doesNotMatch(f.root.textContent,/ByteNFT|bank transfer|No Fees!|Awaiting activation/);
  assert.equal(f.root.querySelectorAll('[data-nlx-wallet]').length,2);
  consent(f);const place=f.root.querySelector('[data-nlx-place]');assert.equal(place.disabled,false);
  place.click();place.click();await tick();await tick();
  assert.equal(f.requests.filter(r=>r.body.action==='quote').length,1);
  assert.equal(f.requests.filter(r=>r.body.action==='place').length,1);
  assert.equal(f.requests.filter(r=>r.body.action==='pay').length,1);
  const pay=f.requests.find(r=>r.body.action==='pay').body;
  assert.equal(pay.confirm_amount_cents,20500);assert.equal(pay.crypto_conversion_consent,true);
  assert.equal(place.disabled,true);assert.equal(f.root.querySelector('[data-nlx-extra=protection]').disabled,true);
  assert.ok([...f.root.querySelectorAll('[data-nlx-qty]')].every(control=>control.disabled));
  assert.ok(f.root.querySelector('a[href^="/account/purchases?id="]'));
  assert.notEqual(f.w.localStorage.getItem('pp-cart'),null,'Uncertain payment retains the cart');
  place.click();await tick();assert.equal(f.requests.filter(r=>r.body.action==='pay').length,1);
 }finally{f.dom.window.close();}
});
test('method and coupon changes requote correctly and preserve explicit shipping-protection opt-out',async()=>{
 const f=fixture({cryptoReady:true});
 try{
  await f.open();change(f,f.root.querySelector('[data-nlx-extra=protection]'),false);await tick();await tick();
  await f.paymentStep();change(f,f.root.querySelector('[name=payment_choice][value=crypto]'),true);await tick();
  assert.equal(f.root.querySelector('[data-nlx-extra=protection]').checked,false);
  assert.match(f.root.querySelector('[data-nlx-totals]').textContent,/Crypto discount \(5%\).*\$190\.00/);
  assert.deepEqual(f.requests.at(-1).body.delivery.extras,[]);
  f.root.querySelector('[name=sidebar_coupon]').value='BLACKFRIDAY15';f.root.querySelector('[data-nlx-coupon]').click();await tick();
  assert.match(f.root.querySelector('[data-nlx-totals]').textContent,/BLACKFRIDAY15 \(15%\).*\$30\.00.*Crypto discount \(5%\).*\$8\.50.*\$161\.50/);
  assert.match(f.root.querySelector('[data-nlx-quote-note]').textContent,/coupon is applied first, then an extra 5%/);
  change(f,f.root.querySelector('[name=payment_choice][value=card]'),true);await tick();
  assert.match(f.root.querySelector('[data-nlx-totals]').textContent,/BLACKFRIDAY15 \(15%\).*\$30\.00.*\$170\.00/);
  assert.doesNotMatch(f.root.querySelector('[data-nlx-totals]').textContent,/Crypto discount/);
  change(f,f.root.querySelector('[name=payment_choice][value=crypto]'),true);await tick();
  assert.match(f.root.querySelector('[data-nlx-totals]').textContent,/Crypto discount \(5%\).*\$8\.50.*\$161\.50/);
  f.root.querySelector('[data-nlx-remove-coupon]').click();await tick();
  assert.match(f.root.querySelector('[data-nlx-totals]').textContent,/Crypto discount \(5%\)/);
  change(f,f.root.querySelector('[name=payment_choice][value=card]'),true);await tick();
  assert.doesNotMatch(f.root.querySelector('[data-nlx-totals]').textContent,/Crypto discount/);
  assert.match(f.root.querySelector('[data-nlx-totals]').textContent,/\$200\.00/);
  assert.equal(f.root.querySelector('[data-nlx-extra=protection]').checked,false);
 }finally{f.dom.window.close();}
});
test('Canada Card checkout is available while an unsupported payment destination cannot place an order',async()=>{
 for(const country of ['CA','GB']){
  const f=fixture({country});
  try{
   await f.open();await f.paymentStep();consent(f);
   assert.equal(f.root.querySelector('[name=payment_choice][value=card]').disabled,country==='GB');
   assert.equal(f.root.querySelector('[data-nlx-place]').disabled,country==='GB');
   assert.ok([...f.root.querySelectorAll('[data-nlx-wallet]')].every(control=>control.disabled===(country==='GB')));
   if(country==='GB'){f.root.querySelector('[data-nlx-place]').click();await tick();assert.equal(f.requests.filter(r=>r.body.action==='place').length,0);}
  }finally{f.dom.window.close();}
 }
});
test('Crypto checkout preserves its discounted order and opens the wallet screen without requesting a transfer',async()=>{
 const f=fixture({cryptoReady:true});
 try{
  await f.open();await f.paymentStep();change(f,f.root.querySelector('[name=payment_choice][value=crypto]'),true);await tick();consent(f);
  f.root.querySelector('[data-nlx-place]').click();await tick();await tick();
  const placed=f.requests.find(r=>r.body.action==='place').body;
  assert.equal(placed.method_id,cryptoMethod.id);assert.equal(placed.delivery.extras[0],'protection');
  assert.equal(f.requests.filter(r=>r.body.action==='pay').length,0,'Only the wallet page can request an explicit transfer');
  const route=await f.w.DirectCheckout.openHostedPayment(f.auth,placed.id,19500,'USD',cryptoMethod);
  assert.equal(route.url,'/pay.html?invoice='+placed.id);
 }finally{f.dom.window.close();}
});
test('a provider return URL alone never confirms payment or permits an unrelated redirect',async()=>{
 for(const payment of [{state:'unknown',redirect_url:'https://checkout.rampex.io/pay/fixture'},{state:'redirected',redirect_url:'https://untrusted.example/pay'},{state:'redirected',redirect_url:'https://checkout.rampex.io/pay/fixture?provider=stripe'}]){
  const f=fixture({payment});
  try{await assert.rejects(f.w.DirectCheckout.openHostedPayment(f.auth,webcrypto.randomUUID(),10000,'USD',card));}
  finally{f.dom.window.close();}
 }
});

test('mobile Shipping, Delivery and Payment actions follow all information and the order summary; desktop positions restore',async()=>{
 const f=fixture({mobile:true});
 const verifyOrder=()=>{
  const action=f.root.querySelector('[data-nlx-next],[data-nlx-place]'),summary=f.root.querySelector('.nlx-right');
  assert.ok(summary.compareDocumentPosition(action)&f.w.Node.DOCUMENT_POSITION_FOLLOWING,'Summary must precede the action in reading and keyboard order');
  assert.ok(f.root.querySelector('.nlx-trust').compareDocumentPosition(action)&f.w.Node.DOCUMENT_POSITION_FOLLOWING,'Trust information precedes the action');
  assert.equal(action.form,f.root.querySelector('#nlx-form'),'Moved action remains associated with the original form');
  assert.equal(f.root.querySelectorAll('[data-nlx-next],[data-nlx-place]').length,1,'Only one action is present');
  f.setMobile(false);
  assert.ok(f.root.querySelector('#nlx-form').contains(action),'Desktop action returns to its original form position');
  assert.ok(action.compareDocumentPosition(summary)&f.w.Node.DOCUMENT_POSITION_FOLLOWING,'Desktop summary stays in the second column after the form');
  f.setMobile(true);
  assert.ok(summary.compareDocumentPosition(action)&f.w.Node.DOCUMENT_POSITION_FOLLOWING);
 };
 try{
  await f.open();verifyOrder();
  f.root.querySelector('[data-nlx-next]').click();await tick();verifyOrder();
  f.root.querySelector('[data-nlx-next]').click();await tick();verifyOrder();
  assert.equal(f.root.querySelector('[data-nlx-place]').disabled,true);
  consent(f);assert.equal(f.root.querySelector('[data-nlx-place]').disabled,false);
  f.root.querySelector('[data-nlx-place]').click();await tick();await tick();
  assert.equal(f.requests.filter(r=>r.body.action==='place').length,1,'The relocated payment button still saves one verified order');
 }finally{f.dom.window.close();}
});
test('wallet preference uses hosted Card, removes crypto discount and never bypasses review or consent',async()=>{
 const f=fixture({cryptoReady:true,wallet:'google',mobile:true});
 try{
  await f.open();await f.paymentStep();
  assert.equal(f.root.querySelector('[data-nlx-wallet=google]').getAttribute('aria-pressed'),'true');
  assert.match(f.root.querySelector('[data-nlx-place]').textContent,/CONTINUE TO GOOGLE PAY/);
  assert.equal(f.root.querySelector('[data-nlx-place]').disabled,true);
  change(f,f.root.querySelector('[name=payment_choice][value=crypto]'),true);await tick();
  f.root.querySelector('[name=sidebar_coupon]').value='BLACKFRIDAY15';f.root.querySelector('[data-nlx-coupon]').click();await tick();
  assert.match(f.root.querySelector('[data-nlx-totals]').textContent,/Crypto discount/);
  f.root.querySelector('[data-nlx-wallet=apple]').click();await tick();
  assert.equal(f.root.querySelector('[name=payment_choice][value=card]').checked,true);
  assert.doesNotMatch(f.root.querySelector('[data-nlx-totals]').textContent,/Crypto discount/);
  assert.match(f.root.querySelector('[data-nlx-totals]').textContent,/BLACKFRIDAY15 \(15%\).*\$30\.00.*\$175\.00/);
  assert.equal(f.requests.at(-1).body.method_id,card.id);
  assert.match(f.root.querySelector('[data-nlx-place]').textContent,/CONTINUE TO APPLE PAY/);
  assert.match(f.root.querySelector('[data-nlx-wallet-note]').textContent,/secure provider checkout if offered/);
  assert.equal(f.requests.filter(r=>['quote','place','pay'].includes(r.body.action)).length,0,'Choosing a wallet neither saves an order nor requests payment');
  assert.equal(f.root.querySelector('[data-nlx-place]').disabled,true);
  consent(f);f.root.querySelector('[data-nlx-place]').click();await tick();await tick();
  assert.equal(f.requests.find(r=>r.body.action==='place').body.method_id,card.id);
  assert.equal(f.requests.filter(r=>r.body.action==='pay').length,1);
  assert.equal('wallet' in f.requests.find(r=>r.body.action==='pay').body,false,'No undocumented wallet flag is sent to the provider');
 }finally{f.dom.window.close();}
});
