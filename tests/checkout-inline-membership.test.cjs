'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {JSDOM}=require('jsdom');
const config=require('../config/conversion.json');
function render(quote,callbacks={},selection={plan:'vip',period:'monthly'}){
 const dom=new JSDOM('<main><div id="offer"></div></main>',{url:'https://getpurelabs.com/checkout',runScripts:'outside-only'});
 const w=dom.window;w.eval(fs.readFileSync('membership-checkout.js','utf8'));
 const box=w.document.querySelector('#offer'),input={
   selection,onSelect:callbacks.onSelect||(()=>{}),onAdd:callbacks.onAdd||(()=>{}),onRemove:callbacks.onRemove||(()=>{})
 };
 w.PureMembershipCheckout.offer(box,quote,config,input);
 return{dom,w,box};
}
const quote={membership:null,membership_offer:{plans:{vip:{total_savings_cents:0},elite:{total_savings_cents:750}}},currency:'USD',pricing:{fx_ppm:1000000}};
test('membership is an add-to-order action, with no redirect and normal membership prices',()=>{
 const added=[],selected=[],env=render(quote,{onAdd:x=>added.push(x),onSelect:x=>selected.push(x)});
 try{
  const el=env.box.querySelector('[data-pm-add]');
  assert.ok(el);assert.match(el.textContent,/PURE WHITE/);assert.match(el.textContent,/\$19\.99/);
  assert.equal(env.box.querySelector('a[href^="/checkout?plan="]'),null,'no second checkout link');
  el.click();assert.deepEqual(added,[{plan:'vip',period:'monthly'}]);
  env.box.querySelector('[data-pm-tier=elite]').click();
  assert.deepEqual(selected,[{plan:'elite',period:'monthly'}]);
  env.box.querySelector('[data-pm-period=annual]').click();
  assert.deepEqual(selected.at(-1),{plan:'vip',period:'annual'});
 }finally{env.dom.window.close();}
});
test('annual membership uses annual prepaid price and does not add another payment',()=>{
 const added=[],env=render(quote,{onAdd:a=>added.push(a)},{plan:'elite',period:'annual'});
 try{
  assert.match(env.box.querySelector('[data-pm-add]').textContent,/PURE BLACK/);
  assert.match(env.box.querySelector('[data-pm-add]').textContent,/\$959\.90/);
  env.box.querySelector('[data-pm-add]').click();assert.deepEqual(added,[{plan:'elite',period:'annual'}]);
 }finally{env.dom.window.close();}
});
test('selected membership is shown once in order item list, not duplicated in upsell area',()=>{
 const env=render({...quote,pricing:{membership_addon:{plan:'vip',period:'monthly',fee_cents:1999}}});
 try{assert.equal(env.box.hidden,true);assert.equal(env.box.textContent,'');}finally{env.dom.window.close();}
});
test('Canadian checkout shows CA$ for membership fees without US$ prefixes',()=>{
 const env=render({...quote,currency:'CAD',pricing:{fx_ppm:1400000}}, {}, {plan:'vip',period:'monthly'});
 try{assert.match(env.box.querySelector('[data-pm-add]').textContent,/CA\$27\.99/);assert.doesNotMatch(env.box.textContent,/US\$/);}finally{env.dom.window.close();}
});
test('active paid member sees no membership add-on prompt',()=>{
 const env=render({...quote,membership:{plan:'vip',name:'PURE WHITE'}});
 try{assert.equal(env.box.hidden,true);assert.equal(env.box.querySelector('[data-pm-add]'),null);}finally{env.dom.window.close();}
});
