'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM,VirtualConsole}=require('jsdom');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const settle=()=>new Promise(resolve=>setTimeout(resolve,0));
const retired=/BOGO|buy\s*1\s*,?\s*get\s*1|additional free|subscribe and save|5%.*bank|50%|60%/i;
function referenceSource(file,scope,anchor){
 const source=read(file),views=require('../reference-ui-functions.cjs')[scope];
 assert.ok(source.includes(anchor),file+' exposes the reference view insertion point');
 return source.replace(anchor,Object.entries(views).map(([name,fn])=>'\n '+name+' = '+fn.toString()+';\n').join('')+anchor);
}
async function fixture(route,{workspace=false,cart=[]}={}){
 const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
 const dom=new JSDOM(read('storefront-v2.html'),{url:'https://getpurelabs.com'+route,runScripts:'outside-only',virtualConsole:vc}),w=dom.window;
 w.localStorage.setItem('ap-age-verified','true');w.matchMedia=()=>({matches:false});
 if(cart.length)w.localStorage.setItem('pp-cart',JSON.stringify(cart));
 w.HTMLElement.prototype.scrollIntoView=()=>{};
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.fetch=async url=>({ok:true,json:async()=>String(url).includes('/data/supplier-coas.json')?require('../data/supplier-coas.json'):[]});
 const scripts=['products.js','product-images.js','quantity-pricing.js'].map(read);
 // The production build replaces these views inside the storefront closure.
 scripts.push(referenceSource('storefront-v2.js','store',' window.AltaStore='));
 if(workspace)scripts.push(read('supplier-coas.js'),referenceSource('workspace-v2.js','workspace',' window.AltaWorkspace='));
 scripts.push(read('reference-ui.js'));
 w.eval(scripts.join('\n'));
 await settle();
 return{w,d:w.document,errors,async close(){await settle();assert.deepEqual(errors,[],route);dom.window.close();}};
}
test('homepage keeps the announcement, five-vial hero and product links without purchase controls',async()=>{
 const f=await fixture('/');
 try{
  const {d,w}=f,hero=d.querySelector('.nl-hero');
  assert.equal(d.querySelector('.ap-announcement').textContent.trim(),'Enjoy 15% off with code BLACKFRIDAY15 at checkout.');
  assert.equal(d.querySelectorAll('.ap-announcement a,.ap-announcement svg').length,0);
  assert.equal([...hero.querySelector('h1').childNodes].map(n=>n.nodeName==='BR'?'\n':n.textContent).join(''),'CUTTING EDGE\nPURITY');
  assert.equal(hero.querySelector('.nl-hero-description').textContent,'Research compounds, product documentation, and straightforward ordering for laboratories and research teams.');
  assert.deepEqual([...hero.querySelectorAll('.ap-actions a')].map(a=>[a.textContent,a.getAttribute('href')]),[['SHOP NOW','/shop']]);
  assert.deepEqual([...hero.querySelectorAll('.nl-trust>div>span')].map(n=>n.textContent),['99%+ Purity','Free US shipping over US$150','Lab Tested']);
  assert.equal(hero.querySelectorAll('.nl-trust-check').length,3);
  assert.equal(hero.querySelectorAll('.nl-vial').length,5);
  const featured=[...d.querySelectorAll('#nl-featured .ap-product-card')];
  assert.equal(featured.length,10);
  for(const card of featured){
   const p=w.AltaStore.product(card.dataset.product);assert.ok(p);
   assert.equal(card.querySelectorAll('select,button,input,[data-action]').length,0,'featured cards navigate to a product before choosing a strength or purchasing');
   const photo=card.querySelector('a.ap-product-image');assert.ok(photo?.querySelector('img'));
   const target=new URL(photo.getAttribute('href'),w.location.href);
   assert.equal(target.pathname,'/product/'+p.id);
   assert.ok(p.variants.some(v=>v.size===target.searchParams.get('size')),'photo links retain a valid catalog strength');
   assert.equal(card.querySelector('h3 a').getAttribute('href'),photo.getAttribute('href'));
   assert.equal(card.querySelector('h3 a').textContent,p.name);
  }
  assert.equal(w.AltaStore.cart.length,0);
  assert.equal(d.querySelectorAll('del,[data-promo-clock],.nl-offer-grid').length,0);
  assert.ok(d.querySelector('[data-mx-membership-home]'),'the homepage includes the shared membership component mount');
  assert.doesNotMatch(d.body.textContent,retired);
 }finally{await f.close();}
});
test('catalog photo cards preserve product navigation, integer prices, search, filters, sorting and pagination',async()=>{
 const f=await fixture('/shop');
 try{
  const {d,w}=f;
  const catalog=Array.from(w.AltaStore.catalog),cards=()=>[...d.querySelectorAll('#ap-catalog-grid .ap-product-card')];
  const ids=()=>cards().map(card=>card.dataset.product);
  const search=value=>{const input=d.querySelector('#ap-catalog-query');input.value=value;input.dispatchEvent(new w.Event('input',{bubbles:true}));};
  const sort=value=>{const select=d.querySelector('#ap-catalog-sort');select.value=value;select.dispatchEvent(new w.Event('change',{bubbles:true}));};
  const assertPhotoCards=()=>{
   for(const card of cards()){
    const p=w.AltaStore.product(card.dataset.product),photo=card.querySelector('a.ap-product-image'),name=card.querySelector('h3 a');
    assert.ok(p&&photo?.querySelector('img')&&name,'each product has a linked photo and name');
    const target=new URL(photo.getAttribute('href'),w.location.href),variant=p.variants.find(v=>v.size===target.searchParams.get('size'));
    assert.equal(target.pathname,'/product/'+p.id);assert.ok(variant,'photo links select a valid catalog strength');
    assert.equal(photo.querySelector('img').getAttribute('src'),w.AltaStore.image(p,variant.size),'photo matches the linked strength');
    assert.equal(name.getAttribute('href'),photo.getAttribute('href'));assert.equal(name.textContent,p.name);
    const price=card.querySelector('.nl-featured-price');assert.ok(price);
    assert.equal(price.textContent,'$'+Math.round(variant.price).toLocaleString('en-US'));
    assert.match(price.textContent,/^\$[\d,]+$/,'catalog prices have no decimal suffix');
    assert.equal(photo.contains(name),false,'name remains separate from the product photo');
    assert.equal(photo.contains(price),false,'price remains separate from the product photo');
    assert.equal(card.querySelectorAll('select,button,input,[data-action]').length,0,'purchasing and strength selection happen on the product page');
    assert.doesNotMatch(card.textContent,/per unit|View More|Add to Cart/i);
   }
  };
  assert.equal(d.querySelectorAll('.nl-badge,del,.ap-pair-offer').length,0);
  const firstPage=ids();assert.ok(firstPage.length>0&&firstPage.length<catalog.length);
  assertPhotoCards();
  assert.equal(d.querySelector('#ap-load-more').hidden,false);
  d.querySelector('#ap-load-more').click();
  assert.ok(cards().length>firstPage.length,'loading more reveals additional products');
  assert.deepEqual(ids().slice(0,firstPage.length),firstPage,'pagination keeps the existing order');
  for(let pages=0;pages<catalog.length&&!d.querySelector('#ap-load-more').hidden;pages++)d.querySelector('#ap-load-more').click();
  assert.equal(d.querySelector('#ap-load-more').hidden,true);
  assert.deepEqual(ids(),catalog.map(p=>p.id),'every product is reachable once through pagination');
  assert.equal(new Set(ids()).size,catalog.length);assertPhotoCards();
  for(const direction of ['low','high']){
   sort(direction);
   const prices=cards().map(card=>Math.min(...w.AltaStore.product(card.dataset.product).variants.map(v=>v.price)));
   assert.deepEqual(prices,[...prices].sort((a,b)=>direction==='low'?a-b:b-a),direction+' price sorting updates the rendered cards');
  }
  sort('name');
  const names=cards().map(card=>card.querySelector('h3 a').textContent);
  assert.deepEqual(names,[...names].sort((a,b)=>a.localeCompare(b)));
  sort('popular');assert.deepEqual(ids(),catalog.map(p=>p.id));
  search('bPc-157');assert.deepEqual(ids(),['bpc-157'],'search is case insensitive');
  assert.equal(d.querySelector('#ap-load-more').hidden,true);assertPhotoCards();
  search('');
  d.querySelector('[data-filter-group=Supplies]').click();
  assert.deepEqual(ids(),catalog.filter(p=>w.AltaStore.categoryOf(p)==='Supplies').map(p=>p.id));
  assert.equal(d.querySelector('[data-filter-group=Supplies]').getAttribute('aria-pressed'),'true');
  search('BAC');assert.equal(cards().length,2,'search combines with the selected category');assertPhotoCards();
  search('retatrutide');assert.equal(cards().length,0,'search does not escape the selected category');
  assert.match(d.querySelector('#ap-catalog-grid').textContent,/No matching compounds/);
  d.querySelector('[data-action="clear-filters"]').click();
  assert.equal(d.querySelector('#ap-catalog-query').value,'');
  assert.equal(d.querySelector('[data-filter-group=All]').getAttribute('aria-pressed'),'true');
  assert.deepEqual(ids(),firstPage,'clearing filters restores the first catalog page');
  d.querySelector('[data-filter-group=Equipment]').click();assert.deepEqual(ids(),['needles']);assertPhotoCards();
  assert.equal(w.AltaStore.cart.length,0,'browsing the catalog never changes the cart');
  assert.doesNotMatch(d.querySelector('.nl-shop').textContent,retired);
 }finally{await f.close();}
});
test('product quantity value tiers preserve the selected number of units and base SKU price',async()=>{
 const f=await fixture('/product/retatrutide');
 try{
  const {d,w}=f;
  assert.equal(d.querySelector('#ap-detail-quantity').value,'1');
  assert.equal(d.querySelector('[data-bundle-quantity="1"]').getAttribute('aria-pressed'),'true');
  assert.equal(d.querySelectorAll('.nl-badge,del,.nl-sale-box,[data-promo-active]').length,0);
  const price=w.AltaStore.product('retatrutide').variants[0].price;
  d.querySelector('[data-bundle-quantity="10"]').click();
  assert.equal(d.querySelector('#ap-detail-quantity').value,'10');
  assert.match(d.querySelector('[data-bundle-estimate]').textContent,/for 10 vials/);
   assert.match(d.querySelector('[data-bundle-estimate]').textContent,/SAVE 20%/);
   assert.equal(d.querySelectorAll('[data-bundle-quantity]').length,4);
  d.querySelector('[data-action="detail-add"]').click();
  assert.equal(w.AltaStore.cart[0].qty,10);assert.equal(w.AltaStore.cart[0].price,price);
  assert.doesNotMatch(d.querySelector('.nl-detail').textContent,retired);
 }finally{await f.close();}
});

