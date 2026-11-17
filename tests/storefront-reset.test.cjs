'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM,VirtualConsole}=require('jsdom');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const settle=()=>new Promise(resolve=>setTimeout(resolve,0));
const retired=/BOGO|buy\s*1\s*,?\s*get\s*1|additional free|research builder|memberships?|subscribe and save|free BAC|5%.*bank|50%|60%/i;
async function fixture(route,{workspace=false}={}){
 const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
 const dom=new JSDOM(read('storefront-v2.html'),{url:'https://getpurelabs.com'+route,runScripts:'outside-only',virtualConsole:vc}),w=dom.window;
 w.localStorage.setItem('ap-age-verified','true');w.matchMedia=()=>({matches:false});
 w.HTMLElement.prototype.scrollIntoView=()=>{};
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.fetch=async()=>({ok:true,json:async()=>[]});
 const scripts=['products.js','product-images.js','storefront-v2.js'].map(read);
 if(workspace){
  const views=require('../reference-ui-functions.cjs').workspace;
  const source=read('workspace-v2.js'),anchor=' window.AltaWorkspace=';
  assert.ok(source.includes(anchor));
  scripts.push(source.replace(anchor,Object.entries(views).map(([name,fn])=>'\n '+name+' = '+fn.toString()+';\n').join('')+anchor));
 }
 scripts.push(read('reference-ui.js'));
 w.eval(scripts.join('\n'));
 await settle();
 return{w,d:w.document,errors,async close(){await settle();assert.deepEqual(errors,[],route);dom.window.close();}};
}
test('homepage has the exact announcement, two-line hero, single CTA and three trust items',async()=>{
 const f=await fixture('/');
 try{
  const {d}=f,hero=d.querySelector('.nl-hero');
  assert.equal(d.querySelector('.ap-announcement').textContent.trim(),'Enjoy 15% off with code BLACKFRIDAY15 at checkout.');
  assert.equal(d.querySelectorAll('.ap-announcement a,.ap-announcement svg').length,0);
  assert.equal([...hero.querySelector('h1').childNodes].map(n=>n.nodeName==='BR'?'\n':n.textContent).join(''),'CUTTING EDGE\nPURITY');
  assert.equal(hero.querySelector('.nl-hero-description').textContent,'Research compounds, product documentation, and straightforward ordering for laboratories and research teams.');
  assert.deepEqual([...hero.querySelectorAll('.ap-actions a')].map(a=>[a.textContent,a.getAttribute('href')]),[['SHOP NOW','/shop']]);
  assert.deepEqual([...hero.querySelectorAll('.nl-trust>div>span')].map(n=>n.textContent),['99%+ Purity','Free shipping over $150','Lab Tested']);
  assert.equal(hero.querySelectorAll('.nl-trust-check').length,3);
  assert.equal(hero.querySelectorAll('.nl-vial').length,3);
  assert.equal(d.querySelectorAll('#nl-featured .ap-product-card').length,10);
  assert.equal(d.querySelectorAll('a[href*="research-builder"],a[href*="memberships"],a[href="/account/membership"],del,[data-promo-clock],.nl-offer-grid').length,0);
  assert.doesNotMatch(d.body.textContent,retired);
 }finally{await f.close();}
});
test('catalog adds one purchased unit and preserves product category filtering',async()=>{
 const f=await fixture('/shop');
 try{
  const {d,w}=f;
  assert.equal(d.querySelectorAll('.nl-badge,del,.ap-pair-offer').length,0);
  d.querySelector('[data-action="add"]').click();
  assert.equal(w.AltaStore.cart.length,1);assert.equal(w.AltaStore.cart[0].qty,1);
  d.querySelector('[data-action="cart"]').click();
  assert.doesNotMatch(d.querySelector('#ap-cart-content').textContent,retired);
  d.querySelector('[data-filter-group=Supplies]').click();
  const cards=[...d.querySelectorAll('.ap-product-card')];assert.ok(cards.length>0);
  assert.ok(cards.every(c=>w.AltaStore.categoryOf(w.AltaStore.product(c.dataset.product))==='Supplies'));
 }finally{await f.close();}
});
test('product quantities use the regular unit price and add exactly the selected units',async()=>{
 const f=await fixture('/product/retatrutide');
 try{
  const {d,w}=f;
  assert.equal(d.querySelector('#ap-detail-quantity').value,'1');
  assert.equal(d.querySelector('[data-bundle-quantity="1"]').getAttribute('aria-pressed'),'true');
  assert.equal(d.querySelectorAll('.nl-badge,del,.nl-sale-box,[data-promo-active]').length,0);
  const price=w.AltaStore.product('retatrutide').variants[0].price;
  d.querySelector('[data-bundle-quantity="4"]').click();
  assert.equal(d.querySelector('#ap-detail-quantity').value,'4');
  assert.match(d.querySelector('[data-bundle-estimate]').textContent,/for 4 units/);
  d.querySelector('[data-action="detail-add"]').click();
  assert.equal(w.AltaStore.cart[0].qty,4);assert.equal(w.AltaStore.cart[0].price,price);
  assert.doesNotMatch(d.querySelector('.nl-detail').textContent,retired);
 }finally{await f.close();}
});

test('bulk ordering supports regular prices, single units, exact strengths, limits and search without changing the regular cart',async()=>{
 const f=await fixture('/bulk-orders',{workspace:true});
 try{
  const {d,w}=f;
  let card=d.querySelector('[data-bulk-product]');assert.ok(card);
  const id=card.dataset.bulkProduct,p=w.AltaStore.product(id),first=p.variants[0],second=p.variants[1];assert.ok(second);
  const draft=()=>w.AltaStore.read('ap-bulk-draft-v2',[]);
  const format=value=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value);
  const summary=()=>d.querySelector('.nl-bulk-estimate-total strong').textContent;
  card.querySelector('[data-action="bulk-qty"][data-delta="1"]').click();
  assert.equal(draft()[0].qty,1);assert.equal(summary(),format(first.price));
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
  const search=d.querySelector('#ap-bulk-query');search.value='definitely-no-matching-product';search.dispatchEvent(new w.Event('input',{bubbles:true}));
  assert.match(d.querySelector('#ap-bulk-rows').textContent,/No matching products/);assert.equal(draft().length,2);
  search.value='';search.dispatchEvent(new w.Event('input',{bubbles:true}));
  d.querySelector('[data-action="bulk-category"][data-group="Supplies"]').click();
  const cards=[...d.querySelectorAll('[data-bulk-product]')];assert.ok(cards.length>0);
  assert.ok(cards.every(c=>w.AltaStore.categoryOf(w.AltaStore.product(c.dataset.bulkProduct))==='Supplies'));
  assert.equal(w.AltaStore.cart.length,0);
  assert.doesNotMatch(d.querySelector('#ap-main').textContent,/BOGO|membership|research builder|10 units minimum|50%|60%|free 2-day|express delivery/i);
 }finally{await f.close();}
});
