'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom'),pricing=require('../lib/research-builder-pricing');
const source=fs.readFileSync('research-checkout-client.js','utf8');
const localeSource=fs.readFileSync('locale.js','utf8');
const displayLocaleResponse=require('./display-locale-fixture.cjs');
const catalog=[40,60,80,100].map((price,index)=>({id:'compound-'+index,name:'Compound '+index,category:'injectables',variants:[{size:'5mg',price}]}));
const lines=catalog.map(item=>({id:item.id,size:'5mg',qty:1}));
const existingCart=[{id:'saved-product',size:'10mg',qty:2}],clone=value=>JSON.parse(JSON.stringify(value));
function setup({draft={mode:'one_time',lines},respond,session,addError,publicPage=false,withLocale=false}={}){
 const dom=new JSDOM('<header class="ap-header">PURE navigation</header><main id="'+(publicPage?'ap-main':'root')+'"></main><footer class="ap-footer">PURE footer</footer>',{url:'https://pure.example/research-checkout',runScripts:'outside-only'}),w=dom.window,requests=[],added=[],navigated=[];
 if(draft!==null)w.localStorage.setItem('ap-research-builder-v2',typeof draft==='string'?draft:JSON.stringify(draft));
 w.localStorage.setItem('pp-cart',JSON.stringify(existingCart));
 w.fetch=async(url,options)=>{
  const display=displayLocaleResponse(url);if(display)return display;
  const call={url,body:JSON.parse(options.body),options:{...options,headers:{...options.headers}}};requests.push(call);
  if(respond){const result=await respond(call,requests);if(result)return result;}
  return{ok:true,status:200,json:async()=>pricing.quote(call.body.items,catalog,{mode:call.body.mode})};};
 const store={addItems(items){if(addError)throw Error(addError);added.push(clone(items));w.localStorage.setItem('pp-cart',JSON.stringify([...JSON.parse(w.localStorage.getItem('pp-cart')),...items]));}};
 const options={store,navigate:href=>navigated.push(href),...(session?{auth:{auth:{getSession:async()=>({data:{session}})}}}:{})};
 if(withLocale)w.eval(localeSource);
 w.eval(source);return{dom,w,root:w.document.querySelector('main'),requests,added,navigated,options,render:user=>w.ResearchCheckout.render(w.document.querySelector('main'),user,options)};
}

test('missing, malformed and duplicate drafts stay on the review page with recovery guidance and no network or cart changes',async()=>{
 for(const draft of [null,'{broken',{}, {lines:lines.slice(0,3)}, {lines:[lines[0],lines[0],lines[2],lines[3]]}]){
  const env=setup({draft});try{await env.render();
   assert.match(env.root.textContent,/Choose four different compounds in AUTO-STACK™/);assert.ok(env.root.querySelector('a[href="/research-builder?mode=one_time"]'));
   assert.equal(env.w.document.title,'AUTO-STACK™ Review | PURE');
   assert.equal(env.root.querySelector('[data-rc-checkout]'),null);assert.equal(env.requests.length,0);assert.equal(env.navigated.length,0);
   assert.deepEqual(JSON.parse(env.w.localStorage.getItem('pp-cart')),existingCart);
  }finally{env.dom.window.close();}
 }
});

test('public review keeps all review content in its centered shell and preserves the shared storefront',async()=>{
 const env=setup({publicPage:true,draft:{mode:'subscription',lines}}),header=env.w.document.querySelector('.ap-header'),footer=env.w.document.querySelector('.ap-footer');
 try{await env.render();
  const page=env.root.querySelector(':scope > .rc-public-page'),shell=page?.querySelector(':scope > .rc-public-shell');
  assert.ok(shell);assert.equal(env.root.children.length,1);
  for(const selector of ['.rc-back','.rc-heading','.rc-layout'])assert.ok(shell.querySelector(':scope > '+selector),selector+' shares the centered page container');
  assert.equal(env.w.document.querySelector('.ap-header'),header);assert.equal(header.parentElement,env.w.document.body);
  assert.equal(env.w.document.querySelector('.ap-footer'),footer);assert.equal(footer.parentElement,env.w.document.body);
  assert.equal(env.w.document.body.className,'');
  assert.equal(env.root.querySelector('.rc-pay').disabled,true);assert.equal(env.requests.length,1);assert.equal(env.added.length,0);
 }finally{env.dom.window.close();}
});

