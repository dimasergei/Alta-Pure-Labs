'use strict';
// Isolated browser fixtures: no production account, order, or payment is used.
const {JSDOM,VirtualConsole}=require('jsdom');
const {webcrypto}=require('node:crypto');
const {TextEncoder}=require('node:util');
const fs=require('node:fs'),assert=require('node:assert/strict');
const read=file=>fs.readFileSync(file,'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
async function until(predicate,label){for(let i=0;i<50;i++){if(predicate())return;await tick();}throw Error('Timed out: '+label);}
function environment(html,path){
 const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>{if(!/Not implemented: navigation/.test(e.message))errors.push(e.message);});
 const dom=new JSDOM(html,{url:'https://altapurelabs.test'+path,runScripts:'outside-only',virtualConsole:vc});
 const w=dom.window;Object.defineProperty(w,'crypto',{value:webcrypto});w.TextEncoder=TextEncoder;
 w.matchMedia=()=>({matches:false});w.HTMLElement.prototype.scrollIntoView=()=>{};
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 return{dom,w,d:w.document,errors};
}
async function checkoutFlow(){
 const {dom,w,d,errors}=environment('<main id="root"></main>','/checkout?bulk=1');
 const bulk=[{id:'bulk-compound',name:'Bulk compound',size:'10mg',qty:10,price:100}],regular=[{id:'regular-compound',name:'Regular compound',size:'5mg',qty:2,price:25}];
 const originalRegular=JSON.stringify(regular);w.localStorage.setItem('pp-cart',originalRegular);w.localStorage.setItem('ap-bulk-draft-v2',JSON.stringify(bulk));
 w.AltaStore={cart:regular,read:(key,fallback)=>JSON.parse(w.localStorage.getItem(key)||JSON.stringify(fallback)),normalizeLines:plain,product:id=>({id}),image:()=>'/fixture-vial.png'};
 const calls=[],method='11111111-1111-4111-8111-111111111111';
 const config={config:{version:'checkout-2026-11-v4',shipping_countries:['US']},methods:[{id:method,kind:'bank_transfer',label:'Bank transfer',sale_scope:'goods'}],terms:{memberships:{},conversion:{plans:{}}},balances:{points:0,credit_cents:0},capabilities:{card:false},delivery_options:[]};
 const priced={subtotal_cents:100000,discount_cents:50000,shipping_cents:0,tax_cents:0,total_cents:50000,points_redeemed:0,credit_redeemed_cents:0,earned_points:1250,currency:'USD',quote:'verified-bulk-quote',pricing:{bulk_order:true,shipping_note:'Free 2-day express delivery.',lines:[{id:bulk[0].id,size:'10mg',qty:10,line_total_cents:50000}]}};
 w.fetch=async(url,init={})=>{
  const body=init.body?JSON.parse(init.body):undefined;calls.push({url,body});
  const data=!body?config:body.action==='place'?{id:'22222222-2222-4222-8222-222222222222',status:'accepted'}:priced;
  return{ok:true,json:async()=>plain(data)};
 };
 const auth={auth:{getSession:async()=>({data:{session:{access_token:'isolated-test-session-token'}}})}};
 const user={email:'fixture@example.test',user_metadata:{alta_profile:{shipping:{name:'Fixture Researcher',line1:'100 Test Street',city:'Test City',region:'FL',postal_code:'33101',country:'US'}}}};
 // The production order matters: checkout-reference wraps DirectCheckout.checkout.
 w.eval(read('public-build/readiness-ui.js'));
 w.eval(read('public-build/direct-checkout-client.js'));
 w.eval(read('public-build/checkout-reference.js'));
 await w.DirectCheckout.checkout(d.querySelector('#root'),auth,user);
 const preview=calls.find(c=>c.url.endsWith('checkout=cart'));
 assert.ok(preview,'Bulk checkout must request an authoritative preview');
 assert.equal(preview.body.bulk_order,true);assert.deepEqual(preview.body.items,[{id:'bulk-compound',size:'10mg',qty:10}]);
 assert.deepEqual(preview.body.delivery,{shipping:'express',extras:[]});
 assert.match(d.querySelector('.dc-summary').textContent,/Your bulk order/);
 assert.match(d.querySelector('.dc-summary').textContent,/\$500\.00/);
 assert.doesNotMatch(d.querySelector('.dc-summary').textContent,/Regular compound|US\$25\.00/);
 assert.equal(d.querySelector('[name=coupon]'),null);
 assert.equal(d.querySelector('[name=points]'),null);
 assert.equal(d.querySelector('[name=credit]'),null);
 assert.equal(w.localStorage.getItem('pp-cart'),originalRegular);
 const form=d.querySelector('form');form.elements.research_use.checked=true;form.elements.consent.checked=true;
 d.querySelector('[data-step-next="0"]').click();d.querySelector('[data-step-next="1"]').click();
 await form.onsubmit({preventDefault(){}});
 const quoted=calls.find(c=>c.body?.action==='quote');assert.ok(quoted,'Review must request a server quote');
 assert.equal(quoted.body.bulk_order,true);assert.deepEqual(quoted.body.items,[{id:'bulk-compound',size:'10mg',qty:10}]);
 assert.deepEqual(quoted.body.delivery,{shipping:'express',extras:[]});
 assert.equal(quoted.body.coupon,'');assert.equal(quoted.body.points,0);assert.equal(quoted.body.credit_cents,0);
 const place=[...d.querySelectorAll('button')].find(b=>b.textContent==='Place order and continue to payment');assert.ok(place);
 place.click();await until(()=>calls.some(c=>c.body?.action==='place'),'mock order placement');await tick();
 const placed=calls.find(c=>c.body?.action==='place');assert.equal(placed.body.quote,'verified-bulk-quote');assert.equal(placed.body.bulk_order,true);
 assert.deepEqual(placed.body.items,quoted.body.items);assert.deepEqual(placed.body.delivery,quoted.body.delivery);
 assert.equal(w.localStorage.getItem('pp-cart'),originalRegular,'A bulk order must preserve the regular cart');
 assert.equal(w.localStorage.getItem('ap-bulk-draft-v2'),null,'Only the placed bulk snapshot is cleared');
 assert.deepEqual(errors,[]);dom.window.close();
}
async function bulkCards(){
 const {dom,w,d,errors}=environment(read('public-build/index.html'),'/bulk-orders');
 w.localStorage.setItem('ap-age-verified','true');w.fetch=async()=>({ok:true,json:async()=>[]});w.AltaConversionConfig=require('../config/conversion.json');
 w.eval(read('conversion-ui.js')+'\n'+read('products.js')+'\n'+read('product-images.js')+'\n'+read('public-build/storefront-v2.js')+'\n'+read('public-build/workspace-v2.js'));
 await tick();const style=d.createElement('style');style.textContent=read('public-build/reference-ui.css');d.head.append(style);
 const card=d.querySelector('[data-bulk-product]');assert.ok(card);
 assert.equal(card.dataset.selected,'false');assert.equal(card.querySelector('[data-bulk-progress]').textContent,'');
 assert.match(card.querySelector('.nl-bulk-add-label').textContent,/Add 10 units/);
 assert.equal(w.getComputedStyle(card.querySelector('img')).objectFit,'contain');
 assert.equal(w.getComputedStyle(card.querySelector('h3')).textAlign,'center');
 assert.equal(w.getComputedStyle(card.querySelector('.ap-eyebrow')).textAlign,'center');
 const plusTen=card.querySelector('[data-delta="10"]');plusTen.click();await tick();
 assert.equal(card.dataset.selected,'true');assert.equal(card.querySelector('[data-bulk-id]').value,'10');
 assert.match(card.querySelector('[data-bulk-progress]').textContent,/50% off applied.*40 more/);
 const button=d.querySelector('[data-action="bulk-checkout"]');assert.ok(button);assert.match(button.textContent,/^Checkout · \$/);assert.equal(button.disabled,false);
 assert.equal(d.querySelector('[data-action="bulk-inquiry"]'),null);
 assert.equal(w.AltaStore.cart.length,0,'Adding bulk quantities cannot fill the regular cart');
 const price=d.querySelector('.nl-bulk-totals>div:first-child del');assert.ok(price,'Retail total must be struck through');
 assert.equal(w.getComputedStyle(d.querySelector('.nl-bulk-totals>div:nth-child(2)')).fontWeight,'700');
 assert.doesNotMatch(card.textContent,/Quantity for|Select quantities to build your order/);
 assert.deepEqual(errors,[]);dom.window.close();
}
async function membershipStillWorks(period){
 const {dom,w,d,errors}=environment('<main id="root"></main>','/checkout?plan=vip&period='+period),conversion=require('../config/conversion.json');
 const amount=conversion.plans.vip[period+'_cents'],calls=[];
 const data={config:{version:'checkout-2026-11-v4'},terms:{conversion,memberships:{}},methods:[{id:'11111111-1111-4111-8111-111111111111',kind:'bank_transfer',label:'Bank transfer',sale_scope:'both'}],balances:{points:0,credit_cents:0},capabilities:{card:false}};
 w.AltaStore={cart:[]};w.fetch=async(url,init={})=>{const body=init.body?JSON.parse(init.body):undefined;calls.push(body);return{ok:true,json:async()=>body?{subtotal_cents:amount,discount_cents:0,shipping_cents:0,tax_cents:0,total_cents:amount,points_redeemed:0,credit_redeemed_cents:0,earned_points:0,pricing:{},quote:'membership-quote'}:data};};
 w.eval(read('public-build/readiness-ui.js'));w.eval(read('public-build/direct-checkout-client.js'));w.eval(read('public-build/checkout-reference.js'));
 await w.DirectCheckout.checkout(d.querySelector('#root'),{auth:{getSession:async()=>({data:{session:{access_token:'isolated-test-session-token'}}})}},{user_metadata:{full_name:'Fixture Researcher'}});
 const form=d.querySelector('form');assert.ok(form,period+' membership still renders');
 assert.match(d.querySelector('.dc-summary').textContent,new RegExp((amount/100).toFixed(2).replace('.','\\.')));
 form.elements.consent.checked=true;d.querySelector('[data-step-next="0"]').click();d.querySelector('[data-step-next="1"]').click();await form.onsubmit({preventDefault(){}});
 const quote=calls.find(x=>x?.action==='quote');assert.ok(quote,period+' membership obtains a quote');assert.equal(quote.kind,'membership');assert.equal(quote.billing_period,period);assert.equal(quote.bulk_order,undefined);assert.equal(quote.items,undefined);
 assert.deepEqual(errors,[]);dom.window.close();
}
(async()=>{await checkoutFlow();await bulkCards();await membershipStillWorks('monthly');await membershipStillWorks('annual');console.log('PASS: isolated bulk checkout preview, quote/place handoff, cart separation, product controls, card styling and monthly/annual membership checkout.');})().catch(e=>{console.error(e);process.exitCode=1;});
