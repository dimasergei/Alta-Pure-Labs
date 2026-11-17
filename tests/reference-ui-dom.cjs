'use strict';
const {JSDOM,VirtualConsole}=require('jsdom'),fs=require('node:fs'),assert=require('node:assert/strict');
const read=p=>fs.readFileSync(p,'utf8');
const retiredCopy=/\bBOGO\b|research\s+builder|\bmemberships?\b|subscribe and save|free\s+BAC|buy\s*1\s*,?\s*get\s*1/i;
const retiredRoute=/^\/(?:memberships?|research-builder|research-checkout|offers)(?:[/.?#]|$)|^\/(?:account|my-account)\/(?:memberships?|subscriptions)(?:[/.?#]|$)/;
function assertCurrentView(d,route){
 for(const a of d.querySelectorAll('a[href]'))assert.doesNotMatch(a.getAttribute('href'),retiredRoute,route+' has no retired destinations');
 for(const area of d.querySelectorAll('header,#ap-main,footer'))assert.doesNotMatch(area.textContent,retiredCopy,route+' has no retired feature or offer copy');
 assert.equal(d.querySelectorAll('#ap-main del,#ap-main [data-promo-clock],#ap-main .nl-offer-grid').length,0,route+' has no old sale presentation');
}
async function setup(route){const errors=[];const console=new VirtualConsole();console.on('jsdomError',e=>errors.push(e.message));const dom=new JSDOM(read('public-build/index.html'),{url:'https://getpurelabs.com'+route,runScripts:'outside-only',virtualConsole:console}),w=dom.window;w.localStorage.setItem('ap-age-verified','true');w.matchMedia=()=>({matches:false});w.HTMLElement.prototype.scrollIntoView=()=>{};w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};w.fetch=async()=>({ok:true,json:async()=>[]});w.AltaConversionConfig=require('../config/conversion.json');w.eval(read('public-build/conversion-ui.js')+'\n'+read('public-build/products.js')+'\n'+read('public-build/product-images.js')+'\n'+read('public-build/storefront-v2.js')+'\n'+read('public-build/workspace-v2.js'));await new Promise(r=>setTimeout(r,0));assert.deepEqual(errors,[],route);assertCurrentView(w.document,route);return{dom,w,d:w.document};}
(async()=>{
 {const{dom,d}=await setup('/');assert.match(d.querySelector('h1').textContent,/CUTTING EDGEPURITY/);assert.equal(d.querySelectorAll('#nl-featured .ap-product-card').length,10);assert.ok(d.querySelector('#faq'));dom.window.close();}
 {const{dom,d,w}=await setup('/shop');assert.equal(d.querySelector('h1').textContent,'All Products');assert.match(d.querySelector('.nl-shop-header p').textContent,/99%\+ purity/);assert.equal(d.querySelector('.nl-shop-sale'),null);assert.equal(d.querySelector('#ap-result-count'),null);assert.deepEqual([...d.querySelectorAll('.nl-filter-pills button')].map(x=>x.textContent),['All Products','Peptides','Mist Applicators','Supplies','Equipment']);assert.equal(d.querySelectorAll('#ap-catalog-grid .ap-product-card').length,20);const add=d.querySelector('[data-action="add"]');add.click();assert.equal(w.AltaStore.cart[0].qty,1);const select=d.querySelector('[data-card-size]');if(select.options.length>1){select.value=select.options[1].value;select.dispatchEvent(new w.Event('change',{bubbles:true}));assert.equal(d.querySelector('[data-action="add"]').dataset.size,select.value);}const input=d.querySelector('#ap-catalog-query');input.value='BPC-157';input.dispatchEvent(new w.Event('input',{bubbles:true}));assert.ok(d.querySelector('#ap-catalog-grid').textContent.includes('BPC-157'));const group=d.querySelectorAll('[data-filter-group]')[1];group.click();assert.equal(group.getAttribute('aria-pressed'),'true');input.value='';input.dispatchEvent(new w.Event('input',{bubbles:true}));d.querySelector('[data-filter-group=Supplies]').click();assert.equal(d.querySelectorAll('#ap-catalog-grid .ap-product-card').length,2);d.querySelector('[data-filter-group=Equipment]').click();assert.deepEqual([...d.querySelectorAll('#ap-catalog-grid .ap-product-card')].map(card=>card.dataset.product),['needles']);d.querySelector('[data-filter-group=Supplies]').click();const sort=d.querySelector('#ap-catalog-sort');sort.value='low';sort.dispatchEvent(new w.Event('change',{bubbles:true}));const prices=[...d.querySelectorAll('#ap-catalog-grid .ap-product-card')].map(card=>Math.min(...w.AltaStore.catalog.find(p=>p.id===card.dataset.product).variants.map(v=>v.price)));assert.deepEqual(prices,[...prices].sort((a,b)=>a-b));dom.window.close();}
 {const{dom,d,w}=await setup('/product/retatrutide');assert.equal(d.querySelector('#ap-detail-quantity').value,'1');d.querySelector('[data-action="detail-add"]').click();assert.equal(w.AltaStore.cart[0].qty,1);const options=d.querySelectorAll('[data-action="detail-size"]');options[1].click();assert.ok(d.querySelector('h1').textContent.includes(options[1].dataset.size));dom.window.close();}
 {const{dom,d,w}=await setup('/bulk-orders');
  assert.equal(d.querySelector('.nl-bulk-count'),null);assert.equal(d.querySelector('#ap-bulk-count'),null);
  const benefits=[...d.querySelectorAll('.nl-bulk-benefit')];
  assert.equal(benefits.length,4);
  assert.deepEqual(benefits.map(benefit=>benefit.querySelector('.nl-bulk-benefit-copy').textContent),['unit pricing','product strengths','before payment','Product documentation']);
  assert.equal(d.querySelector('.nl-bulk-benefit-shipping'),null);
  assert.equal(benefits[3].getAttribute('href'),'/coas');
  assert.match(d.querySelector('.nl-bulk-hero p').textContent,/regular catalog unit prices/);
  assert.deepEqual([...d.querySelectorAll('[data-action="bulk-category"]')].map(button=>button.textContent),['All Products','Peptides','Mist Applicators','Supplies','Equipment']);
  const category=d.querySelector('[data-action="bulk-category"][data-group="Supplies"]');category.click();
  assert.equal(category.getAttribute('aria-pressed'),'true');
  const supplies=[...d.querySelectorAll('.nl-bulk-product')];assert.ok(supplies.length>0);
  assert.ok(supplies.every(card=>w.AltaStore.categoryOf(w.AltaStore.catalog.find(p=>p.id===card.dataset.bulkProduct))==='Supplies'));
  d.querySelector('[data-action="bulk-category"][data-group="All"]').click();
  const qty=d.querySelector('#ap-bulk-rows [data-bulk-id]');
  const variant=w.AltaStore.product(qty.dataset.bulkId).variants.find(v=>v.size===qty.dataset.bulkSize);
  const subtotal=()=>d.querySelector('.nl-bulk-estimate-total strong').textContent;
  const money=value=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value);
  assert.equal(d.querySelector('[data-action="bulk-checkout"]').disabled,true);
  qty.value='1';qty.dispatchEvent(new w.Event('input',{bubbles:true}));
  assert.equal(subtotal(),money(variant.price));
  assert.equal(d.querySelector('[data-action="bulk-checkout"]').disabled,false,'one purchased unit can check out');
  qty.value='10';qty.dispatchEvent(new w.Event('input',{bubbles:true}));
  assert.equal(subtotal(),money(variant.price*10),'larger quantities retain the same catalog unit price');
  assert.equal(w.AltaStore.read('ap-bulk-draft-v2',[])[0].qty,10,'the draft contains exactly the selected units');
  assert.equal(d.querySelector('[data-action="bulk-checkout"]').textContent,'Checkout · '+money(variant.price*10));
  assert.equal(w.AltaStore.cart.length,0);
  assertCurrentView(d,'/bulk-orders after quantity changes');
  dom.window.close();
 }
 for(const route of ['/contact','/partner-program','/coas','/rewards','/track-order']){const{dom,d}=await setup(route);assert.ok(d.querySelector('h1'),route);if(route==='/rewards'||route==='/track-order'){assert.ok(d.querySelector('#ap-main a[href="'+(route==='/rewards'?'/account/points':'/account/purchases')+'"]'),route+' points to the signed-in account page');}else assert.ok(d.querySelector('#ap-main').textContent.trim().length>150,route);dom.window.close();}
 console.log('PASS: built reference pages, retired view removal, product size changes, regular quantities/prices, search/category filters and isolated bulk order.');
})().catch(e=>{console.error(e);process.exitCode=1;});
