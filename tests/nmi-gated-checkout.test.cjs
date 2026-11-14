'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),{JSDOM}=require('jsdom');
const source=path.join(__dirname,'..');
const ready={ready:true,method_id:'nmi-method-fixture',tokenization_key:'public-fixture-token-key',three_ds:false,wallets:{apple:true,google:true}};
test('NMI widget is gated by the exact active method and wallet permissions',async()=>{
 const dom=new JSDOM('<div id="mount"></div><form id="form"><input name="name" value="Research Scientist"><input name="line1" value="123 Lab Street"><input name="city" value="Miami"><input name="region" value="FL"><input name="postal_code" value="33101"><input name="country" value="US"></form>',{url:'https://altapurelabs.com/checkout',runScripts:'outside-only'}),w=dom.window;
 Object.defineProperty(w.crypto,'randomUUID',{value:()=> '00000000-0000-4000-8000-000000000001'});
 let captured,paid=0,destroyed=false;
 w.mountNmiPayments=(_target,config)=>{captured=config;return{destroy(){destroyed=true}}};
 w.eval(fs.readFileSync(path.join(source,'nmi-inline-checkout.js'),'utf8'));
 assert.equal(w.AltaNmiInline.available(ready,'nmi-method-fixture'),true);
 assert.equal(w.AltaNmiInline.available({...ready,ready:false},'nmi-method-fixture'),false);
 assert.equal(w.AltaNmiInline.available(ready,'wrong-method'),false);
 const mount=w.document.getElementById('mount'),form=w.document.getElementById('form');
 const component=await w.AltaNmiInline.mount({host:mount,config:ready,methodId:'nmi-method-fixture',amount:7900,currency:'USD',form,onPayment:async detail=>{paid++;assert.equal(detail.billing.country,'US');assert.equal(detail.token,'one-time-token-123456');return{paid:true}}});
 assert.deepEqual([...captured.paymentMethods],['card','apple-pay','google-pay']);
 assert.equal(captured.expressCheckoutConfig.amount,'79.00');
 assert.equal(captured.tokenizationKey,ready.tokenization_key);
 assert.equal(await captured.onExpressCheckout({token:'one-time-token-123456'}),true);
 await captured.onPay({token:'one-time-token-123456'});assert.equal(paid,1,'Duplicate wallet submission must not charge twice');
 component.destroy();assert.equal(destroyed,true);
 dom.window.close();
});
test('Wallets never appear from synthetic configuration flags without a real live method',()=>{
 const direct=require('../lib/direct-checkout');
 const m=[{id:'nmi-method-fixture',native_provider:'nmi'}];
 assert.equal(direct.capabilities(m,{NMI_APPLE_PAY_ENABLED:'true'}).apple_pay,false);
 assert.equal(direct.nmiPublicConfig(m,{NMI_APPLE_PAY_ENABLED:'true'}),null);
 const env={NMI_API_KEY:'private-fixture',NMI_TOKENIZATION_KEY:'public-fixture-token-key',NMI_WEBHOOK_KEY:'private-webhook',
  NMI_MERCHANT_ID:'fixture-merchant',NMI_CURRENCIES:'USD',NMI_MODE:'live',NMI_ENABLED:'true',NMI_APPLE_PAY_ENABLED:'true',NMI_GOOGLE_PAY_ENABLED:'true'};
 const configured=direct.nmiPublicConfig(m,env);
 assert.equal(configured?.ready,true);
 assert.equal(configured.tokenization_key,env.NMI_TOKENIZATION_KEY);
 assert.ok(!JSON.stringify(configured).includes('private-fixture'));
 assert.ok(!JSON.stringify(configured).includes('private-webhook'));
});
test('Cart express button is inert/absent unless authorized NMI wallet methods are active',async()=>{
 for(const active of [false,true]){
  const dom=new JSDOM('<div id="cart"><p class="ap-cart-note">Cart</p></div>',{url:'https://altapurelabs.com/shop',runScripts:'outside-only'}),w=dom.window;
  w.AltaStore={cart:[{id:'bpc',qty:1}]};
  w.fetch=async()=>({ok:true,json:async()=>({nmi:active?ready:null,capabilities:{apple_pay:active,google_pay:active}})});
  w.eval(fs.readFileSync(path.join(source,'cart-nmi-express.js'),'utf8'));
  await w.AltaCartNmi.offer(w.document.getElementById('cart'));
  assert.equal(!!w.document.querySelector('[data-nmi-express]'),active);
  dom.window.close();
 }
});
test('NMI checkout is a same-page tokenized order-confirmation flow, not an onramp redirect',()=>{
 const s=fs.readFileSync(path.join(source,'direct-checkout-client.js'),'utf8');
 assert.match(s,/selected\?\.native_provider==='nmi'/);
 assert.match(s,/window.AltaNmiInline.mount/);
 assert.match(s,/chargeNmi/);
 assert.match(s,/Payment confirmed/);
 assert.match(s,/Payment verification is pending/);
 const nmi=fs.readFileSync(path.join(source,'nmi-inline-checkout.js'),'utf8');
 assert.doesNotMatch(nmi,/checkout\.rampex\.io|window\.location\.assign/);
 assert.match(nmi,/onExpressCheckout:pay/);
});