test('review submits only normalized selections for server pricing and adds a one-time set without replacing the existing cart',async()=>{
 const draft={mode:'one_time',lines:lines.map(item=>({...item,qty:99,unit_price_usd_cents:1}))},env=setup({draft});
 try{await env.render({email:'research@example.test'});
  assert.equal(env.w.document.title,'AUTO-STACK™ Review | PURE');
  assert.equal(env.root.querySelector('.rc-heading h1').textContent,'REVIEW YOUR AUTO-STACK™');
  assert.equal(env.root.querySelector('.rc-heading h1 sup').textContent,'™');
  assert.equal(env.root.querySelector('.rc-public-page'),null,'embedded hosts retain their existing layout');
  assert.equal(env.root.querySelector('.rc-summary h2').textContent,'Your AUTO-STACK™');
  assert.equal(env.root.querySelector('.rc-back').getAttribute('href'),'/research-builder?mode=one_time');
  assert.match(env.root.querySelector('.rc-back').textContent,/Back to AUTO-STACK™/);
  assert.doesNotMatch(env.root.textContent,/Research Builder/);
  assert.deepEqual(env.requests.map(call=>call.body),[{action:'quote',items:lines,mode:'one_time'}]);
  assert.equal(env.requests[0].url,'/api/customer-config?research_builder=1');assert.equal(env.requests[0].options.cache,'no-store');
  assert.equal(env.root.querySelectorAll('.rc-line').length,4);assert.match(env.root.querySelector('.rc-due').textContent,/\$280\.00\s*USD/);
  assert.equal(env.root.querySelector('form'),null);assert.equal(env.added.length,0);assert.equal(env.navigated.length,0);
  const button=env.root.querySelector('[data-rc-checkout]');button.click();button.click();
  assert.deepEqual(env.added,[lines]);assert.deepEqual(env.navigated,['/checkout']);assert.equal(env.requests.length,1);
  assert.deepEqual(JSON.parse(env.w.localStorage.getItem('pp-cart')),[...existingCart,...lines]);
  assert.deepEqual(JSON.parse(env.w.localStorage.getItem('ap-research-builder-v2')),draft);
 }finally{env.dom.window.close();}
});

test('review displays verified member savings and escapes the signed-in account and product names',async()=>{
 const env=setup({session:{access_token:'fixture_verified_member_token_1234'},respond:async call=>{
  const quote=pricing.quote(call.body.items,catalog,{membership:{plan:'elite'}});quote.lines[0].name='<img src=x onerror=alert(1)>';return{ok:true,status:200,json:async()=>quote};}});
 try{await env.render({email:'<script>untrusted()</script>@example.test'});
  assert.equal(env.requests[0].options.headers.Authorization,'Bearer fixture_verified_member_token_1234');
  assert.match(env.root.querySelector('.rc-summary').textContent,/PURE BLACK savings/);assert.match(env.root.querySelector('.rc-due').textContent,/\$252\.00/);
  assert.equal(env.root.querySelector('script,img'),null);assert.match(env.root.querySelector('.rc-line strong').textContent,/<img/);
 }finally{env.dom.window.close();}
});

test('an expired optional session retries public pricing without retaining the member saving',async()=>{
 const env=setup({session:{access_token:'fixture_expired_member_token_1234'},respond:async call=>call.options.headers.Authorization?{ok:false,status:401,json:async()=>({error:'Expired session'})}:null});
 try{await env.render();assert.equal(env.requests.length,2);assert.equal(env.requests[1].options.headers.Authorization,undefined);
  assert.match(env.root.querySelector('.rc-due').textContent,/\$280\.00/);assert.doesNotMatch(env.root.querySelector('.rc-summary').textContent,/PURE (WHITE|BLACK) savings/);
  assert.ok(env.root.querySelector('[data-rc-checkout]'));assert.equal(env.added.length,0);
 }finally{env.dom.window.close();}
});

test('quote errors and malformed totals never expose a checkout action or mutate the saved cart',async()=>{
 for(const respond of [
  async()=>({ok:false,status:503,json:async()=>({error:'Pricing temporarily unavailable.'})}),
  async call=>({ok:true,status:200,json:async()=>({...pricing.quote(call.body.items,catalog),currency:'CAD'})}),
  async call=>({ok:true,status:200,json:async()=>({...pricing.quote(call.body.items,catalog),total_cents:-1})}),
  async call=>({ok:true,status:200,json:async()=>({...pricing.quote(call.body.items,catalog),lines:[]})})
 ]){
  const env=setup({respond});try{await env.render();assert.ok(env.root.querySelector('[role="alert"]'));assert.equal(env.root.querySelector('[data-rc-checkout]'),null);
   assert.deepEqual(JSON.parse(env.w.localStorage.getItem('pp-cart')),existingCart);assert.equal(env.added.length,0);assert.equal(env.navigated.length,0);
  }finally{env.dom.window.close();}
 }
});

