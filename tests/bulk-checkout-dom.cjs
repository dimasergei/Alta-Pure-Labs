'use strict';
// Isolated browser fixture; no production account, order, or payment is used.
const {JSDOM,VirtualConsole}=require('jsdom'),{webcrypto}=require('node:crypto'),{TextEncoder}=require('node:util');
const fs=require('node:fs'),assert=require('node:assert/strict'),{price}=require('../lib/direct-checkout');
const config=require('../config/checkout.json'),delivery=require('../config/delivery-options.json');
const tick=()=>new Promise(resolve=>setTimeout(resolve,20));
(async()=>{
 const errors=[],console=new VirtualConsole();console.on('jsdomError',error=>{if(!/Not implemented: navigation/.test(error.message))errors.push(error.message);});
 const dom=new JSDOM('<main id="root"></main>',{url:'https://altapurelabs.test/checkout?bulk=1',runScripts:'outside-only',virtualConsole:console}),w=dom.window,root=w.document.querySelector('main');
 Object.defineProperty(w,'crypto',{value:webcrypto});w.TextEncoder=TextEncoder;w.HTMLElement.prototype.scrollIntoView=()=>{};
 const bulk=[{id:'bulk-compound',name:'Bulk compound',size:'10mg',qty:10,price:100}],regular=[{id:'regular-compound',name:'Regular compound',size:'5mg',qty:2,price:25}],regularSnapshot=JSON.stringify(regular);
 w.localStorage.setItem('pp-cart',regularSnapshot);w.localStorage.setItem('ap-bulk-draft-v2',JSON.stringify(bulk));
 w.AltaStore={cart:regular,read:(key,fallback)=>JSON.parse(w.localStorage.getItem(key)||JSON.stringify(fallback)),normalizeLines:value=>JSON.parse(JSON.stringify(value)),product:id=>({id}),image:()=>'/fixture-vial.svg'};
 const method={id:'11111111-1111-4111-8111-111111111111',kind:'bank_transfer',label:'Bank transfer',sale_scope:'goods'},calls=[];
 const data={config,methods:[method],balances:{points:0,credit_cents:0},capabilities:{card:false},delivery_options:delivery};
 w.fetch=async(url,options={})=>{
  const body=options.body?JSON.parse(options.body):null;calls.push({url,body});
  if(!body)return {ok:true,json:async()=>data};
  if(body.action==='place')return {ok:true,json:async()=>({id:'22222222-2222-4222-8222-222222222222',status:'accepted'})};
  const q=price({kind:'goods',request:{items:body.items.map(item=>({...item,name:'Bulk compound',unit_price_usd_cents:10000})),address:{country:body.country||body.address?.country||'US'},checkout:{coupon:body.coupon||'',points:body.points||0,credit_cents:body.credit_cents||0,delivery:body.delivery}}},method,null,data.balances,null,delivery);
  return {ok:true,json:async()=>({...q,quote:'verified-regular-goods-quote',free_shipping_remaining_cents:Math.max(0,15000-q.subtotal_cents+q.discount_cents)})};
 };
 const auth={auth:{getSession:async()=>({data:{session:{access_token:'isolated-test-session-token'}}})}},user={email:'fixture@example.test',user_metadata:{alta_profile:{shipping:{name:'Fixture Researcher',line1:'100 Test Street',city:'Test City',region:'FL',postal_code:'33101',country:'US'}}}};
 for(const file of ['readiness-ui.js','direct-checkout-client.js','checkout-reference.js'])w.eval(fs.readFileSync((process.env.PURE_TEST_SOURCE==='1'?'':'public-build/')+file,'utf8'));
 await w.DirectCheckout.checkout(root,auth,user);await tick();
 const preview=calls.find(call=>call.url.endsWith('checkout=cart'));assert.ok(preview);assert.equal(preview.body.bulk_order,undefined);assert.deepEqual(preview.body.items,[{id:'bulk-compound',size:'10mg',qty:10}]);assert.deepEqual(preview.body.delivery,{shipping:'standard',extras:[]});assert.match(root.querySelector('.dc-summary').textContent,/\$1,000.00/);assert.doesNotMatch(root.textContent,/50%|60%|Free 2-Day|membership|Regular compound/i);
 const form=root.querySelector('form');assert.ok(form.elements.coupon);assert.ok(form.elements.points);assert.ok(form.elements.credit);assert.equal(w.localStorage.getItem('pp-cart'),regularSnapshot);
 form.querySelector('[data-step-next="0"]').click();form.querySelector('[data-step-next="1"]').click();form.elements.coupon.value='BLACKFRIDAY15';form.querySelector('[data-dc-apply-coupon]').click();await tick();
 form.elements.research_use.checked=true;form.elements.consent.checked=true;await form.onsubmit({preventDefault(){}});
 const quoted=calls.find(call=>call.body?.action==='quote');assert.ok(quoted);assert.equal(quoted.body.kind,'goods');assert.equal(quoted.body.bulk_order,undefined);assert.equal(quoted.body.coupon,'BLACKFRIDAY15');assert.deepEqual(quoted.body.items,preview.body.items);assert.deepEqual(quoted.body.delivery,{shipping:'standard',extras:[]});assert.match(root.querySelector('.dc-review-summary').textContent,/\$850.00/);
 const place=root.querySelector('.dc-summary button');assert.ok(place);await place.onclick();const placed=calls.find(call=>call.body?.action==='place');assert.ok(placed);assert.equal(placed.body.quote,'verified-regular-goods-quote');assert.deepEqual(placed.body.items,quoted.body.items);assert.equal(placed.body.bulk_order,undefined);assert.equal(w.localStorage.getItem('pp-cart'),regularSnapshot);assert.equal(w.localStorage.getItem('ap-bulk-draft-v2'),null);assert.deepEqual(errors,[]);dom.window.close();
 process.stdout.write('PASS: bulk draft buys regular goods with explicit BLACKFRIDAY15, standard shipping and unchanged quantity, then clears only its own cart snapshot.\n');
})().catch(error=>{console.error(error);process.exitCode=1;});
