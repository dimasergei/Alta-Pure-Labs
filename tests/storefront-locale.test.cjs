'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const source=read('locale.js');
const supported=JSON.parse(read('config/display-currencies.json')).supported_currencies;
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const defer=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
function country(overrides={}){return{version:'display-locale-v1',base:'USD',country:'CA',suggested_currency:'CAD',supported_currencies:supported,...overrides};}
function rates(overrides={}){
 const now=Date.now();
 return{version:'display-fx-v1',base:'USD',source:'European Central Bank',provider:'frankfurter-ecb-v2',status:'fresh',
  supported_currencies:supported,rates:{...Object.fromEntries(supported.map(code=>[code,1])),USD:1,CAD:1.4,EUR:.9,GBP:.8,AUD:1.5,JPY:150,KRW:1300},
  rate_date:new Date(now).toISOString().slice(0,10),fetched_at:new Date(now-1000).toISOString(),expires_at:new Date(now+3599000).toISOString(),...overrides};
}
const response=data=>({ok:true,status:200,json:async()=>data});
function generatedShells(){
 const files=new Map();
 const fakeFs={readFileSync:file=>files.get(String(file))??read(String(file)),writeFileSync:(file,value)=>files.set(String(file),String(value))};
 vm.runInNewContext(read('site-build.cjs'),{require:name=>name==='node:fs'?fakeFs:require(name),console:{log(){}}},{filename:'site-build.cjs',timeout:1000});
 return files;
}
const shells=generatedShells();
const defaultHTML='<!doctype html><html><head><title>Fixture product | PURE</title></head><body><main id="main"><h1>Fixture product</h1><input id="quantity" value="7"><div id="prices"></div><output id="checkout-usd">USD 119.99</output><output id="checkout-cad">CAD 168.42</output></main><label for="currency-select" data-currency-control-label>Display currency</label><select id="currency-select" data-currency-select><option value="auto">Automatic</option>'+supported.map(code=>'<option value="'+code+'">'+code+'</option>').join('')+'</select><p id="currency-display-status" data-currency-status role="status" aria-live="polite"></p><span id="currency-status" data-display-currency="note"></span></body></html>';
function page({html=defaultHTML,stored={},countryData=country(),rateData=rates(),fetcher,navigation=false,clock=false}={}){
 const dom=new JSDOM(html,{url:'https://pure.example/shop',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window,requests=[],timers=new Map();
 for(const[key,value]of Object.entries(stored))w.localStorage.setItem(key,value);
 let now=Date.now(),timerId=0;
 if(clock){
  const RealDate=w.Date;
  w.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
  w.setTimeout=(callback,delay)=>{const id=++timerId;timers.set(id,{callback,delay});return id;};
  w.clearTimeout=id=>timers.delete(id);
 }
 w.fetch=async(url,options)=>{requests.push({url:String(url),options});if(fetcher)return fetcher(String(url),options);return response(String(url).endsWith('=country')?countryData:rateData);};
 w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
 Object.defineProperty(w.navigator,'geolocation',{get(){throw Error('Currency display must not ask for precise geolocation');}});
 const identities={html:w.document.documentElement,head:w.document.head,body:w.document.body,title:w.document.title,main:w.document.querySelector('main')};
 if(navigation)w.eval(read('storefront-navigation.js'));
 w.eval(source);
 return{dom,w,requests,identities,timers,advance:milliseconds=>{now+=milliseconds;}};
}
async function initialized(options){const env=page(options);await env.w.AltaLocale.ready;await tick();return env;}
function markup(env,cents=1999,options={}){
 const host=env.w.document.getElementById('prices');host.innerHTML=env.w.AltaLocale.price(cents,options)+env.w.AltaLocale.currencyCode()+env.w.AltaLocale.estimateNote();return host;
}
function assertDocumentIntact(env){
 for(const[name,element]of Object.entries(env.identities)){if(name==='title')assert.equal(env.w.document.title,element);else assert.strictEqual(name==='main'?env.w.document.querySelector('main'):env.w.document[name==='html'?'documentElement':name],element,name+' identity must survive display changes');}
 assert.ok(env.w.document.querySelector('h1'),'page content must survive the html display-currency attribute');
}

test('generated storefront and account shells expose one accessible Automatic/manual selector in More',()=>{
 for(const name of ['index.html','account.html']){
  const dom=new JSDOM(shells.get(name));
  try{
   const d=dom.window.document,select=d.getElementById('currency-select');
   assert.ok(select.closest('#ap-more-menu'));assert.equal(d.querySelectorAll('#currency-select').length,1);
   assert.equal(d.querySelector('label[for="currency-select"]').textContent,'Display currency');
   assert.deepEqual([...select.options].map(option=>option.value),['auto',...supported]);
   const status=d.getElementById(select.getAttribute('aria-describedby'));
   assert.equal(status.getAttribute('role'),'status');assert.equal(status.getAttribute('aria-live'),'polite');
   assert.equal(d.querySelectorAll('[data-currency-status]').length,1,'one live status avoids duplicate announcements');
   assert.ok(d.querySelector('link[href="/pure-currency.css"]'));assert.equal(d.getElementById('currency-status').dataset.displayCurrency,'note');
   assert.doesNotMatch(select.textContent,/[\u{1F1E6}-\u{1F1FF}]/u,'currencies use readable names, not flag-only labels');
  }finally{dom.window.close();}
 }
});

test('Automatic uses the coarse server suggestion and verified rates without changing the page or USD basis',async()=>{
 const env=await initialized();
 try{
  const {w,requests}=env,L=w.AltaLocale;const host=markup(env);
  assert.equal(L.preference,'auto');assert.equal(L.country,'CA');assert.equal(L.currency,'CAD');assert.equal(L.effectiveCurrency,'CAD');
  assert.deepEqual([...L.supportedCurrencies],supported);assert.equal(w.document.documentElement.dataset.displayCurrency,'CAD');
  assert.match(host.textContent,/≈ CAD 27\.99/);assert.equal(host.querySelector('.pure-price').dataset.usdCents,'1999');assert.equal(host.querySelector('.pure-price-base'),null);
  assert.match(host.querySelector('.pure-price').getAttribute('aria-label'),/USD 19\.99/);
  assert.match(w.document.getElementById('currency-display-status').textContent,/ECB rates dated/);
  assert.equal(w.localStorage.getItem('ap-currency'),null,'automatic detection is not a manual preference');
  assert.deepEqual(requests.map(request=>request.url),['/api/customer-config?display_locale=country','/api/customer-config?display_locale=rates']);
  assert.deepEqual(requests.map(request=>request.options.cache),['no-store','default'],'country stays private while public rates honor the server cache lifetime');
  assert.ok(requests.every(request=>request.options.credentials==='omit'));
  assertDocumentIntact(env);
 }finally{env.dom.window.close();}
});

test('legacy explicit USD and non-USD choices remain manual despite a different country suggestion',async t=>{
 for(const code of ['USD','GBP','JPY'])await t.test(code,async()=>{
  const env=await initialized({stored:{'ap-currency':code}});
  try{assert.equal(env.w.AltaLocale.preference,'manual');assert.equal(env.w.AltaLocale.currency,code);assert.equal(env.w.AltaLocale.effectiveCurrency,code);assert.equal(env.w.localStorage.getItem('ap-currency'),code);assert.equal(env.w.document.getElementById('currency-select').value,code);if(code==='USD')assert.equal(env.requests.length,1);}finally{env.dom.window.close();}
 });
});

test('explicit USD persists between routes and Automatic can be restored without losing the server suggestion',async()=>{
 const env=await initialized();let next;
 try{
  await env.w.AltaLocale.setCurrency('USD');assert.equal(env.w.localStorage.getItem('ap-currency-mode'),'manual');assert.equal(env.w.localStorage.getItem('ap-currency'),'USD');
  next=await initialized({stored:{'ap-currency':'USD','ap-currency-mode':'manual'}});assert.equal(next.w.AltaLocale.effectiveCurrency,'USD');
  await next.w.AltaLocale.setCurrency('auto');assert.equal(next.w.AltaLocale.currency,'CAD');assert.equal(next.w.AltaLocale.preference,'auto');assert.equal(next.w.localStorage.getItem('ap-currency-mode'),'auto');
  assertDocumentIntact(env);assertDocumentIntact(next);
 }finally{env.dom.window.close();next?.dom.window.close();}
});

test('a late country suggestion cannot override a newer manual choice',async()=>{
 const pending=defer();
 const env=page({fetcher:url=>url.endsWith('=country')?pending.promise:response(rates())});
 try{
  await env.w.AltaLocale.setCurrency('USD');pending.resolve(response(country()));await env.w.AltaLocale.ready;
  assert.equal(env.w.AltaLocale.preference,'manual');assert.equal(env.w.AltaLocale.currency,'USD');assert.equal(env.w.AltaLocale.effectiveCurrency,'USD');assert.equal(env.requests.length,1);
  await env.w.AltaLocale.setCurrency('auto');assert.equal(env.w.AltaLocale.effectiveCurrency,'CAD');assertDocumentIntact(env);
 }finally{env.dom.window.close();}
});

test('late rates are preference-neutral and repeated changes share one request',async()=>{
 const pending=defer();
 const env=await initialized({countryData:country({country:'US',suggested_currency:'USD'}),fetcher:url=>url.endsWith('=country')?response(country({country:'US',suggested_currency:'USD'})):pending.promise});
 try{
  const first=env.w.AltaLocale.setCurrency('CAD'),second=env.w.AltaLocale.setCurrency('EUR');await env.w.AltaLocale.setCurrency('USD');
  assert.equal(env.requests.filter(request=>request.url.endsWith('=rates')).length,1);
  pending.resolve(response(rates()));await Promise.all([first,second]);
  assert.equal(env.w.AltaLocale.currency,'USD');assert.equal(env.w.AltaLocale.effectiveCurrency,'USD');assert.equal(env.w.localStorage.getItem('ap-currency'),'USD');
  assert.equal(env.w.document.documentElement.dataset.displayCurrency,'USD');assertDocumentIntact(env);
 }finally{env.dom.window.close();}
});

test('invalid or unavailable rates fail to USD while preserving the requested preference',async t=>{
 const now=Date.now();
 const cases={
  'wrong base':{base:'EUR'},'wrong version':{version:'display-fx-v0'},'wrong provider':{provider:'unknown'},'wrong source':{source:'unknown'},
  'expired':{expires_at:new Date(now-1000).toISOString()},'future fetch':{fetched_at:new Date(now+120000).toISOString()},'old fetch':{fetched_at:new Date(now-86401000).toISOString()},
  'old observation':{rate_date:new Date(now-8*86400000).toISOString().slice(0,10)},'invalid observation':{rate_date:'2026-02-30'},'future observation':{rate_date:new Date(now+86400000).toISOString().slice(0,10)},
  'negative rate':{rates:{...rates().rates,CAD:-1}},'zero rate':{rates:{...rates().rates,CAD:0}},'non-finite rate':{rates:{...rates().rates,CAD:NaN}},'missing rate':{rates:{USD:1}},'incorrect USD':{rates:{...rates().rates,USD:2}},
  'unavailable':{status:'unavailable',rates:{USD:1},rate_date:null,fetched_at:null,expires_at:null}
 };
 for(const[name,overrides]of Object.entries(cases))await t.test(name,async()=>{
  const env=await initialized({stored:{'ap-currency':'CAD'},rateData:rates(overrides)});
  try{
   const host=markup(env);assert.equal(env.w.AltaLocale.effectiveCurrency,'USD');assert.equal(env.w.AltaLocale.currency,'CAD');assert.equal(env.w.localStorage.getItem('ap-currency'),'CAD');
   assert.match(host.textContent,/USD 19\.99/);assert.doesNotMatch(host.querySelector('.pure-price').textContent,/≈/);assert.match(env.w.document.getElementById('currency-display-status').textContent,/CAD estimates unavailable · showing USD/);assertDocumentIntact(env);
  }finally{env.dom.window.close();}
 });
});

test('a failed country request leaves Automatic in USD while still offering the supported manual choices',async()=>{
 const env=await initialized({fetcher:url=>{if(url.endsWith('=country'))throw Error('offline');return response(rates());}});
 try{
  assert.equal(env.w.AltaLocale.preference,'auto');assert.equal(env.w.AltaLocale.effectiveCurrency,'USD');
  assert.equal(env.w.document.getElementById('currency-select').options.length,31);
  await env.w.AltaLocale.setCurrency('JPY');assert.equal(env.w.AltaLocale.effectiveCurrency,'JPY');assertDocumentIntact(env);
 }finally{env.dom.window.close();}
});

test('verified stale data is labeled and expiry immediately removes local amounts before retrying',async()=>{
 const now=Date.now();let rateRequests=0;
 const env=page({stored:{'ap-currency':'CAD'},clock:true,fetcher:url=>{
  if(url.endsWith('=country'))return response(country());
  rateRequests++;return response(rateRequests===1?rates({status:'stale',fetched_at:new Date(now-7200000).toISOString(),expires_at:new Date(now+60000).toISOString()}):{status:'unavailable',base:'USD',rates:{USD:1}});
 }});
 try{
  await env.w.AltaLocale.ready;const host=markup(env);
  assert.equal(env.w.AltaLocale.effectiveCurrency,'CAD');assert.match(env.w.document.getElementById('currency-display-status').textContent,/Last verified ECB rates/);
  const timer=[...env.timers.values()].find(timer=>timer.delay>8000);assert.ok(timer,'accepted estimates schedule an expiry refresh');
  env.advance(61000);timer.callback();await tick();
  assert.equal(env.w.AltaLocale.effectiveCurrency,'USD');assert.equal(env.w.document.documentElement.dataset.displayCurrency,'USD');assert.match(host.querySelector('.pure-price').textContent,/USD 19\.99/);
  assert.equal(env.w.localStorage.getItem('ap-currency'),'CAD');assert.equal(rateRequests,2);assertDocumentIntact(env);
 }finally{env.dom.window.close();}
});

test('formatting respects exact USD cents, native currency minor units, optional basis, and escaped markup',async()=>{
 const env=await initialized();
 try{
  const L=env.w.AltaLocale,host=markup(env,1999,{className:'" onmouseover="bad'});
  assert.equal(host.querySelector('[onmouseover]'),null);assert.equal(host.querySelector('.pure-price-base'),null);
  assert.match(L.price(1999,{showBase:true}),/pure-price-base/);assert.equal(L.price(1.5),'—');assert.equal(L.price(Infinity),'—');
  await L.setCurrency('USD');host.innerHTML=L.price(10000,{trimWhole:true})+L.price(10001,{trimWhole:true});
  assert.equal(host.querySelectorAll('.pure-price')[0].textContent,'USD 100');assert.equal(host.querySelectorAll('.pure-price')[1].textContent,'USD 100.01');
  assert.match(L.price(10000,{showCode:false,trimWhole:true}),/\$100</);assert.equal(L.formatMoney(19.99),'$19.99');
  await L.setCurrency('JPY');host.innerHTML=L.price(1999,{trimWhole:true});assert.equal(host.textContent,'≈ JPY 2,999');assert.equal(host.querySelector('.pure-price').dataset.usdCents,'1999');
  await L.setCurrency('GBP');host.innerHTML=L.price(10000,{trimWhole:true});assert.equal(host.textContent,'≈ GBP 80.00','only USD can trim whole-dollar decimals');
  assert.match(L.formatMoney(19.99),/≈ GBP 15\.99/);
 }finally{env.dom.window.close();}
});

test('dynamic marked prices update in place while authoritative unmarked checkout amounts remain unchanged',async()=>{
 const env=await initialized();
 try{
  const {w}=env,host=markup(env);const priceNode=host.querySelector('.pure-price'),codeNode=host.querySelector('.pure-currency-code');
  priceNode.dataset.usdCents='12345';await tick();assert.match(priceNode.textContent,/CAD 172\.83/);
  const dynamic=w.document.createElement('div');dynamic.innerHTML='<span data-usd-cents="10000">USD 100.00</span>';w.document.querySelector('main').append(dynamic);await tick();assert.equal(dynamic.textContent,'≈ CAD 140.00');
  await w.AltaLocale.setCurrency('EUR');assert.strictEqual(host.querySelector('.pure-price'),priceNode);assert.strictEqual(host.querySelector('.pure-currency-code'),codeNode);assert.equal(codeNode.textContent,'EUR');assert.match(priceNode.textContent,/EUR 111\.11/);
  assert.equal(w.document.getElementById('checkout-usd').textContent,'USD 119.99');assert.equal(w.document.getElementById('checkout-cad').textContent,'CAD 168.42');assertDocumentIntact(env);
 }finally{env.dom.window.close();}
});

test('currency changes preserve inputs, focus, saved cart state, and full document identity',async()=>{
 const env=await initialized();
 try{
  const {w}=env;markup(env);const input=w.document.getElementById('quantity');input.value='12';input.focus();w.localStorage.setItem('ap-cart','[{"id":"fixture","price":19.99,"qty":12}]');const saved=w.localStorage.getItem('ap-cart'),events=[];
  const unsubscribe=w.AltaLocale.onChange(event=>events.push(event));await w.AltaLocale.setCurrency('GBP');w.AltaLocale.refreshPrices(w.document.documentElement);
  assert.strictEqual(w.document.getElementById('quantity'),input);assert.equal(input.value,'12');assert.strictEqual(w.document.activeElement,input);assert.equal(w.localStorage.getItem('ap-cart'),saved);assert.equal(events.at(-1).reason,'currency');assert.equal(events.at(-1).effectiveCurrency,'GBP');
  unsubscribe();const count=events.length;await w.AltaLocale.setCurrency('USD');assert.equal(events.length,count);assertDocumentIntact(env);
 }finally{env.dom.window.close();}
});

test('manual currency selection in More preserves the open disclosure and keyboard focus',async()=>{
 const env=await initialized({html:shells.get('index.html'),navigation:true});
 try{
  const {w}=env,select=w.document.getElementById('currency-select'),panel=w.document.getElementById('ap-more-menu');select.focus();assert.equal(panel.hidden,false);
  select.value='GBP';select.dispatchEvent(new w.Event('change',{bubbles:true}));await tick();assert.equal(w.AltaLocale.currency,'GBP');assert.equal(panel.hidden,false);assert.strictEqual(w.document.activeElement,select);assert.equal(w.localStorage.getItem('ap-currency'),'GBP');
  const arrow=new w.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true});select.dispatchEvent(arrow);assert.equal(arrow.defaultPrevented,false,'native select navigation is not hijacked by menu link navigation');assertDocumentIntact(env);
 }finally{env.dom.window.close();}
});

