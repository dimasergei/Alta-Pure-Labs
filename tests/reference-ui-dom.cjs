'use strict';
const {JSDOM,VirtualConsole}=require('jsdom'),fs=require('node:fs'),assert=require('node:assert/strict');
const read=p=>fs.readFileSync(p,'utf8');
const retiredCopy=/\bBOGO\b|\b(?:ALTA|PURE)\s+(?:GOLD|PLATINUM)\b|subscribe and save|buy\s*1\s*,?\s*get\s*1/i;
const retiredRoute=/^\/offers(?:[/.?#]|$)/;
function assertCurrentView(d,route){
 for(const a of d.querySelectorAll('a[href]'))assert.doesNotMatch(a.getAttribute('href'),retiredRoute,route+' has no retired destinations');
 for(const area of d.querySelectorAll('header,#ap-main,footer'))assert.doesNotMatch(area.textContent,retiredCopy,route+' has no retired brand or BOGO offer copy');
 assert.equal(d.querySelectorAll('#ap-main del,#ap-main [data-promo-clock],#ap-main .nl-offer-grid').length,0,route+' has no old sale presentation');
}
async function setup(route){const errors=[];const console=new VirtualConsole();console.on('jsdomError',e=>errors.push(e.message));const dom=new JSDOM(read('public-build/index.html'),{url:'https://getpurelabs.com'+route,runScripts:'outside-only',virtualConsole:console}),w=dom.window;w.localStorage.setItem('ap-age-verified','true');w.matchMedia=()=>({matches:false});w.HTMLElement.prototype.scrollIntoView=()=>{};w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};w.fetch=async()=>({ok:true,json:async()=>[]});w.AltaConversionConfig=require('../config/conversion.json');w.eval(read('public-build/membership-experience.js')+'\n'+read('public-build/conversion-ui.js')+'\n'+read('public-build/products.js')+'\n'+read('public-build/product-images.js')+'\n'+read('public-build/storefront-v2.js')+'\n'+read('public-build/workspace-v2.js'));await new Promise(r=>setTimeout(r,0));assert.deepEqual(errors,[],route);assertCurrentView(w.document,route);return{dom,w,d:w.document};}
(async()=>{
 {const{dom,d,w}=await setup('/');
  assert.match(d.querySelector('h1').textContent,/CUTTING EDGEPURITY/);
  const vials=[...d.querySelectorAll('.nl-hero .nl-vial')];
  assert.deepEqual(vials.map(a=>a.getAttribute('href')),['/product/nad','/product/retatrutide','/product/bpc-157','/product/ghk-cu','/product/tirzepatide']);
  assert.equal(vials[2].querySelector('img').getAttribute('fetchpriority'),'high');
  const featured=[...d.querySelectorAll('#nl-featured .ap-product-card')];
  assert.equal(featured.length,10);
  for(const card of featured){
   const p=w.AltaStore.product(card.dataset.product),photo=card.querySelector('.ap-product-image');
   assert.equal(card.querySelector('.nl-featured-meta h3').textContent,p.name);
   assert.match(card.querySelector('.nl-featured-price').textContent,/^\$[\d,]+$/);
   assert.equal(new URL(photo.href).pathname,'/product/'+p.id);
   assert.equal(card.querySelector('button,select,.nl-card-actions,.nl-size-label'),null);
   assert.equal(photo.contains(card.querySelector('.nl-featured-meta')),false,'name and price are outside the image');
   assert.doesNotMatch(card.textContent,/per unit|View More|Add to Cart|\(\d+\s*mg\)/i);
  }
  const bulk=d.querySelector('.nl-home-bulk');
  const memberships=d.querySelector('[data-mx-membership-home]');assert.ok(d.querySelector('.nl-editorial').nextElementSibling===memberships,'membership comparison follows documentation');assert.equal(memberships.querySelectorAll('.mx-card').length,3);assert.ok(memberships.nextElementSibling===bulk,'bulk ordering follows membership comparison');
  assert.equal(bulk.nextElementSibling.id,'faq');
  assert.equal(bulk.querySelector('a').getAttribute('href'),'/bulk-orders');
  assert.match(bulk.textContent,/regular unit prices/);
  assert.doesNotMatch(bulk.textContent,/discount|\d+%|builder/i);
  const examples=[...bulk.querySelectorAll('tbody tr')];
  assert.equal(examples.length,2);
  for(const [index,id,size,qty] of [[0,'bpc-157','10mg',10],[1,'ghk-cu','50mg',50]]){
   const variant=w.AltaStore.product(id).variants.find(v=>v.size===size),cells=examples[index].cells;
   assert.equal(cells[1].textContent,String(qty));
   assert.equal(cells[2].textContent,w.AltaStore.money(variant.price));
  }
  dom.window.close();
 }
 {const{dom,d,w}=await setup('/shop');
  assert.equal(d.querySelector('h1').textContent,'ALL PRODUCTS.');
  assert.match(d.querySelector('.nl-shop-header p').textContent,/choose the precise strength/);
  assert.equal(d.querySelector('.nl-shop-sale'),null);assert.equal(d.querySelector('#ap-result-count'),null);
  assert.deepEqual([...d.querySelectorAll('.nl-filter-pills button')].map(x=>x.textContent),['All Products','Peptides','Mist Applicators','Supplies','Equipment']);
  const cards=[...d.querySelectorAll('#ap-catalog-grid .ap-product-card')];assert.equal(cards.length,20);
  for(const card of cards){
   const p=w.AltaStore.product(card.dataset.product),photo=card.querySelector('a.ap-product-image'),url=new URL(photo.href);
   const variant=p.variants.find(v=>v.size===url.searchParams.get('size'));
   assert.ok(variant,'catalog photo links to an available strength');
   assert.equal(url.pathname,'/product/'+p.id);
   assert.equal(card.querySelector('.nl-featured-meta h3').textContent,p.name);
   assert.equal(card.querySelector('.nl-featured-meta h3 a').href,photo.href);
   assert.equal(card.querySelector('.nl-featured-price').textContent,new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:0,maximumFractionDigits:0}).format(variant.price));
   assert.equal(card.querySelector('select,button,.nl-card-actions,.nl-size-label,.ap-card-body'),null);
   assert.doesNotMatch(card.textContent,/per unit|View More|Add to Cart|\(\d+\s*mg\)/i);
  }
  const input=d.querySelector('#ap-catalog-query'),sort=d.querySelector('#ap-catalog-sort');
  assert.ok(input.closest('.nl-shop-controls')===sort.closest('.nl-shop-controls'));
  assert.equal(d.querySelector('label[for="ap-catalog-sort"]').textContent,'Sort by:');
  d.querySelector('#ap-load-more').click();assert.ok(d.querySelectorAll('#ap-catalog-grid .ap-product-card').length>cards.length);
  input.value='BPC-157';input.dispatchEvent(new w.Event('input',{bubbles:true}));
  assert.ok(d.querySelector('#ap-catalog-grid').textContent.includes('BPC-157'));
  const group=d.querySelectorAll('[data-filter-group]')[1];group.click();assert.equal(group.getAttribute('aria-pressed'),'true');
  input.value='';input.dispatchEvent(new w.Event('input',{bubbles:true}));
  d.querySelector('[data-filter-group=Supplies]').click();assert.equal(d.querySelectorAll('#ap-catalog-grid .ap-product-card').length,2);
  d.querySelector('[data-filter-group=Equipment]').click();assert.deepEqual([...d.querySelectorAll('#ap-catalog-grid .ap-product-card')].map(card=>card.dataset.product),['needles']);
  d.querySelector('[data-filter-group=Supplies]').click();sort.value='low';sort.dispatchEvent(new w.Event('change',{bubbles:true}));
  const prices=[...d.querySelectorAll('#ap-catalog-grid .ap-product-card')].map(card=>Math.min(...w.AltaStore.catalog.find(p=>p.id===card.dataset.product).variants.map(v=>v.price)));
  assert.deepEqual(prices,[...prices].sort((a,b)=>a-b));
  assert.equal(w.AltaStore.cart.length,0,'browsing catalog cards does not alter the cart');
  dom.window.close();
 }
 {const{dom,d,w}=await setup('/product/retatrutide');assert.equal(d.querySelector('#ap-detail-quantity').value,'1');d.querySelector('[data-action="detail-add"]').click();assert.equal(w.AltaStore.cart[0].qty,1);const options=d.querySelectorAll('[data-action="detail-size"]');options[1].click();assert.ok(d.querySelector('h1').textContent.includes(options[1].dataset.size));dom.window.close();}
 {const{dom,d,w}=await setup('/bulk-orders');
  assert.equal(d.querySelector('.nl-bulk-count'),null);assert.equal(d.querySelector('#ap-bulk-count'),null);
  const benefits=[...d.querySelectorAll('.nl-bulk-benefit')];
  assert.equal(benefits.length,4);
  assert.deepEqual(benefits.map(benefit=>benefit.querySelector('.nl-bulk-benefit-copy').textContent),['Clear pricing','Exact strengths','Review before payment','Product documentation']);
  assert.equal(d.querySelector('.nl-bulk-benefit-shipping'),null);
  assert.equal(benefits[3].getAttribute('href'),'/coas');
  assert.match(d.querySelector('.nl-bulk-hero p').textContent,/Volume savings apply automatically/);
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
  assert.equal(d.querySelector('[data-action="bulk-checkout"]').textContent,'Checkout · '+money(variant.price*10*0.8));
  assert.equal(w.AltaStore.cart.length,0);
  assertCurrentView(d,'/bulk-orders after quantity changes');
  dom.window.close();
 }
 for(const route of ['/contact','/partner-program','/coas','/rewards','/track-order']){const{dom,d}=await setup(route);assert.ok(d.querySelector('h1'),route);if(route==='/rewards'||route==='/track-order'){assert.ok(d.querySelector('#ap-main a[href="'+(route==='/rewards'?'/account#rewards-and-credit':'/account/purchases')+'"]'),route+' points to the signed-in account page');}else assert.ok(d.querySelector('#ap-main').textContent.trim().length>150,route);dom.window.close();}
 console.log('PASS: built reference pages, retired view removal, product size changes, regular quantities/prices, search/category filters and isolated bulk order.');
})().catch(e=>{console.error(e);process.exitCode=1;});
