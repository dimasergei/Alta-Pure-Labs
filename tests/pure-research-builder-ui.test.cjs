'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {JSDOM} = require('jsdom');
const builderSource = fs.readFileSync('research-builder-client.js','utf8');
const checkoutSource = fs.readFileSync('research-checkout-client.js','utf8');
const localeSource = fs.readFileSync('locale.js','utf8');
const displayLocaleResponse = require('./display-locale-fixture.cjs');
const pricing = require('../lib/research-builder-pricing');
const catalog = Array.from({length:5},(_,index) => ({id:'compound-'+index,name:'Compound '+index,category:'injectables',group:index%2 ? 'Category B' : 'Category A',variants:[{size:'5 mg',price:100.03 + index},{size:'10 mg',price:180.02 + index}]})).concat({id:'bac-3',name:'BAC Water',category:'supplies',group:'Supplies',variants:[{size:'3 mL',price:14.95}]});
const items = catalog.slice(0,4).map(product => ({id:product.id,size:product.variants[0].size,qty:1}));
const settle = () => new Promise(resolve => setTimeout(resolve,0));
function quote(body) {
  return pricing.quote(body.items,catalog,{mode:body.mode});
}
function setup({draft,respond,withLocale=false} = {}) {
  const dom = new JSDOM('<main id="root"></main>',{url:'https://pure.example/fixture',runScripts:'outside-only'}),w = dom.window,calls = [],added = [],navigated = [];
  if (draft) w.localStorage.setItem('ap-research-builder-v2',JSON.stringify(draft));
  w.fetch = async (url,options) => {
    const display=displayLocaleResponse(url);if(display)return display;
    const body = options?.body ? JSON.parse(options.body) : null;calls.push({url,body,options:{...options,headers:{...options?.headers}}});
    if (respond) {const result = await respond(body,calls);if (result) return result;}
    return {ok:true,json:async () => body ? quote(body) : {catalog,subscription_available:false,one_time_available:true}};
  };
  w.AltaStore = {catalog,product:id=>catalog.find(item=>item.id===id),image:()=>'/assets/fixture.webp',addItems:lines=>added.push(JSON.parse(JSON.stringify(lines)))};
  if (withLocale) w.eval(localeSource);
  w.eval(builderSource);w.eval(checkoutSource);
  return {dom,w,root:w.document.getElementById('root'),calls,added,navigated,options:{navigate:href=>navigated.push(href)}};
}
test('builder permits four distinct compounds, excludes supplies, and requires a server quote before one-time checkout',async () => {
  const env = setup(),{w,root,calls,added,navigated} = env;
  await w.PureResearchBuilder.mount(root,env.options);
  assert.equal(w.document.title,'AUTO-STACK™ | PURE');
  assert.equal(root.querySelector('.nl-builder-hero h1').textContent,'AUTO-STACK™');
  assert.equal(root.querySelector('.nl-builder-hero h1 sup').textContent,'™');
  assert.match(root.querySelector('.nl-builder-hero p').textContent,/Your four-compound research set/);
  assert.ok(root.querySelector('[aria-label="AUTO-STACK™ purchase type"]'));
  assert.equal(root.querySelector('.nl-builder-summary-heading h2').textContent,'Your AUTO-STACK™');
  assert.doesNotMatch(root.textContent,/Research Builder/);
  assert.equal(root.querySelectorAll('[data-rb-product]').length,5);
  assert.equal(root.querySelector('[data-rb-product="bac-3"]'),null);
  assert.ok(root.querySelector('[data-rb-checkout]').disabled);
  for (const item of items) root.querySelector(`[data-rb-add="${item.id}"]`).click();
  assert.ok(root.querySelector('[data-rb-checkout]').disabled,'Quote remains a gate while request is pending');
  await settle();
  assert.deepEqual(calls.find(call=>call.body).body,{action:'quote',items,mode:'one_time'});
  assert.ok(root.querySelector('[data-rb-add="compound-4"]').disabled);
  assert.equal(root.querySelectorAll('.nl-builder-slot.is-selected').length,4);
  assert.match(root.querySelector('.nl-price-total').textContent,/\$406\.12/);
  root.querySelector('[data-rb-checkout]').click();
  assert.deepEqual(added,[items]);assert.deepEqual(navigated,['/checkout']);
  assert.equal(calls.filter(call=>call.body&&call.body.action!=='quote').length,0);
  assert.match(root.textContent,/existing cart/);
  env.dom.window.close();
});
test('monthly set displays 40% discount and creates an explicit invoice checkout instead of changing the regular cart',async () => {
  const env = setup({draft:{mode:'subscription',lines:items}}),{w,root,added,calls,navigated} = env;
  await w.PureResearchBuilder.mount(root,env.options);
  assert.equal(root.querySelector('[data-rb-mode="subscription"] span').textContent,'40% off');
  assert.match(root.querySelector('.nl-builder-benefits').textContent,/Cancel anytime/);
  assert.match(root.querySelector('.nl-builder-benefits').textContent,/No delivery minimum/);
  assert.match(root.querySelector('.nl-builder-terms').textContent,/Pay per month with Card or Crypto/);
  assert.match(root.querySelector('.nl-builder-terms').textContent,/Edit future selections or cancel your plan anytime/);
  assert.doesNotMatch(root.textContent,/Three deliveries|three deliveries|third delivery|after the first shipment|follow the first shipment/);
  assert.match(root.querySelector('.nl-builder-availability').textContent,/One payment covers this month/);
  assert.equal(root.querySelector('[data-rb-checkout]'),null);
  assert.match(root.querySelector('.nl-price-total').textContent,/\$243\.68/);
  root.querySelector('[data-rb-review]').click();
  assert.deepEqual(navigated,['/research-checkout']);assert.deepEqual(added,[]);
  assert.ok(calls.filter(call=>call.body).every(call=>call.body.action==='quote'));
  root.querySelector('[data-rb-one-time]').click();await settle();
  assert.match(root.querySelector('.nl-price-total').textContent,/\$406\.12/);
  assert.match(root.querySelector('.nl-builder-terms').textContent,/40% offer.*do not apply/);
  root.querySelector('[data-rb-checkout]').click();assert.deepEqual(added,[items]);
  env.dom.window.close();
});
test('invalid stored selections cannot become a checkout, and strength changes update the quoted draft',async () => {
  const env = setup({draft:{lines:[items[0],items[0],{id:'bac-3',size:'3 mL',qty:1},items[1]]}}),{w,root} = env;
  await w.PureResearchBuilder.mount(root,env.options);
  assert.equal(root.querySelectorAll('.nl-builder-slot.is-selected').length,2);
  root.querySelector('[data-rb-id="compound-0"][data-rb-size="10 mg"]').click();
  root.querySelector('[data-rb-add="compound-2"]').click();root.querySelector('[data-rb-add="compound-3"]').click();await settle();
  const stored = JSON.parse(w.localStorage.getItem('ap-research-builder-v2'));
  assert.equal(stored.lines[0].size,'10 mg');assert.equal(stored.lines.length,4);
  assert.equal(env.calls.filter(call=>call.body).at(-1).body.items[0].size,'10 mg');
  root.querySelector('#ap-builder-query').value = 'Compound 4';root.querySelector('#ap-builder-query').dispatchEvent(new w.Event('input'));
  assert.equal(root.querySelectorAll('[data-rb-product]').length,1);
  assert.equal(root.querySelectorAll('.nl-builder-slot.is-selected').length,4);
  env.dom.window.close();
});
test('a failed or unavailable quote cannot expose a live checkout button',async () => {
  const env = setup({draft:{lines:items},respond:async body=>body?{ok:false,json:async()=>({error:'One selected size is unavailable.'})}:null});
  await env.w.PureResearchBuilder.mount(env.root,env.options);
  assert.ok(env.root.querySelector('[data-rb-checkout]').disabled);
  assert.match(env.root.querySelector('[role="alert"]').textContent,/unavailable/);
  assert.equal(env.added.length,0);
  env.dom.window.close();
});
test('a late quote for an earlier selection cannot overwrite current pricing',async () => {
  let resolveFirst;
  const firstResponse = new Promise(resolve=>{resolveFirst=resolve;});
  let count = 0;
  const env = setup({respond:async body=>body&&++count===1?firstResponse:null});
  await env.w.PureResearchBuilder.mount(env.root,env.options);
  for (const item of items) env.root.querySelector(`[data-rb-add="${item.id}"]`).click();
  env.root.querySelector('[data-rb-id="compound-0"][data-rb-size="10 mg"]').click();await settle();
  assert.match(env.root.querySelector('.nl-price-total').textContent,/\$486\.11/);
  resolveFirst({ok:true,json:async()=>quote({items,mode:'one_time'})});await settle();
  assert.match(env.root.querySelector('.nl-price-total').textContent,/\$486\.11/);
  env.dom.window.close();
});
test('monthly review links to secure invoice checkout without charging the customer in the review',async () => {
  const env = setup({draft:{mode:'subscription',lines:items}});
  await env.w.ResearchCheckout.render(env.root,{email:'fixture@example.test'},env.options);
  assert.equal(env.w.document.title,'AUTO-STACK™ Review | PURE');
  assert.equal(env.root.querySelector('.rc-heading h1').textContent,'REVIEW YOUR AUTO-STACK™');
  assert.equal(env.root.querySelector('.rc-heading h1 sup').textContent,'™');
  assert.equal(env.root.querySelector('.rc-pay').getAttribute('href'),'/checkout?stack=monthly');
  assert.equal(env.root.querySelector('form'),null);
  assert.equal(env.root.querySelector('[data-rc-checkout]'),null);
  assert.match(env.root.querySelector('.rc-terms').textContent,/Monthly invoice terms/);
  assert.match(env.root.querySelector('.rc-terms').textContent,/Monthly until canceled/);
  assert.match(env.root.querySelector('.rc-terms').textContent,/no minimum deliveries/);
  assert.match(env.root.querySelector('.rc-terms').textContent,/Edit future selections anytime/);
  assert.match(env.root.querySelector('.rc-terms').textContent,/Cancel anytime/);
  assert.doesNotMatch(env.root.querySelector('.rc-terms').textContent,/Three deliveries|third delivery|after the first delivery/);
  assert.equal(env.root.querySelector('.rc-unavailable'),null);
  assert.ok(env.root.querySelector('a[href="/research-builder?mode=one_time"]'));
  assert.equal(env.added.length,0);assert.equal(env.calls.length,1);
  env.dom.window.close();
});
test('one-time review uses the normal cart once and preserves the USD quote',async () => {
  const env = setup({draft:{mode:'one_time',lines:items}});
  await env.w.ResearchCheckout.render(env.root,{email:'fixture@example.test'},env.options);
  assert.match(env.root.querySelector('.rc-due').textContent,/\$406\.12/);
  assert.match(env.root.querySelector('.rc-due').textContent,/USD/);
  env.root.querySelector('[data-rc-checkout]').click();env.root.querySelector('[data-rc-checkout]').click();
  assert.deepEqual(env.added,[items]);assert.deepEqual(env.navigated,['/checkout']);
  env.dom.window.close();
});
test('a valid optional session quotes actual member pricing without making public selection require sign-in',async()=>{
  const env = setup({draft:{mode:'one_time',lines:items},respond:async body=>body?{ok:true,json:async()=>pricing.quote(body.items,catalog,{mode:body.mode,membership:{plan:'vip'}})}:null});
  env.w.AltaWorkspace = {authClient:async()=>({auth:{getSession:async()=>({data:{session:{access_token:'fixture_member_session_token_1234'}}})}})};
  await env.w.PureResearchBuilder.mount(env.root,env.options);
  assert.equal(env.calls.find(call=>call.body).options.headers.Authorization,'Bearer fixture_member_session_token_1234');
  assert.match(env.root.querySelector('.nl-price-list').textContent,/PURE WHITE savings/);
  assert.match(env.root.querySelector('.nl-price-total').textContent,/member savings applied/);
  assert.match(env.root.querySelector('.nl-price-total').textContent,/\$385\.81/);
  env.dom.window.close();
});
test('an expired optional session falls back to public pricing without claiming a member discount',async()=>{
  let authorizedAttempts = 0;
  const env = setup({draft:{lines:items},respond:async(body,calls)=>body&&calls.at(-1).options.headers.Authorization?(authorizedAttempts++,{ok:false,status:401,json:async()=>({error:'Expired session'})}):null});
  env.w.AltaWorkspace = {authClient:async()=>({auth:{getSession:async()=>({data:{session:{access_token:'fixture_expired_session_token_1234'}}})}})};
  await env.w.PureResearchBuilder.mount(env.root,env.options);
  assert.equal(authorizedAttempts,1);
  assert.equal(env.calls.filter(call=>call.body).length,2);
  assert.match(env.root.querySelector('.nl-price-total').textContent,/\$406\.12/);
  assert.doesNotMatch(env.root.querySelector('.nl-price-total').textContent,/member savings applied/);
  assert.equal(env.root.querySelector('[data-rb-checkout]').disabled,false);
  env.dom.window.close();
});

