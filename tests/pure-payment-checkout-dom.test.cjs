'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{webcrypto}=require('node:crypto');
const {JSDOM,VirtualConsole}=require('jsdom');
const checkout=require('../lib/direct-checkout'),config=require('../config/checkout.json'),delivery=require('../config/delivery-options.json'),zones=require('../config/shipping-zones.json');
const tick=()=>new Promise(resolve=>setTimeout(resolve,45));
const card={id:'11111111-1111-4111-8111-111111111111',kind:'hosted_link',native_provider:'rampex',rampex_provider:'hosted',countries:['US','CA'],currency:'USD',version:2,sale_scope:'goods',label:'Card'};
const cryptoMethod={...card,id:'22222222-2222-4222-8222-222222222222',native_provider:'polygon_usdc',rampex_provider:null,label:'Crypto'};
const interacMethod={id:'33333333-3333-4333-8333-333333333333',kind:'interac',provider_key:'interac',payment_kind:'interac',currency:'CAD',countries:['CA'],version:3,sale_scope:'goods',label:'Interac e-Transfer'};
function fixture({cryptoReady=false,interacReady=false,payment={state:'unknown'},country='US',mobile=false,wallet=null,query='',balances={points:0,credit_cents:0},placeResult=null,finalQuotePatch=null,fxPpm=1400000,cadPreviewDelay=0}={}){
 const dom=new JSDOM('<main id="root"></main>',{url:'https://getpurelabs.test/checkout'+(query|| (wallet?'?wallet='+wallet:'')),runScripts:'outside-only',virtualConsole:new VirtualConsole()}),w=dom.window;
 const media={matches:mobile,listeners:new Set(),addEventListener(_event,callback){this.listeners.add(callback);},removeEventListener(_event,callback){this.listeners.delete(callback);}};w.matchMedia=()=>media;
 Object.defineProperty(w,'crypto',{value:webcrypto});w.TextEncoder=TextEncoder;w.HTMLElement.prototype.scrollIntoView=()=>{};
 const cart=[{id:'compound',key:'compound:10mg',name:'Compound',size:'10mg',qty:2,price:100}],methods=[card,...(cryptoReady?[cryptoMethod]:[]),...(interacReady?[interacMethod]:[])];
 w.localStorage.setItem('pp-cart',JSON.stringify(cart));
 w.localStorage.setItem('ap-bulk-draft-v2',JSON.stringify(cart));
 w.AltaStore={cart,catalog:[],product:()=>({}),image:()=>'/fixture.webp',normalizeLines:items=>items,read:(key,fallback)=>JSON.parse(w.localStorage.getItem(key)||JSON.stringify(fallback))};
 const data={config,delivery_options:delivery,shipping_zones:zones,methods,balances,events:[]};
 const fx={fx_ppm:fxPpm,source:'Fixture exchange rate',series:'FIXTURE',rate_date:'2026-11-18',quoted_at:'2026-11-18T12:00:00Z',expires_at:'2026-11-18T12:30:00Z',token:'fixture-fx-'+fxPpm};
 const requests=[];
 const quote=body=>{
  const method=methods.find(m=>m.id===body.method_id)||{kind:'hosted_link',sale_scope:'goods'};
  const record={kind:'goods',request:{items:body.items.map(item=>({...item,name:'Compound',unit_price_usd_cents:10000})),address:{country:body.country||body.address?.country||country},checkout:{coupon:body.coupon||'',points:body.points||0,credit_cents:body.credit_cents||0,delivery:body.delivery}}};
  const priced=checkout.price(record,method,null,balances,null,delivery,method.id===interacMethod.id?fx:null);
  return {...priced,quote:'fixture-verified-quote',free_shipping_threshold_cents:15000,free_shipping_remaining_cents:Math.max(0,15000-priced.subtotal_cents+priced.discount_cents)};
 };
 w.fetch=async(url,options={})=>{
  const body=options.body?JSON.parse(options.body):null;if(body)requests.push({url:String(url),body});
  if(String(url).includes('native=customer'))return{ok:true,json:async()=>payment};
  if(body?.action==='place'){const result=body.method_id===interacMethod.id?{id:body.id,status:'accepted',manual_transfer:true,currency:'CAD',total_cents:quote(body).total_cents}:{id:body.id,status:'accepted'};return{ok:true,json:async()=>placeResult?placeResult(body,w,result):result};}
  if(body)return{ok:true,json:async()=>{if(cadPreviewDelay&&body.method_id===interacMethod.id&&!body.action)await new Promise(resolve=>setTimeout(resolve,cadPreviewDelay));const current=quote(body),patch=body.action==='quote'?(typeof finalQuotePatch==='function'?finalQuotePatch(body,requests.filter(r=>r.body.action==='quote').length,current):finalQuotePatch):null;return{...current,...patch};}};
  return{ok:true,json:async()=>data};
 };
 const auth={auth:{getSession:async()=>({data:{session:{access_token:'isolated-dom-checkout-token'}}})}};
 const user={email:'fixture@example.test',user_metadata:{full_name:'Fixture Researcher',alta_profile:{shipping:{name:'Fixture Researcher',line1:'123 Test Street',city:'Test City',region:'ON',postal_code:'N2L 1A1',country,phone:'3055550157'}}}};
 for(const file of ['readiness-ui.js','direct-checkout-client.js','checkout-reference.js'])w.eval(fs.readFileSync(file,'utf8'));
 const root=w.document.getElementById('root');
 return{dom,w,root,requests,auth,fx,quote,setMobile(value){media.matches=value;for(const callback of media.listeners)callback(media);},async open(){await w.DirectCheckout.checkout(root,auth,user);await tick();},async paymentStep(){root.querySelector('[data-nlx-next]').click();await tick();root.querySelector('[data-nlx-next]').click();await tick();}};
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
  assert.equal(pay.confirm_amount_cents,19500);assert.equal(pay.crypto_conversion_consent,true);
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
  assert.match(f.root.querySelector('[data-nlx-totals]').textContent,/Quantity savings.*\$10\.00.*Crypto discount \(5%\).*\$9\.50.*\$180\.50/);
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
  assert.match(f.root.querySelector('[data-nlx-totals]').textContent,/Quantity savings.*\$10\.00.*\$190\.00/);
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

test('Canadian Interac checkout shows actual CAD totals, preserves coupons, and places an unpaid order without a native payment',async()=>{
 const f=fixture({country:'CA',interacReady:true,cryptoReady:true,balances:{points:500,credit_cents:1000}});
 try{
  await f.open();await f.paymentStep();
  assert.deepEqual([...f.root.querySelectorAll('[name=payment_choice]')].map(input=>input.value),['card','crypto','interac']);
  change(f,f.root.querySelector('[name=payment_choice][value=interac]'),true);await tick();
  f.root.querySelector('[name=sidebar_coupon]').value='BLACKFRIDAY15';f.root.querySelector('[data-nlx-coupon]').click();await tick();
  assert.match(f.root.querySelector('.nlx-summary-head h2').textContent,/CAD/);
  assert.match(f.root.querySelector('[data-nlx-totals]').textContent,/BLACKFRIDAY15 \(15%\).*CA\$42\.00.*Total \(CAD\)/);
  assert.doesNotMatch(f.root.querySelector('[data-nlx-totals]').textContent,/Crypto discount|USD/);
  assert.equal(f.root.querySelector('.nlx-product-price').textContent,'CA$280.00');assert.equal(f.root.querySelector('.nlx-protection-price').textContent,'CA$7.00');
  assert.equal(f.root.querySelector('[data-nlx-confirm-shipping-price]').textContent,'CA$0.00');
  assert.match(f.root.querySelector('[data-nlx-points]').textContent,/USD points and store credit cannot be applied/);
  assert.equal(f.root.querySelector('[data-nlx-points] a'),null);
  assert.match(f.root.querySelector('[data-nlx-payment-currency]').textContent,/order total is shown in CAD/);
  assert.doesNotMatch(f.root.textContent,/invoice|request a|USD estimate/i);
  const place=f.root.querySelector('[data-nlx-place]');assert.equal(place.textContent,'PLACE ORDER · CA$245.00');assert.equal(place.disabled,true);
  consent(f);place.click();place.click();await tick();await tick();
  const placed=f.requests.find(r=>r.body.action==='place').body;
  assert.equal(placed.method_id,interacMethod.id);assert.equal(placed.points,0);assert.equal(placed.credit_cents,0);assert.equal(placed.coupon,'BLACKFRIDAY15');
  assert.equal(placed.fx_quote,f.fx.token);assert.equal(f.requests.find(r=>r.body.action==='quote').body.fx_quote,f.fx.token);
  assert.equal(f.requests.filter(r=>r.body.action==='place').length,1);
  assert.equal(f.requests.filter(r=>r.url.includes('native=customer')||r.body.action==='pay').length,0);
  assert.match(f.root.textContent,/order is saved.*Interac payment details/);
  assert.equal(f.w.localStorage.getItem('pp-cart'),null);
  await assert.rejects(f.w.DirectCheckout.openHostedPayment(f.auth,placed.id,30093,'CAD',interacMethod),/Interac receiving details in My Orders/);
  assert.equal(f.requests.filter(r=>r.body.action==='pay').length,0);
 }finally{f.dom.window.close();}
});

test('Interac waits for CAD pricing instead of relabeling USD and leaves the cart and protection choice unchanged',async()=>{
 const f=fixture({country:'CA',interacReady:true,cadPreviewDelay:140,fxPpm:1376543});
 try{
  await f.open();await f.paymentStep();const before=f.w.localStorage.getItem('pp-cart'),protection=f.w.sessionStorage.getItem('ap-checkout-protection');
  change(f,f.root.querySelector('[name=payment_choice][value=interac]'),true);
  assert.equal(f.root.querySelector('.nlx-product-price').textContent,'Calculating…');assert.equal(f.root.querySelector('.nlx-protection-price').textContent,'Calculating…');
  assert.equal(f.root.querySelector('[data-nlx-confirm-shipping-price]').textContent,'Calculating…');assert.match(f.root.querySelector('[data-nlx-place]').textContent,/Calculating/);
  assert.equal(f.root.querySelector('[data-nlx-place]').disabled,true);assert.doesNotMatch(f.root.querySelector('[data-nlx-totals]').textContent,/CA\$200/);
  await new Promise(resolve=>setTimeout(resolve,180));
  assert.equal(f.root.querySelector('.nlx-product-price').textContent,'CA$275.30','The product total uses per-unit CAD rounding from the server');
  assert.equal(f.w.localStorage.getItem('pp-cart'),before);assert.equal(f.w.AltaStore.cart[0].price,100);assert.equal(f.w.sessionStorage.getItem('ap-checkout-protection'),protection);
  change(f,f.root.querySelector('[name=payment_choice][value=card]'),true);await tick();
  assert.equal(f.root.querySelector('.nlx-product-price').textContent,'$200.00');assert.equal(f.root.querySelector('.nlx-protection-price').textContent,'$5.00');
  assert.equal(f.w.localStorage.getItem('pp-cart'),before);
 }finally{f.dom.window.close();}
});

test('a preferred Interac route converts cross-sells, all shipping choices, priority, and protection with the same rate',async()=>{
 const f=fixture({country:'CA',interacReady:true,query:'?method='+interacMethod.id});
 try{
  f.w.AltaStore.catalog.push({id:'extra',name:'Extra compound',variants:[{size:'5mg',price:30}]});await f.open();
  assert.equal(f.root.querySelector('[data-nlx-cross-sell-price]').textContent,'CA$42.00');
  f.root.querySelector('[data-nlx-next]').click();await tick();
  const prices=[...f.root.querySelectorAll('.nlx-delivery-price')].map(target=>target.textContent);
  assert.deepEqual(prices,['FREE','CA$83.93','CA$97.93']);assert.equal(f.root.querySelector('[data-nlx-extra-price=priority]').textContent,'CA$13.99');
  assert.equal(f.root.querySelector('.nlx-protection-price').textContent,'CA$7.00');
  change(f,f.root.querySelector('[data-nlx-extra=priority]'),true);await new Promise(resolve=>setTimeout(resolve,230));
  assert.match(f.root.querySelector('[data-nlx-totals]').textContent,/Priority ProcessingCA\$13\.99/);
  assert.equal(f.requests.at(-1).body.fx_quote,f.fx.token);
 }finally{f.dom.window.close();}
});

test('a preferred Interac route cannot strand a non-Canadian checkout before payment selection',async()=>{
 const f=fixture({country:'US',interacReady:true,query:'?method='+interacMethod.id});
 try{await f.open();await f.paymentStep();assert.equal(f.root.querySelector('[name=payment_choice][value=card]').checked,true);assert.equal(f.root.querySelector('[name=payment_choice][value=interac]').disabled,true);}
 finally{f.dom.window.close();}
});

test('replayed paid or canceled Interac orders open the existing order without another transfer',async()=>{
 for(const status of ['paid','void']){
  const f=fixture({country:'CA',interacReady:true,placeResult:(_body,_w,result)=>({...result,status,replayed:true})});
  try{
   await f.open();await f.paymentStep();change(f,f.root.querySelector('[name=payment_choice][value=interac]'),true);await tick();consent(f);f.root.querySelector('[data-nlx-place]').click();await tick();await tick();
   assert.equal(f.requests.filter(r=>r.body.action==='pay').length,0);assert.match(f.root.textContent,/order is saved/);
   assert.equal(f.w.localStorage.getItem('pp-cart')===null,status==='paid');
  }finally{f.dom.window.close();}
 }
});

test('Interac is destination-restricted and switching back restores Card or Crypto totals and actions',async()=>{
 for(const country of ['US','CA']){
  const f=fixture({country,interacReady:true,cryptoReady:true});
  try{
   await f.open();await f.paymentStep();
   const input=f.root.querySelector('[name=payment_choice][value=interac]');assert.equal(input.disabled,country!=='CA');
   if(country==='CA'){
    change(f,input,true);await tick();assert.equal(f.root.querySelector('[data-nlx-place]').textContent,'PLACE ORDER · CA$273.00');
    change(f,f.root.querySelector('[name=payment_choice][value=crypto]'),true);await tick();
    assert.match(f.root.querySelector('[data-nlx-totals]').textContent,/Crypto discount \(5%\)/);
    assert.match(f.root.querySelector('[data-nlx-place]').textContent,/CONTINUE TO CRYPTO PAYMENT/);
    assert.equal(f.root.querySelector('.nlx-summary-head h2').textContent,'Order Summary');
    change(f,f.root.querySelector('[name=payment_choice][value=card]'),true);await tick();
    assert.doesNotMatch(f.root.querySelector('[data-nlx-totals]').textContent,/Crypto discount|Estimated total \(USD\)/);
    assert.match(f.root.querySelector('[data-nlx-place]').textContent,/CONTINUE TO CARD PAYMENT/);
   }
   assert.equal(f.requests.filter(r=>r.body.action==='place').length,0);
  }finally{f.dom.window.close();}
 }
});

test('Interac does not clear the cart or request payment after an unverified quote or order response',async()=>{
 for(const options of [{finalQuotePatch:{currency:'USD'}},{finalQuotePatch:{total_cents:99999}},{placeResult:body=>({id:body.id,status:'requested',request_only:true})},{placeResult:()=>({id:'wrong-order',status:'accepted',currency:'CAD',manual_transfer:true})}]){
  const f=fixture({country:'CA',interacReady:true,...options});
  try{
   await f.open();await f.paymentStep();change(f,f.root.querySelector('[name=payment_choice][value=interac]'),true);await tick();consent(f);
   f.root.querySelector('[data-nlx-place]').click();await tick();await tick();
   assert.notEqual(f.w.localStorage.getItem('pp-cart'),null);
   assert.equal(f.requests.filter(r=>r.body.action==='pay').length,0);
   if(options.finalQuotePatch)assert.equal(f.requests.filter(r=>r.body.action==='place').length,0);
   else assert.ok(f.root.querySelector('a[href^="/account/purchases?id="]'));
  }finally{f.dom.window.close();}
 }
});

test('successful Interac placement preserves a cart that changed while the order was saving',async()=>{
 const f=fixture({country:'CA',interacReady:true,placeResult:(body,w,result)=>{w.AltaStore.cart[0].qty=3;w.localStorage.setItem('pp-cart',JSON.stringify(w.AltaStore.cart));return result;}});
 try{
  await f.open();await f.paymentStep();change(f,f.root.querySelector('[name=payment_choice][value=interac]'),true);await tick();consent(f);
  f.root.querySelector('[data-nlx-place]').click();await tick();await tick();
  assert.equal(JSON.parse(f.w.localStorage.getItem('pp-cart'))[0].qty,3);
  assert.equal(f.requests.filter(r=>r.body.action==='pay').length,0);
 }finally{f.dom.window.close();}
});

test('balance and bulk checkout disable USD redemptions and show every amount in CAD before Interac placement',async()=>{
 for(const mode of ['balance','bulk']){
  const f=fixture({country:'CA',interacReady:true,query:'?'+mode+'=1',balances:{points:500,credit_cents:1000}});
  try{
   await f.open();const form=f.root.querySelector('form');form.querySelector('[data-step-next="0"]').click();form.querySelector('[data-step-next="1"]').click();
   form.elements.points.value='200';form.elements.credit.value='5';
   change(f,form.querySelector('[data-payment-kind=interac]'),true);
   assert.equal(form.elements.points.value,'0');assert.equal(form.elements.credit.value,'0');assert.equal(form.elements.points.disabled,true);assert.equal(form.elements.credit.disabled,true);
   assert.match(form.querySelector('[data-dc-balance-note]').textContent,/held in USD and cannot be applied/);
   await new Promise(resolve=>setTimeout(resolve,230));
   assert.match(f.root.querySelector('.dc-totals').textContent,/Total \(CAD\).*CA\$273\.00/);
   assert.equal(f.root.querySelector('[data-dc-line-price]').textContent,'CA$280.00');
   assert.equal(form.querySelector('[data-rd-shipping-price=standard]').textContent,'FREE');
   assert.equal(form.querySelector('[data-rd-extra-price=protection]').textContent,'CA$7.00');
   assert.match(f.root.querySelector('.dc-totals').textContent,/USD points and store credit cannot be applied/);
   form.elements.research_use.checked=true;form.elements.consent.checked=true;await form.onsubmit({preventDefault(){}});
   assert.match(f.root.querySelector('.dc-review-summary').textContent,/ORDER TOTAL · CAD/);
   assert.doesNotMatch(f.root.textContent,/invoice|USD estimate/i);
   assert.equal(form.elements.points.disabled,true);
   const request=f.requests.find(r=>r.body.action==='quote').body;assert.equal(request.points,0);assert.equal(request.credit_cents,0);assert.equal(request.bulk_order,mode==='bulk');
   assert.ok(f.requests.filter(r=>r.url.includes('checkout=cart')).every(r=>r.body.bulk_order===(mode==='bulk')));
   const place=f.root.querySelector('.dc-summary button');assert.equal(place.textContent,'Place order · CA$273.00');await place.onclick();
   assert.equal(request.fx_quote,f.fx.token);assert.equal(f.requests.find(r=>r.body.action==='place').body.fx_quote,f.fx.token);
   assert.equal(f.requests.filter(r=>r.body.action==='place').length,1);assert.equal(f.requests.find(r=>r.body.action==='place').body.bulk_order,mode==='bulk');assert.equal(f.requests.filter(r=>r.body.action==='pay').length,0);
   assert.equal(f.w.localStorage.getItem(mode==='bulk'?'ap-bulk-draft-v2':'pp-cart'),null);
  }finally{f.dom.window.close();}
 }
});

test('bulk placement renews an expired rate at the same CAD total before saving the order',async()=>{
 const f=fixture({country:'CA',interacReady:true,query:'?bulk=1&method='+interacMethod.id,finalQuotePatch:(_body,n)=>n>=2?{fx_quote:'renewed-fx-token',quote:'renewed-quote-hash'}:{}});
 try{
  await f.open();const form=f.root.querySelector('form');form.querySelector('[data-step-next="0"]').click();form.querySelector('[data-step-next="1"]').click();form.elements.research_use.checked=true;form.elements.consent.checked=true;
  await form.onsubmit({preventDefault(){}});await f.root.querySelector('.dc-summary button').onclick();
  assert.equal(f.requests.filter(r=>r.body.action==='quote').length,2);
  const placed=f.requests.find(r=>r.body.action==='place').body;assert.equal(placed.fx_quote,'renewed-fx-token');assert.equal(placed.quote,'renewed-quote-hash');
  assert.equal(f.w.localStorage.getItem('ap-bulk-draft-v2'),null);assert.equal(f.requests.filter(r=>r.body.action==='pay').length,0);
 }finally{f.dom.window.close();}
});

test('bulk placement with an expired changed rate shows the new CAD price and requires another explicit click',async()=>{
 const f=fixture({country:'CA',interacReady:true,query:'?bulk=1&method='+interacMethod.id,
  finalQuotePatch:(_body,n,q)=>n>=2?{fx_quote:'new-rate-token',quote:'new-rate-hash',subtotal_cents:30000,shipping_cents:6743,total_cents:36743,pricing:{...q.pricing,fx_ppm:1500000,lines:q.pricing.lines.map(line=>({...line,unit_price_cents:15000,gross_cents:30000,line_total_cents:30000})),delivery:{...q.pricing.delivery,shipping_cents:5993,extras:[{id:'protection',label:'Shipping Protection',amount_cents:750}],extras_cents:750,total_cents:6743}}}:{},
  placeResult:(_body,_w,result)=>({...result,total_cents:36743})});
 try{
  await f.open();const form=f.root.querySelector('form');form.querySelector('[data-step-next="0"]').click();form.querySelector('[data-step-next="1"]').click();form.elements.research_use.checked=true;form.elements.consent.checked=true;
  await form.onsubmit({preventDefault(){}});const place=f.root.querySelector('.dc-summary button');await place.onclick();
  assert.equal(f.requests.filter(r=>r.body.action==='place').length,0);assert.match(f.root.textContent,/CAD price has updated/);
  assert.equal(place.textContent,'Place order · CA$367.43');assert.equal(place.disabled,false);assert.equal(f.root.querySelector('[data-dc-line-price]').textContent,'CA$300.00');
  assert.equal(f.root.querySelector('a[href^="/account/purchases?id="]'),null);assert.notEqual(f.w.localStorage.getItem('ap-bulk-draft-v2'),null);
  await place.onclick();assert.equal(f.requests.filter(r=>r.body.action==='place').length,1);assert.equal(f.requests.find(r=>r.body.action==='place').body.fx_quote,'new-rate-token');assert.equal(f.w.localStorage.getItem('ap-bulk-draft-v2'),null);
 }finally{f.dom.window.close();}
});

test('a failed final CAD quote keeps bulk checkout editable without a nonexistent saved-order link',async()=>{
 const f=fixture({country:'CA',interacReady:true,query:'?bulk=1&method='+interacMethod.id,finalQuotePatch:(_body,n)=>{if(n===2)throw Error('CAD exchange rate temporarily unavailable.');return{};}});
 try{
  await f.open();const form=f.root.querySelector('form');form.querySelector('[data-step-next="0"]').click();form.querySelector('[data-step-next="1"]').click();form.elements.research_use.checked=true;form.elements.consent.checked=true;
  await form.onsubmit({preventDefault(){}});const place=f.root.querySelector('.dc-summary button');await place.onclick();
  assert.equal(f.requests.filter(r=>r.body.action==='place').length,0);assert.equal(place.disabled,false);assert.match(f.root.textContent,/exchange rate temporarily unavailable/);
  assert.equal(f.root.querySelector('a[href^="/account/purchases?id="]'),null);assert.notEqual(f.w.localStorage.getItem('ap-bulk-draft-v2'),null);
  await place.onclick();assert.equal(f.requests.filter(r=>r.body.action==='place').length,1);
 }finally{f.dom.window.close();}
});