test('bulk ordering grows and clears its summary while preserving exact prices, strengths and the regular cart',async()=>{
 const f=await fixture('/bulk-orders',{workspace:true,cart:[{id:'retatrutide',size:'10mg',qty:2}]});
 try{
  const {d,w}=f;
  const draft=()=>w.AltaStore.read('ap-bulk-draft-v2',[]);
  const regularCart=JSON.stringify(w.AltaStore.cart),storedCart=w.localStorage.getItem('pp-cart');
  const summaryNode=()=>d.querySelector('#ap-bulk-summary');
  const format=value=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value);
  const summary=()=>d.querySelector('.nl-bulk-estimate-total strong').textContent;
  const search=d.querySelector('#ap-bulk-query');let scrollRequests=0;
  search.scrollIntoView=()=>{scrollRequests++;};
  assert.equal(summaryNode().dataset.empty,'true');assert.equal(draft().length,0);
  const addProducts=summaryNode().querySelector('[data-action="bulk-add-products"]');
  assert.equal(addProducts?.textContent,'ADD PRODUCTS');
  assert.equal(d.querySelector('[data-action="bulk-checkout"]').disabled,true);
  search.value='BPC';search.dispatchEvent(new w.Event('input',{bubbles:true}));
  d.querySelector('[data-action="bulk-category"][data-group="Peptides"]').click();
  summaryNode().querySelector('[data-action="bulk-add-products"]').click();
  assert.equal(d.activeElement,search);assert.equal(scrollRequests,1,'Add Products scrolls to the product search');
  assert.equal(search.value,'BPC','Add Products preserves the current search');
  assert.equal(d.querySelector('[data-action="bulk-category"][data-group="Peptides"]').getAttribute('aria-pressed'),'true');
  assert.equal(draft().length,0,'Add Products does not add an item');
  search.value='';search.dispatchEvent(new w.Event('input',{bubbles:true}));
  d.querySelector('[data-action="bulk-category"][data-group="All"]').click();
  let card=d.querySelector('[data-bulk-product]');assert.ok(card);
  const id=card.dataset.bulkProduct,p=w.AltaStore.product(id),first=p.variants[0],second=p.variants[1];assert.ok(second);
  card.querySelector('[data-action="bulk-qty"][data-delta="1"]').click();
  assert.equal(draft()[0].qty,1);assert.equal(summary(),format(first.price));
  assert.equal(summaryNode().dataset.empty,'false');assert.equal(summaryNode().querySelectorAll('.nl-bulk-menu-line').length,1);
  assert.equal(d.querySelector('[data-action="bulk-checkout"]').disabled,false,'one unit can check out');
  card.querySelector('[data-action="bulk-qty"][data-delta="10"]').click();
  assert.equal(draft()[0].qty,11);assert.equal(summary(),format(first.price*11));
  let input=card.querySelector('[data-bulk-id]');input.value='100';input.dispatchEvent(new w.Event('input',{bubbles:true}));
  assert.equal(draft()[0].qty,100);assert.equal(summary(),format(first.price*100));
  assert.equal(card.querySelector('[data-delta="1"]').disabled,true);
  card.querySelector('[data-action="bulk-size"][data-size="'+second.size+'"]').click();
  card=d.querySelector('[data-bulk-product="'+id+'"]');
  assert.equal(card.querySelector('[data-bulk-id]').value,'0');
  assert.equal(card.querySelector('[data-bulk-unit]').textContent,format(second.price));
  card.querySelector('[data-delta="1"]').click();
  assert.equal(draft().length,2);assert.equal(summary(),format(first.price*100+second.price));
  input=card.querySelector('[data-bulk-id]');input.value='101';input.dispatchEvent(new w.Event('input',{bubbles:true}));
  assert.equal(input.checkValidity(),false);assert.equal(draft().find(x=>x.size===second.size).qty,1);
  input.value='1';input.dispatchEvent(new w.Event('input',{bubbles:true}));
  const otherCard=[...d.querySelectorAll('[data-bulk-product]')].find(node=>node.dataset.bulkProduct!==id),other=w.AltaStore.product(otherCard.dataset.bulkProduct),otherVariant=other.variants[0];
  otherCard.querySelector('[data-action="bulk-qty"][data-delta="1"]').click();
  assert.equal(draft().length,3);assert.equal(summaryNode().querySelectorAll('.nl-bulk-menu-product').length,2);
  assert.equal(summaryNode().querySelectorAll('.nl-bulk-menu-line').length,3);
  assert.equal(summary(),format(first.price*100+second.price+otherVariant.price));
  search.value='definitely-no-matching-product';search.dispatchEvent(new w.Event('input',{bubbles:true}));
  assert.match(d.querySelector('#ap-bulk-rows').textContent,/No matching products/);assert.equal(draft().length,3);
  search.value='';search.dispatchEvent(new w.Event('input',{bubbles:true}));
  d.querySelector('[data-action="bulk-category"][data-group="Supplies"]').click();
  const cards=[...d.querySelectorAll('[data-bulk-product]')];assert.ok(cards.length>0);
  assert.ok(cards.every(c=>w.AltaStore.categoryOf(w.AltaStore.product(c.dataset.bulkProduct))==='Supplies'));
  const remove=(productId,size)=>{
   const button=[...summaryNode().querySelectorAll('.nl-bulk-menu-remove')].find(node=>node.dataset.id===productId&&node.dataset.size===size);
   assert.ok(button,'selected strength has a remove control');button.click();
  };
  remove(other.id,otherVariant.size);
  assert.equal(summaryNode().querySelectorAll('.nl-bulk-menu-product').length,1);
  assert.equal(draft().length,2);assert.equal(summary(),format(first.price*100+second.price));
  remove(id,second.size);
  assert.equal(summaryNode().dataset.empty,'false');assert.equal(draft().length,1);assert.equal(summary(),format(first.price*100));
  remove(id,first.size);
  assert.equal(summaryNode().dataset.empty,'true');assert.equal(draft().length,0);assert.equal(summary(),format(0));
  assert.equal(summaryNode().querySelectorAll('.nl-bulk-menu-product,.nl-bulk-menu-line').length,0);
  assert.equal(summaryNode().querySelector('[data-action="bulk-add-products"]').textContent,'ADD PRODUCTS');
  assert.equal(d.querySelector('[data-action="bulk-checkout"]').disabled,true);
  assert.equal(JSON.stringify(w.AltaStore.cart),regularCart,'bulk selections never replace the existing regular cart');
  assert.equal(w.localStorage.getItem('pp-cart'),storedCart,'the saved regular cart remains intact');
  assert.doesNotMatch(d.querySelector('#ap-main').textContent,/BOGO|membership|research builder|auto-stack|10 units minimum|50%|60%|free 2-day|express delivery/i);
 }finally{await f.close();}
});