test('English, French, and Spanish language updates remain independent of currency and cover shopping and FAQ copy',async()=>{
 const env=await initialized({html:defaultHTML.replace('</main>','<p data-i18n="researchCatalog"></p><input id="search" data-i18n-placeholder="searchPlaceholder"><button data-i18n-aria="openCart"></button><select id="language-select"><option value="en">English</option><option value="fr">Français</option><option value="es">Español</option></select></main>')});
 try{
  const {w}=env;const events=[];w.AltaLocale.onChange(event=>events.push(event));
  for(const language of ['en','fr','es']){
   w.AltaLocale.setLanguage(language);assert.equal(w.document.documentElement.lang,language);assert.equal(w.AltaLocale.currency,'CAD');assert.equal(events.at(-1).reason,'language');assert.equal(w.document.getElementById('language-select').value,language);
   for(const key of ['researchCatalog','cartEmpty','subtotal','placeRequest','ageVerificationTitle','ageGateCopy','spotlightDescription','policyDescription','faqHeading','faqCtaDescription'])assert.notEqual(w.AltaLocale.t(key),key,language+' missing '+key);
   for(let i=1;i<=20;i++){const n=String(i).padStart(2,'0');for(const key of ['faqQ'+n,'faqA'+n])assert.notEqual(w.AltaLocale.t(key),key,language+' missing '+key);}
  }
  assert.equal(w.localStorage.getItem('ap-language'),'es');assert.match(w.document.getElementById('search').placeholder,/Buscar/);assert.equal(w.document.querySelector('[data-i18n="researchCatalog"]').textContent,'Catálogo de investigación');assertDocumentIntact(env);
 }finally{env.dom.window.close();}
});
