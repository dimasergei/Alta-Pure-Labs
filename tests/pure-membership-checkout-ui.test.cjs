'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom');
const config=require('../config/conversion.json');
const methods=[{id:'fixture-card',label:'Card',currency:'USD',sale_scope:'both',countries:['US','CA']},{id:'fixture-interac',label:'Interac e-Transfer',currency:'CAD',sale_scope:'both',countries:['CA']}];
const user={email:'member@example.test',user_metadata:{full_name:'Fixture Research',alta_profile:{organization:'Fixture Lab',shipping:{name:'Fixture Research',line1:'100 Research Avenue',line2:'',city:'Toronto',region:'ON',postal_code:'M5V 1A1',country:'US'}}}};
const clone=value=>JSON.parse(JSON.stringify(value));
function price(body,{total,rate=1390000,version=1}={}){
 const currency=body.method_id==='fixture-interac'?'CAD':'USD',usd=config.plans[body.plan][body.billing_period+'_cents'];
 return {currency,total_cents:total??(currency==='CAD'?Math.round(usd*rate/1000000):usd),quote:'fixture-quote-'+version,pricing:{fx_ppm:currency==='CAD'?rate:1000000},...(currency==='CAD'?{fx_quote:{fixture_version:version}}:{})};
}
async function setup({query='?plan=vip&period=monthly',respond,membership=null,pending=null,available=methods,paid=false}={}){
 const dom=new JSDOM('<main id="root"></main>',{url:'https://pure.example/checkout'+query,runScripts:'outside-only'}),w=dom.window,root=w.document.getElementById('root'),calls=[],navigated=[],payments=[];
 const cart=[{id:'kept-compound',size:'5 mg',qty:2}];w.localStorage.setItem('pp-cart',JSON.stringify(cart));
 w.DirectCheckout={api:async(auth,body)=>{calls.push(body?clone(body):null);if(!body)return {config:{version:'fixture-checkout',shipping_countries:['US','CA','GB']},terms:{conversion:config},membership,membership_pending:pending,methods:available};if(respond){const result=await respond(body,calls);if(result)return result;}if(body.action==='quote')return price(body);if(body.action==='place')return {id:body.id,currency:body.method_id==='fixture-interac'?'CAD':'USD',total_cents:price(body).total_cents,manual_transfer:body.method_id==='fixture-interac'};throw Error('Unexpected action');},paymentKind:method=>method.id==='fixture-interac'?'interac':'card',openHostedPayment:async(...args)=>{payments.push(args);return paid?{paid:true}:{url:'https://payment.example.test/fixture',paid:false};}};
 w.eval(fs.readFileSync('membership-experience.js','utf8'));w.eval(fs.readFileSync('membership-checkout.js','utf8'));
 await w.PureMembershipCheckout.checkout(root,{},clone(user),{navigate:href=>navigated.push(href)});
 const form=root.querySelector('form');if(form)form.elements.consent.checked=true;
 return {dom,w,root,form,calls,navigated,payments,cart,submit:()=>form.onsubmit({preventDefault(){}})};
}
test('membership fee review quotes exact monthly and annual prices without placing an order',async()=>{
 for(const [plan,period,cents] of [['vip','monthly',1999],['vip','annual',19190],['elite','monthly',9999],['elite','annual',95990]]){
  const env=await setup({query:`?plan=${plan}&period=${period}`});await env.submit();
  const body=env.calls.find(Boolean);assert.equal(body.kind,'membership');assert.equal(body.plan,plan);assert.equal(body.billing_period,period);assert.equal(body.points,0);assert.equal(body.credit_cents,0);assert.equal(body.coupon,'');assert.equal(body.consent,true);
  assert.match(env.root.querySelector('.pm-final').textContent,new RegExp((cents/100).toFixed(2).replace('.','\\.')));
  assert.equal(env.calls.filter(call=>call?.action==='place').length,0);assert.equal(env.payments.length,0);assert.equal(env.navigated.length,0);
  assert.equal(env.root.querySelector('[data-pm-place]').classList.contains('ap-button-light'),plan==='elite');
  env.dom.window.close();
 }
});
test('slow membership quotes freeze controls and reject a changed snapshot before showing a purchase button',async()=>{
 let resolveQuote;const pending=new Promise(resolve=>{resolveQuote=resolve;});
 const env=await setup({respond:body=>body.action==='quote'?pending:null});
 const submit=env.submit();
 assert.ok([...env.form.elements].every(element=>element.disabled));
 assert.equal(env.root.querySelector('[data-pm-place]'),null);
 const annual=env.form.querySelector('[name="period"][value="annual"]');annual.checked=true;annual.dispatchEvent(new env.w.Event('change',{bubbles:true}));
 resolveQuote(price(env.calls.find(Boolean)));await submit;
 assert.equal(env.root.querySelector('[data-pm-place]'),null);
 assert.match(env.root.querySelector('[data-pm-status]').textContent,/details changed/);
 assert.equal(env.form.querySelector('[type="submit"]').disabled,false);
 assert.match(env.root.querySelector('[data-pm-term-price]').textContent,/191\.90/);
 assert.equal(env.calls.filter(call=>call?.action==='place').length,0);
 env.dom.window.close();
});
test('a failed requote clears an earlier quote and cannot reuse its purchase action',async()=>{
 let number=0;
 const env=await setup({respond:body=>{if(body.action==='quote'&&++number===2)throw Error('Quote unavailable.');}});
 await env.submit();assert.ok(env.root.querySelector('[data-pm-place]'));
 await env.submit();assert.equal(env.root.querySelector('[data-pm-place]'),null);
 assert.match(env.root.querySelector('[data-pm-status]').textContent,/Quote unavailable/);
 assert.equal(env.calls.filter(call=>call?.action==='place').length,0);
 env.dom.window.close();
});
test('a changed CAD exchange quote requires a second purchase click and uses the refreshed CAD total',async()=>{
 let quoteCount=0;
 const env=await setup({respond:body=>{if(body.action==='quote'){quoteCount++;return price(body,{total:quoteCount===1?2779:2800,rate:quoteCount===1?1390000:1400700,version:quoteCount});}if(body.action==='place')return {id:body.id,currency:'CAD',total_cents:2800,manual_transfer:true};}});
 env.form.elements.country.value='CA';env.form.elements.country.dispatchEvent(new env.w.Event('change',{bubbles:true}));
 const interac=env.form.querySelector('[value="fixture-interac"]');interac.checked=true;interac.dispatchEvent(new env.w.Event('change',{bubbles:true}));
 await env.submit();assert.match(env.root.querySelector('.pm-final').textContent,/CA\$27\.79/);
 await env.root.querySelector('[data-pm-place]').onclick();
 assert.equal(env.calls.filter(call=>call?.action==='place').length,0);
 assert.match(env.root.querySelector('[data-pm-status]').textContent,/CAD total changed/);
 assert.match(env.root.querySelector('.pm-final').textContent,/CA\$28\.00/);
 assert.equal(env.root.querySelector('[data-pm-place]').disabled,false);
 await env.root.querySelector('[data-pm-place]').onclick();
 const order=env.calls.find(call=>call?.action==='place');assert.ok(order);assert.equal(order.fx_quote.fixture_version,3);assert.equal(order.quote,'fixture-quote-3');
 assert.equal(env.payments.length,0);assert.equal(env.navigated.length,1);assert.match(env.navigated[0],/^\/account\/purchases\?id=/);
 assert.deepEqual(JSON.parse(env.w.localStorage.getItem('pp-cart')),env.cart);
 env.dom.window.close();
});
test('double purchase clicks create one payment request, preserve the cart and route a paid result to account history',async()=>{
 let resolvePlace;const pending=new Promise(resolve=>{resolvePlace=resolve;});
 const env=await setup({paid:true,respond:body=>body.action==='place'?pending:null});
 await env.submit();const button=env.root.querySelector('[data-pm-place]'),first=button.onclick(),second=button.onclick();
 assert.equal(env.calls.filter(call=>call?.action==='place').length,1);
 assert.ok([...env.form.elements].every(element=>element.disabled));
 const order=env.calls.find(call=>call?.action==='place');resolvePlace({id:order.id,currency:'USD',total_cents:1999});await Promise.all([first,second]);
 assert.equal(env.payments.length,1);assert.equal(env.navigated.length,1);assert.match(env.navigated[0],/^\/account\/purchases\?id=/);
 assert.deepEqual(JSON.parse(env.w.localStorage.getItem('pp-cart')),env.cart);
 assert.equal(env.w.sessionStorage.getItem('pure-membership-purchase'),null);
 env.dom.window.close();
});
test('unreported form mutations invalidate a displayed quote before any order is placed',async()=>{
 const env=await setup();await env.submit();
 env.form.elements.postal_code.value='Changed postal';
 await env.root.querySelector('[data-pm-place]').onclick();
 assert.equal(env.calls.filter(call=>call?.action==='place').length,0);
 assert.equal(env.root.querySelector('[data-pm-place]'),null);
 assert.match(env.root.querySelector('[data-pm-status]').textContent,/details changed/);
 env.dom.window.close();
});
test('a country with no payment route cannot submit a membership quote',async()=>{
 const env=await setup();env.form.elements.country.value='GB';env.form.elements.country.dispatchEvent(new env.w.Event('change',{bubbles:true}));
 assert.ok(env.form.querySelector('[type="submit"]').disabled);
 await env.submit();assert.equal(env.calls.filter(Boolean).length,0);
 assert.match(env.root.querySelector('[data-pm-method-note]').textContent,/No supported payment method/);
 env.dom.window.close();
});
test('an already active tier never renders or submits another fee checkout',async()=>{
 const env=await setup({membership:{plan:'elite',name:'PURE BLACK',expires_at:'2099-12-31T00:00:00Z'}});
 assert.equal(env.form,null);assert.match(env.root.textContent,/already active/);
 assert.equal(env.calls.filter(Boolean).length,0);assert.equal(env.payments.length,0);
 env.dom.window.close();
});
test('a pending membership payment reopens its saved order and cannot create another fee checkout',async()=>{
 const id='11111111-1111-4111-8111-111111111111';
 const env=await setup({pending:{invoice_id:id,plan:'elite',name:'PURE BLACK',billing_period:'annual',status:'awaiting_payment',currency:'CAD',total_cents:133426,expires_at:'2099-12-31T00:00:00Z'}});
 assert.equal(env.form,null);assert.match(env.root.textContent,/Awaiting payment/);assert.match(env.root.textContent,/CA\$1,334\.26/);assert.match(env.root.textContent,/One-year membership term/);
 assert.ok(env.root.querySelector('a[href="/account/purchases?id='+id+'"]'));
 assert.equal(env.calls.filter(Boolean).length,0);assert.equal(env.payments.length,0);
 assert.deepEqual(JSON.parse(env.w.localStorage.getItem('pp-cart')),env.cart);
 env.dom.window.close();
});
test('expired and legacy pending membership purchases require review instead of another checkout or blind payment',async()=>{
 for(const flags of [{expired:true},{requires_review:true}]){
  const id='11111111-1111-4111-8111-111111111111',env=await setup({pending:{invoice_id:id,plan:'vip',name:'PURE WHITE',billing_period:'monthly',status:'issued',currency:'USD',total_cents:1999,...flags}});
  assert.equal(env.form,null);assert.match(env.root.textContent,/Unpaid membership needs attention/);assert.match(env.root.textContent,/cancel the unpaid order/);assert.match(env.root.textContent,/If you sent payment, contact PURE/);
  assert.equal(env.root.querySelector('a[href="/account/purchases?id='+id+'"]')?.textContent,'Review membership order');
  assert.doesNotMatch(env.root.textContent,/Continue payment/);assert.equal(env.calls.filter(Boolean).length,0);
  env.dom.window.close();
 }
});