test('a cart write failure is recoverable and never navigates to an empty or partial checkout',async()=>{
 const env=setup({addError:'Your saved cart is unavailable.'});try{await env.render();const button=env.root.querySelector('[data-rc-checkout]');button.click();
  assert.equal(button.disabled,false);assert.match(env.root.querySelector('.rc-feedback').textContent,/saved cart is unavailable/);
  assert.equal(env.navigated.length,0);assert.deepEqual(JSON.parse(env.w.localStorage.getItem('pp-cart')),existingCart);
 }finally{env.dom.window.close();}
});

test('monthly review clearly remains a preview with no order, payment, subscription mutation or cart change',async()=>{
 const env=setup({draft:{mode:'subscription',lines}});try{await env.render();
  assert.equal(env.requests.length,1);assert.equal(env.requests[0].body.action,'quote');assert.equal(env.requests[0].body.mode,'subscription');
  assert.match(env.root.querySelector('.rc-due').textContent,/\$168\.00\s*USD \/ month/);
  const terms=env.root.querySelector('.rc-terms').textContent;
  assert.match(terms,/Monthly until canceled/);assert.match(terms,/no minimum deliveries/);
  assert.match(terms,/Edit future selections anytime/);assert.match(terms,/without waiting for a first shipment/);
  assert.match(terms,/Cancel anytime/);assert.match(terms,/Cancellation stops future renewals/);
  assert.doesNotMatch(terms,/Three deliveries|third delivery|after the first delivery/);
  assert.match(env.root.querySelector('.rc-unavailable').textContent,/does not create a subscription, collect payment or schedule a delivery/);
  assert.equal(env.root.querySelector('[data-rc-checkout]'),null);assert.equal(env.root.querySelector('form'),null);assert.equal(env.root.querySelector('.rc-pay').disabled,true);
  env.root.querySelector('.rc-pay').click();assert.equal(env.requests.length,1,'unavailable monthly enrollment never submits another request');
  assert.ok(env.root.querySelector('a[href="/research-builder?mode=one_time"]'));assert.equal(env.navigated.length,0);assert.equal(env.added.length,0);
  assert.deepEqual(JSON.parse(env.w.localStorage.getItem('pp-cart')),existingCart);
 }finally{env.dom.window.close();}
});

test('converted review prices retain the original quote and purchase mode without remounting',async()=>{
 for(const mode of ['one_time','subscription']){
  const env=setup({publicPage:true,withLocale:true,draft:{mode,lines}});
  try{
   await env.w.AltaLocale.setCurrency('CAD');await env.render();
   const shell=env.root.querySelector('.rc-public-shell'),review=env.root.querySelector('.rc-layout'),button=env.root.querySelector('.rc-pay');
   const total=env.root.querySelector('.rc-due [data-usd-cents]'),expected=pricing.quote(lines,catalog,{mode});
   assert.equal(total.dataset.usdCents,String(expected.total_cents));assert.match(total.textContent,mode==='one_time'?/378\.00/:/226\.80/);
   assert.match(env.root.querySelector('.rc-due small').textContent,mode==='one_time'?/^CAD$/:/^CAD \/ month$/);
   assert.equal(env.root.querySelectorAll('.rc-line-price [data-usd-cents]').length,mode==='one_time'?4:8);
   const draft=env.w.localStorage.getItem('ap-research-builder-v2');
   await env.w.AltaLocale.setCurrency('USD');
   assert.equal(env.root.querySelector('.rc-public-shell'),shell);assert.equal(env.root.querySelector('.rc-layout'),review);assert.equal(env.root.querySelector('.rc-pay'),button);
   assert.equal(total.dataset.usdCents,String(expected.total_cents));assert.match(total.textContent,mode==='one_time'?/280\.00/:/168\.00/);
   assert.match(env.root.querySelector('.rc-due small').textContent,/^USD/);
   assert.equal(env.requests.length,1);assert.deepEqual(env.requests[0].body,{action:'quote',items:lines,mode});
   assert.equal(env.w.localStorage.getItem('ap-research-builder-v2'),draft);assert.equal(button.disabled,mode==='subscription');
   button.click();
   assert.deepEqual(env.added,mode==='one_time'?[lines]:[]);assert.deepEqual(env.navigated,mode==='one_time'?['/checkout']:[]);
   assert.equal(env.requests.length,1);
  }finally{env.dom.window.close();}
 }
});
