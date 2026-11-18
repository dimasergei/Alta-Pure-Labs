'use strict';
// Run after building: this executes the published HTML and every local script in
// its actual parser/defer order. Only network responses and browser APIs are mocked.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM,ResourceLoader,VirtualConsole} = require('jsdom');
const pricing = require('../lib/research-builder-pricing');
const catalog = require('../lib/catalog.json');
const displayLocaleResponse = require('./display-locale-fixture.cjs');
const output = path.resolve(process.env.PURE_PROGRAM_BUILD_DIR || 'public-build');
const items = pricing.catalog(catalog).slice(0,4).map(product => ({id:product.id,size:product.variants[0].size,qty:1}));
const titles = {'/memberships':'PURE Memberships | PURE','/research-builder':'AUTO-STACK™ | PURE','/research-checkout':'AUTO-STACK™ Review | PURE'};
const tick = () => new Promise(resolve => setTimeout(resolve,0));
const deferred = () => {let resolve;const promise = new Promise(done => {resolve = done;});return {promise,resolve};};
const response = data => ({ok:true,status:200,json:async () => data});
async function until(predicate,label) {
  const deadline = Date.now()+3000;
  while (!predicate()) {if(Date.now()>deadline)throw Error('Timed out: '+label);await tick();}
}

function setup(route,{earlyCoa=false,holdCatalog=false}={}) {
  const base = route.replace(/\/+$/,'').replace(/\.html$/,'');
  const coa = deferred(),builderScript = deferred(),catalogReply = deferred();
  const errors = [],calls = [],scripts = [];
  const console = new VirtualConsole();console.on('jsdomError',error => errors.push(error.message));
  class PublishedResources extends ResourceLoader {
    fetch(value) {
      const url = new URL(value);
      if(url.hostname==='cdn.jsdelivr.net'&&url.pathname.includes('supabase'))return Promise.resolve(Buffer.from('window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}})}})};'));
      if(url.origin!=='https://getpurelabs.com')throw Error('Unexpected external resource: '+url.origin+url.pathname);
      if(!url.pathname.endsWith('.js'))return Promise.resolve(Buffer.from(''));
      const filename = path.join(output,url.pathname.replace(/^\//,''));
      scripts.push(url.pathname);
      const bytes = fs.readFileSync(filename);
      if(earlyCoa&&url.pathname==='/research-builder-client.js') {
        const pending=builderScript.promise.then(()=>bytes);pending.abort=()=>{};return pending;
      }
      return Promise.resolve(bytes);
    }
  }
  const dom = new JSDOM(fs.readFileSync(path.join(output,base.slice(1)+'.html'),'utf8'),{
    url:'https://getpurelabs.com'+route,runScripts:'dangerously',resources:new PublishedResources(),virtualConsole:console,pretendToBeVisual:true,
    beforeParse(window) {
      Object.defineProperty(window.navigator,'doNotTrack',{value:'1'});
      window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
      window.HTMLElement.prototype.scrollIntoView=function(){};
      window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
      window.HTMLDialogElement.prototype.close=function(){this.open=false;};
      if(base==='/research-checkout')window.localStorage.setItem('ap-research-builder-v2',JSON.stringify({mode:'subscription',lines:items}));
      window.fetch=async(value,options={})=>{
        const url = new URL(value,window.location.href),body = options.body?JSON.parse(options.body):null;
        calls.push({url:url.pathname+url.search,body});
        const display=displayLocaleResponse(url.href);if(display)return display;
        if(url.pathname==='/data/verified-coas.json')return coa.promise;
        if(url.pathname==='/api/customer-config'&&url.searchParams.get('research_builder')==='1') {
          if(body)return response(pricing.quote(body.items,catalog,{mode:body.mode}));
          if(holdCatalog)await catalogReply.promise;
          return response({catalog:pricing.catalog(catalog),terms:pricing.terms,one_time_available:true,subscription_available:false});
        }
        if(url.pathname==='/api/customer-config'&&!url.search)return response({supabaseUrl:'https://fixture.invalid',anonKey:'fixture-public-key'});
        if(url.pathname==='/api/customer-config'&&url.searchParams.get('checkout')==='public')return response({methods:[],capabilities:{}});
        if(url.pathname==='/data/supplier-coas.json')return response({reports:[],coverage:[]});
        throw Error('Unexpected request: '+url.pathname+url.search);
      };
    }
  });
  return {dom,w:dom.window,d:dom.window.document,base,errors,calls,scripts,coa,builderScript,catalogReply};
}

async function start(route,options={}) {
  const env=setup(route,options);
  try {
    if(options.earlyCoa) {
      await until(()=>env.w.AltaWorkspace&&env.calls.some(call=>call.url==='/data/verified-coas.json'),'workspace before final program scripts');
      assert.equal(env.w.PureResearchBuilder,undefined,'the COA response must precede the builder and final program scripts');
      env.coa.resolve(response([]));await tick();await tick();
      assert.equal(env.d.title,titles[env.base]);
      assert.doesNotMatch(env.d.querySelector('#ap-main').textContent,/This page could not be found/);
      env.builderScript.resolve();
    }
    await until(()=>env.d.readyState==='complete','published document load');
    return env;
  } catch(error) {env.dom.window.close();throw error;}
}
function healthy(env) {
  assert.deepEqual(env.errors,[],'published scripts must execute without errors');
  assert.equal(env.d.title,titles[env.base]);
  assert.doesNotMatch(env.d.querySelector('#ap-main').textContent,/This page could not be found|Loading your workspace/);
  for(const name of ['conversion-config','membership-experience','membership-checkout','conversion-ui','storefront-v2','workspace-v2','research-builder-client','research-checkout-client','program-pages'])assert.ok(env.scripts.includes('/'+name+'.js'),name+' was loaded from the published page');
  assert.ok(env.d.querySelector('#ap-age-dialog').open,'startup must leave the age-confirmation gate untouched');
  assert.equal(env.w.localStorage.getItem('ap-age-verified'),null,'tests do not accept the age confirmation');
  assert.ok(env.calls.every(call=>!call.body||call.body.action==='quote'),'page startup and refreshes never place orders or initiate payments');
}
async function refresh(env) {
  env.coa.resolve(response([]));await tick();await tick();
  env.w.AltaLocale.setLanguage('fr');await tick();
  await env.w.AltaLocale.setCurrency('CAD');await tick();
  // Exercise the normalized aliases through the same shared render entry point.
  env.w.AltaWorkspace.render(env.base+'.html/',env.d.querySelector('#ap-main'));
}

for(const [route,earlyCoa] of [['/memberships',false],['/memberships.html',true]])test(route+' retains membership content, annual selection and title through early/late shared refreshes',async()=>{
  const env=await start(route,{earlyCoa});
  try {
    await until(()=>env.d.querySelectorAll('.mx-card').length===3,'membership cards');
    const page=env.d.querySelector('.mx-membership-page');
    env.d.querySelector('[data-mx-period="annual"]').click();
    const annual=env.d.querySelector('[data-mx-period="annual"]');
    assert.match(env.d.querySelector('.mx-card-white .mx-price').textContent,/191\.90/);
    await refresh(env);
    assert.equal(env.d.querySelector('.mx-membership-page'),page,'background updates must preserve the mounted page');
    assert.equal(env.d.querySelector('[data-mx-period="annual"]'),annual,'billing selection must not be remounted');
    assert.equal(annual.getAttribute('aria-pressed'),'true');
    assert.equal(env.d.activeElement,annual);
    assert.equal(env.d.querySelector('.mx-card-black .mx-choose').getAttribute('href'),'/checkout?plan=elite&period=annual');
    healthy(env);
  } finally {env.dom.window.close();}
});

for(const [route,earlyCoa] of [['/research-builder',false],['/research-builder.html',true]])test(route+' preserves selections, strengths, search and a single builder mount through shared refreshes',async()=>{
  const env=await start(route,{earlyCoa});
  try {
    await until(()=>env.d.querySelector('[data-rb-add]'),'builder catalog');
    const hero=env.d.querySelector('.nl-builder-hero'),first=items[0].id;
    const strength=env.d.querySelector(`[data-rb-product="${first}"] [data-rb-size]:nth-child(2)`);
    strength.click();
    for(const item of items)env.d.querySelector(`[data-rb-add="${item.id}"]`).click();
    await until(()=>env.d.querySelector('[data-rb-checkout]')?.disabled===false,'server quote');
    const search=env.d.querySelector('#ap-builder-query');
    search.value=catalog.find(product=>product.id===first).name;search.dispatchEvent(new env.w.Event('input',{bubbles:true}));search.focus();
    const draft=env.w.localStorage.getItem('ap-research-builder-v2'),quoteCount=env.calls.filter(call=>call.body?.action==='quote').length;
    assert.equal(JSON.parse(draft).lines[0].size,strength.dataset.rbSize);
    await refresh(env);
    assert.equal(env.d.querySelector('.nl-builder-hero'),hero);
    assert.equal(env.d.querySelector('#ap-builder-query'),search);
    assert.equal(env.d.activeElement,search);
    assert.equal(env.d.querySelectorAll('.nl-builder-slot.is-selected').length,4);
    assert.equal(env.w.localStorage.getItem('ap-research-builder-v2'),draft);
    assert.equal(env.d.querySelector('[data-rb-checkout]').disabled,false);
    assert.equal(env.calls.filter(call=>call.url==='/api/customer-config?research_builder=1'&&!call.body).length,1,'one catalog fetch means one builder mount');
    assert.equal(env.calls.filter(call=>call.body?.action==='quote').length,quoteCount,'background refreshes do not restart quotes');
    healthy(env);
  } finally {env.dom.window.close();}
});

test('COA and locale updates preserve an in-flight builder mount',async()=>{
  const env=await start('/research-builder',{holdCatalog:true});
  try {
    const loading=env.d.querySelector('.nl-builder-loading');assert.ok(loading);
    await refresh(env);
    assert.equal(env.d.querySelector('.nl-builder-loading'),loading);
    assert.equal(env.calls.filter(call=>call.url==='/api/customer-config?research_builder=1'&&!call.body).length,1);
    env.catalogReply.resolve();await until(()=>env.d.querySelector('[data-rb-add]'),'pending builder completion');
    env.d.querySelector('[data-rb-add]').click();
    assert.equal(JSON.parse(env.w.localStorage.getItem('ap-research-builder-v2')).lines.length,1,'one click has one handler');
    healthy(env);
  } finally {env.dom.window.close();}
});

for(const [route,earlyCoa] of [['/research-checkout',false],['/research-checkout.html',true]])test(route+' retains its quoted review and title without creating a recurring payment',async()=>{
  const env=await start(route,{earlyCoa});
  try {
    await until(()=>env.d.querySelector('.rc-layout'),'quoted research review');
    const root=env.d.querySelector('main#ap-main'),shell=root.querySelector(':scope > .rc-public-page > .rc-public-shell');
    assert.ok(shell,'the direct public review gets its own centered page shell');
    for(const selector of ['.rc-back','.rc-heading','.rc-layout'])assert.ok(shell.querySelector(':scope > '+selector),selector+' stays within the review shell');
    const header=env.d.querySelector('body > .ap-header'),footer=env.d.querySelector('body > .ap-footer');
    assert.ok(header);assert.ok(footer);
    const review=env.d.querySelector('.rc-layout');
    await refresh(env);
    assert.equal(root.querySelector('.rc-public-shell'),shell);
    assert.equal(env.d.querySelector('body > .ap-header'),header);assert.equal(env.d.querySelector('body > .ap-footer'),footer);
    assert.equal(env.d.querySelector('.rc-layout'),review);
    assert.equal(env.d.querySelectorAll('.rc-line').length,4);
    assert.equal(env.d.querySelector('.rc-pay').disabled,true);
    assert.match(env.d.querySelector('.rc-unavailable').textContent,/does not create a subscription/);
    assert.equal(env.calls.filter(call=>call.body?.action==='quote').length,1);
    healthy(env);
  } finally {env.dom.window.close();}
});

test('program route ownership leaves ordinary workspace routes intact',async()=>{
  const env=await start('/memberships');
  try {
    const root=env.d.querySelector('#ap-main');
    env.w.AltaWorkspace.render('/bulk-orders',root);
    assert.equal(env.d.title,'Bulk Orders | PURE');assert.ok(root.querySelector('.nl-bulk-hero'));
    env.w.AltaWorkspace.render('/coas',root);
    assert.equal(env.d.title,'COA Library | PURE');assert.ok(root.querySelector('.pure-coa-page'));
    await tick();assert.deepEqual(env.errors,[]);
  } finally {env.dom.window.close();}
});