test('currency updates keep builder selections, focus, filters and canonical quote cents intact',async()=>{
  const env=setup({draft:{mode:'one_time',lines:items},withLocale:true}),{w,root,calls}=env;
  try{
    await w.PureResearchBuilder.mount(root,env.options);
    root.querySelector('[data-rb-id="compound-0"][data-rb-size="10 mg"]').click();await settle();
    root.querySelector('[data-rb-group="Category A"]').click();
    const search=root.querySelector('#ap-builder-query');search.value='Compound';search.dispatchEvent(new w.Event('input'));search.focus();
    const hero=root.querySelector('.nl-builder-hero'),selectedSize=root.querySelector('[data-rb-id="compound-0"][data-rb-size="10 mg"]');
    const draft=w.localStorage.getItem('ap-research-builder-v2'),quoteCount=calls.filter(call=>call.body).length;
    const total=root.querySelector('.nl-price-total strong'),amount=total.querySelector('[data-usd-cents]');
    assert.equal(amount.dataset.usdCents,'48611');
    await w.AltaLocale.setCurrency('CAD');
    assert.equal(root.querySelector('.nl-builder-hero'),hero);assert.equal(root.querySelector('#ap-builder-query'),search);
    assert.equal(w.document.activeElement,search);assert.equal(search.value,'Compound');
    assert.equal(root.querySelector('[data-rb-group="Category A"]').getAttribute('aria-pressed'),'true');
    assert.equal(root.querySelector('[data-rb-id="compound-0"][data-rb-size="10 mg"]'),selectedSize);assert.equal(selectedSize.getAttribute('aria-pressed'),'true');
    assert.equal(root.querySelector('.nl-price-total strong'),total);assert.equal(amount.dataset.usdCents,'48611');
    assert.match(amount.textContent,/656\.25/);assert.match(total.querySelector('small').textContent,/CAD/);
    assert.match(root.querySelector('[data-rb-product="compound-0"] .ap-product-price').textContent,/243\.03/);
    assert.equal(w.localStorage.getItem('ap-research-builder-v2'),draft);assert.equal(calls.filter(call=>call.body).length,quoteCount);
    assert.equal(root.querySelector('[data-rb-checkout]').disabled,false);
    root.querySelector('[data-rb-mode="subscription"]').click();await settle();
    const expected=pricing.quote(JSON.parse(draft).lines,catalog,{mode:'subscription'}),monthly=root.querySelector('.nl-price-total strong');
    assert.equal(monthly.querySelector('[data-usd-cents]').dataset.usdCents,String(expected.total_cents));
    assert.equal(root.querySelector('.nl-builder-savings [data-usd-cents]').dataset.usdCents,String(expected.discount_cents));
    assert.match(monthly.querySelector('small').textContent,/CAD \/ paid month/);
    const monthlyCount=calls.filter(call=>call.body).length,monthlyDraft=w.localStorage.getItem('ap-research-builder-v2');
    await w.AltaLocale.setCurrency('USD');
    assert.equal(root.querySelector('.nl-price-total strong'),monthly);assert.match(monthly.textContent,/291\.68/);assert.match(monthly.querySelector('small').textContent,/USD \/ paid month/);
    assert.equal(w.localStorage.getItem('ap-research-builder-v2'),monthlyDraft);assert.equal(calls.filter(call=>call.body).length,monthlyCount);
    assert.equal(root.querySelector('[data-rb-checkout]'),null);assert.equal(env.added.length,0);
  }finally{env.dom.window.close();}
});
