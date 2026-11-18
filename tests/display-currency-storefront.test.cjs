'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM,VirtualConsole}=require('jsdom');
const currencyConfig=require('../config/display-currencies.json');
const views=require('../reference-ui-functions.cjs');
const read=file=>fs.readFileSync(file,'utf8');
const settle=()=>new Promise(resolve=>setTimeout(resolve,0));

function displayRates(){
 const now=Date.now();
 return {version:'display-fx-v1',base:'USD',source:'European Central Bank',provider:'frankfurter-ecb-v2',status:'fresh',
  rates:Object.fromEntries(currencyConfig.supported_currencies.map(code=>[code,code==='CAD'?1.4:code==='JPY'?150:1])),
  rate_date:new Date(now).toISOString().slice(0,10),fetched_at:new Date(now).toISOString(),expires_at:new Date(now+3600000).toISOString(),
  supported_currencies:currencyConfig.supported_currencies};
}
function referenceSource(file,scope,anchor){
 return read(file).replace(anchor,Object.entries(views[scope]).map(([name,fn])=>'\n '+name+' = '+fn.toString()+';\n').join('')+anchor);
}
async function fixture(route,{workspace=false,cart=[]}={}){
 const errors=[],requests=[],vc=new VirtualConsole();vc.on('jsdomError',error=>errors.push(error.message));
 const dom=new JSDOM(read('storefront-v2.html'),{url:'https://getpurelabs.com'+route,runScripts:'outside-only',virtualConsole:vc});
 const w=dom.window,d=w.document;
 w.localStorage.setItem('ap-age-verified','true');
 if(cart.length)w.localStorage.setItem('pp-cart',JSON.stringify(cart));
 w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
 w.HTMLElement.prototype.scrollIntoView=()=>{};
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.fetch=async(url,options={})=>{
  const target=String(url);
  if(target.includes('display_locale=country'))return {ok:true,json:async()=>({version:'display-locale-v1',base:'USD',country:'US',suggested_currency:'USD',supported_currencies:currencyConfig.supported_currencies})};
  if(target.includes('display_locale=rates'))return {ok:true,json:async()=>displayRates()};
  if(target.includes('checkout=public'))return {ok:true,json:async()=>({methods:[],delivery_options:[]})};
  if(target.includes('checkout=cart')){
   const body=JSON.parse(options.body);requests.push(body);
   const subtotal=body.items.reduce((sum,line)=>sum+Math.round(w.AltaStore.product(line.id).variants.find(v=>v.size===line.size).price*100)*line.qty,0);
   const coupon=body.coupon==='BLACKFRIDAY15'?body.coupon:'',discount=coupon?Math.round(subtotal*.15):0;
   return {ok:true,json:async()=>({currency:'USD',subtotal_cents:subtotal,discount_cents:discount,total_cents:subtotal-discount,tax_cents:0,
    pricing:{coupon_code:coupon,coupon_discount_cents:discount,delivery:{shipping_cents:0,extras:[]}}})};
  }
  return {ok:true,json:async()=>[]};
 };
 const scripts=[read('locale.js'),read('products.js'),read('product-images.js'),referenceSource('storefront-v2.js','store',' window.AltaStore=')];
 if(workspace)scripts.push(referenceSource('workspace-v2.js','workspace',' window.AltaWorkspace='));
 scripts.push(read('reference-ui.js'));
 w.eval(scripts.join('\n'));
 d.dispatchEvent(new w.Event('DOMContentLoaded'));
 for(let i=0;i<4;i++)await settle();
 return {w,d,requests,async close(){dom.window.close();assert.deepEqual(errors,[],route);}};
}

test('local display refresh preserves product strength, quantity and canonical USD cart values',async()=>{
 const f=await fixture('/product/bpc-157?size=10mg');
 try{
  const {w,d}=f,input=d.getElementById('ap-detail-quantity'),heading=d.querySelector('h1');
  input.value='7';input.dispatchEvent(new w.Event('input',{bubbles:true}));
  const unit=w.AltaStore.product('bpc-157').variants.find(v=>v.size==='10mg').price;
  await w.AltaLocale.setCurrency('CAD');await settle();
  assert.equal(d.getElementById('ap-detail-quantity'),input);
  assert.equal(input.value,'7');assert.equal(d.querySelector('h1'),heading);
  assert.equal(w.AltaStore.selections['bpc-157'],'10mg');
  assert.match(d.querySelector('.ap-detail-price').textContent,/CAD/);
  assert.equal(d.querySelector('[data-mobile-total] [data-usd-cents]').getAttribute('data-usd-cents'),String(Math.round(unit*100)*7));
  await w.AltaLocale.setCurrency('JPY');await settle();
  assert.equal(input.value,'7');assert.match(d.querySelector('.ap-detail-price').textContent,/JPY/);
  d.querySelector('.nl-purchase [data-action="detail-add"]').click();
  assert.deepEqual(JSON.parse(JSON.stringify(w.AltaStore.cart)).map(({id,size,qty,price})=>({id,size,qty,price})),[{id:'bpc-157',size:'10mg',qty:7,price:unit}]);
  assert.equal(w.localStorage.getItem('ap-shipping-country'),null);
 }finally{await f.close();}
});