test('COA page filters original reports by product, strength, laboratory and cross-field search',async()=>{
 const f=await fixture('/coas?product=bpc-157&size=10mg',{workspace:true});
 try{
  const {d,w}=f,query=d.querySelector('#ap-coa-query'),cards=()=>[...d.querySelectorAll('.ap-coa-card')];
  const change=async(id,value,event='change')=>{const input=d.querySelector(id);input.value=value;input.dispatchEvent(new w.Event(event,{bubbles:true}));await settle();};
  assert.equal(d.querySelector('#ap-coa-product').value,'bpc-157');
  assert.equal(d.querySelector('#ap-coa-size').value,'10mg');
  assert.equal(cards().length,3);
  assert.ok(cards().every(card=>card.querySelector('h2').textContent==='BPC-157 · 10mg'));
  await change('#ap-coa-lab','Janoshik Analytical');
  assert.equal(cards().length,1);assert.match(cards()[0].textContent,/#149043/);
  await change('#ap-coa-query','BPC157 10 mg Janoshik','input');
  assert.equal(cards().length,1);assert.match(d.querySelector('#ap-coa-count').textContent,/1 COA report found/);
  await change('#ap-coa-query','unmatched-report-identifier','input');
  assert.equal(cards().length,0);assert.match(d.querySelector('#ap-supplier-references').textContent,/No COA report matches/);
  d.querySelector('#ap-coa-reset').click();await settle();
  assert.equal(query.value,'');assert.equal(d.activeElement,query);
  assert.equal(d.querySelector('#ap-coa-product').value,'');assert.equal(d.querySelector('#ap-coa-size').value,'');assert.equal(d.querySelector('#ap-coa-lab').value,'');
  assert.equal(cards().length,require('../data/supplier-coas.json').reports.length);
  await change('#ap-coa-query','149043','input');
  assert.equal(cards().length,1);assert.match(cards()[0].textContent,/Janoshik Analytical/);
  assert.equal(d.querySelector('#ap-supplier-references').getAttribute('aria-busy'),'false');
  assert.match(d.querySelector('#ap-supplier-references').textContent,/request the exact fulfilled-lot COA/);
 }finally{await f.close();}
});
