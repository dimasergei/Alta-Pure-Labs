'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM,VirtualConsole}=require('jsdom');
const root=path.join(__dirname,'..');
const user={id:'test-user',email:'researcher@example.test',user_metadata:{full_name:'Researcher',alta_profile:{shipping:{name:'Researcher',line1:'123 Test Street',city:'Miami',region:'FL',postal_code:'33101',country:'US'}}}};
const auth={auth:{getSession:async()=>({data:{session:{access_token:'fixture-token-not-real'}}})}};
const orderId='80000000-0000-4000-8000-000000000001';
const quote={quote:'quote-fixture',subtotal_cents:5100,discount_cents:255,shipping_cents:2500,tax_cents:0,points_redeemed:0,credit_redeemed_cents:0,earned_points:48,total_cents:7345,currency:'USD',pricing:{lines:[],shipping_note:'US delivery'}};
const checkoutMethod={id:'80000000-0000-4000-8000-000000000002',kind:'hosted_link',native_provider:'rampex',label:'Credit / debit card — Stripe via Rampex',sale_scope:'goods'};
function fixture(payResult){
 const logs=[],wConsole=new VirtualConsole(),dom=new JSDOM('<main id="root"></main>',{url:'https://altapurelabs.test/checkout',runScripts:'outside-only',virtualConsole:wConsole}),w=dom.window;
 w.TextEncoder=TextEncoder;Object.defineProperty(w.crypto,'subtle',{value:crypto.subtle});w.HTMLElement.prototype.scrollIntoView=()=>{};
 w.AltaStore={cart:[{id:'bpc',name:'BPC-157',size:'5mg',qty:1,price:51}],product:()=>({}),image:()=>'/image.png'};
 const data={config:require('../config/checkout.json'),delivery_options:require('../config/delivery-options.json'),capabilities:{card:false,apple_pay:false,google_pay:false},terms:{...require('../config/launch-commercial-terms.json'),conversion:require('../config/conversion.json')},methods:[checkoutMethod],membership:null,balances:{points:200,credit_cents:500},events:[]};
 w.fetch=async(url,options={})=>{
   const body=options.body?JSON.parse(options.body):null;logs.push({url:String(url),body});
   if(String(url).startsWith('/api/checkout?native=customer&invoice='))return{ok:true,json:async()=>payResult};
   if(body?.action==='quote')return{ok:true,json:async()=>quote};
   if(body?.action==='place')return{ok:true,json:async()=>({id:orderId,status:'accepted'})};
   return{ok:true,json:async()=>data};
 };
 for(const src of ['readiness-ui.js','conversion-ui.js','direct-checkout-client.js'])w.eval(fs.readFileSync(path.join(root,src),'utf8'));
 return{w,dom,logs,root:w.document.querySelector('#root')};
}
async function submitReview(f){
 await f.w.DirectCheckout.checkout(f.root,auth,user);
 const form=f.root.querySelector('form');
 form.querySelector('[data-step-next="0"]').click();
 form.querySelector('[data-step-next="1"]').click();
 form.elements.research_use.checked=true;form.elements.consent.checked=true;
 await form.onsubmit({preventDefault(){}});
 return f.root.querySelector('.dc-summary button');
}
test('Place order submits exactly one Rampex pay request directly from the final review',async()=>{
 const f=fixture({state:'redirected',redirect_url:'https://checkout.rampex.io/process-payment.php?provider=stripe&ref=test'});
 try{
  const button=await submitReview(f);
  assert.equal(button.textContent,'Place order & pay by card');
  assert.match(f.root.textContent,/One-time payment of the final total/);
  assert.equal(f.root.querySelector('a[href^="/pay.html"]'),null);
  await button.onclick();
  const actions=f.logs.filter(x=>x.body?.action).map(x=>x.body.action);
  assert.deepEqual(actions,['quote','place','pay']);
  const post=f.logs.find(x=>x.body?.action==='pay');
  assert.ok(post.url.includes('/api/checkout?native=customer&invoice='+orderId));
  assert.equal(post.body.invoice_id,orderId);
  assert.equal(post.body.confirm_amount_cents,7345);
  assert.equal(post.body.confirm_currency,'USD');
  assert.equal(post.body.consent,true);
  assert.equal(post.body.crypto_conversion_consent,true);
  assert.ok(/^[a-f0-9-]{36}$/.test(post.body.attempt_id));
  assert.equal(f.logs.filter(x=>x.body?.action==='place').length,1);
 }finally{f.dom.window.close();}
});
test('Unknown payment leaves the saved order visible without creating another payment',async()=>{
 const f=fixture({state:'unknown',redirect_url:null});
 try{
  const button=await submitReview(f);await button.onclick();
  assert.match(f.root.textContent,/Order 80000000-0000-4000-8000-000000000001 was saved/);
  assert.match(f.root.textContent,/No second payment link will be created/);
  assert.ok(f.root.querySelector('a[href^="/account/purchases?id="]'));
  assert.equal(f.logs.filter(x=>x.body?.action==='place').length,1);
  assert.equal(f.logs.filter(x=>x.body?.action==='pay').length,1);
 }finally{f.dom.window.close();}
});
test('Rampex checkout bypasses billing-card validation while other gateways retain it',()=>{
 const native=fs.readFileSync(path.join(root,'lib/native-gateway.js'),'utf8');
 const start=native.indexOf('async function startPayment'),rampex=native.indexOf("if(a.provider==='rampex')",start),billing=native.indexOf("else if(!a.countries.includes",start);
 assert.ok(start>=0&&rampex>start&&billing>rampex);
 const page=fs.readFileSync(path.join(root,'pay.html'),'utf8');
 assert.doesNotMatch(page,/Card details are entered into NMI|The card-to-crypto provider directs you|I understand this card-to-crypto payment flow/);
});