test('local display refresh preserves bulk quantities, search and draft contents',async()=>{
 const f=await fixture('/bulk-orders',{workspace:true});
 try{
  const {w,d}=f,search=d.getElementById('ap-bulk-query');
  search.value='BPC';search.dispatchEvent(new w.Event('input',{bubbles:true}));
  const input=d.querySelector('[data-bulk-id="bpc-157"]');
  assert.ok(input);input.value='10';input.dispatchEvent(new w.Event('input',{bubbles:true}));
  const before=w.localStorage.getItem('ap-bulk-draft-v2');
  await w.AltaLocale.setCurrency('CAD');await settle();
  assert.equal(d.getElementById('ap-bulk-query'),search);assert.equal(search.value,'BPC');
  assert.equal(d.querySelector('[data-bulk-id="bpc-157"]'),input);assert.equal(input.value,'10');
  assert.equal(w.localStorage.getItem('ap-bulk-draft-v2'),before);
  assert.match(d.querySelector('.nl-bulk-estimate-total').textContent,/CAD/);
  await w.AltaLocale.setCurrency('USD');await settle();
  assert.equal(input.value,'10');assert.equal(w.localStorage.getItem('ap-bulk-draft-v2'),before);
  assert.doesNotMatch(d.querySelector('.nl-bulk-estimate-total').textContent,/CAD|≈/);
 }finally{await f.close();}
});

test('cart display currency changes preserve the coupon and exact quote request without initiating payment',async()=>{
 const f=await fixture('/shop',{cart:[{id:'bpc-157',size:'10mg',qty:2}]});
 try{
  const {w,d,requests}=f,root=d.getElementById('ap-cart-content');
  w.eval(read('cart-reference.js'));await w.AltaCartNmi.offer(root);
  const coupon=root.querySelector('[name="nlc_coupon"]');coupon.value='BLACKFRIDAY15';root.querySelector('[data-nlc-apply]').click();
  for(let i=0;i<4;i++)await settle();
  assert.equal(requests.length,2);assert.equal(requests[1].coupon,'BLACKFRIDAY15');
  const before=JSON.stringify(requests),savedCart=w.localStorage.getItem('pp-cart'),instant=root.querySelector('[data-nlc-instant-amount]').textContent;
  await w.AltaLocale.setCurrency('CAD');await settle();
  assert.equal(root.querySelector('[name="nlc_coupon"]'),coupon);assert.equal(coupon.value,'BLACKFRIDAY15');
  assert.match(root.querySelector('.nlc-proceed').textContent,/CAD/);
  assert.equal(root.querySelector('[data-nlc-instant-amount]').textContent,instant);assert.match(instant,/USD/);
  await w.AltaLocale.setCurrency('JPY');await settle();
  assert.equal(JSON.stringify(requests),before);assert.equal(w.localStorage.getItem('pp-cart'),savedCart);
  assert.ok(requests.every(body=>body.country==='US'&&body.method_id===null&&!('currency' in body)&&!('display_currency' in body)));
  assert.equal(root.querySelector('.nlc-proceed').getAttribute('href'),'/checkout');
  assert.match(root.querySelector('[data-nlc-coupon-status]').textContent,/BLACKFRIDAY15 applied/);
 }finally{await f.close();}
});

test('homepage free-shipping threshold follows display FX without changing the USD eligibility amount',async()=>{
 const f=await fixture('/');
 try{
  const {w,d}=f,trust=d.querySelector('.nl-trust');
  assert.match(trust.textContent,/Free shipping over \$150/);
  await w.AltaLocale.setCurrency('CAD');await settle();
  assert.match(trust.textContent,/Free shipping over CA\$210\.00/);
  assert.doesNotMatch(trust.textContent,/≈|US shipping/);
  await w.AltaLocale.setCurrency('USD');await settle();
  assert.match(trust.textContent,/Free shipping over \$150/);
 }finally{await f.close();}
});
