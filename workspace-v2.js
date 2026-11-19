/* Regular-price bulk ordering, documentation, and account workspaces. */
(() => {
 'use strict';
 const A=window.AltaStore;if(!A)return;
 let contactPage,partnerPage;
 const {$,$$,esc,t,money,product,image,heading}=A;
 const priceMarkup=(value,options={})=>A.priceMarkup?A.priceMarkup(value,options):esc(money(value));
 const bulkKey='ap-bulk-draft-v2';
 let bulk=A.normalizeLines(A.read(bulkKey,[])).filter(x=>!/\bneedles?\b/i.test(product(x.id)?.name||''));
 let bulkQuery='',bulkGroup='All',initialized=false;
 const bulkSizeKey='ap-bulk-size-selections-v2';let bulkSizes=A.read(bulkSizeKey,{});if(!bulkSizes||typeof bulkSizes!=='object'||Array.isArray(bulkSizes))bulkSizes={};
 let authPromise;
 function supplierReferences(){
  const root=$('#ap-supplier-references');if(!root)return;
  if(window.AltaSupplierCoas)return window.AltaSupplierCoas.render(root,A.catalog);
  root.textContent='COA report viewer is unavailable. Please reload the page.';
 }
 function coaPage(){
  const params=new URLSearchParams(location.search),selectedProduct=product(params.get('product'))?.id||'',selectedSize=params.get('size')||'';
  return `<div class="pure-coa-page"><section class="ap-coa-hero"><div class="ap-container ap-coa-hero-inner"><div class="pure-coa-hero-copy"><span class="ap-eyebrow">PURE / CERTIFICATES OF ANALYSIS</span><h1>Find your product documentation.</h1><p>Search original reports by compound, strength, laboratory, lot or report ID.</p></div><div class="pure-coa-hero-art" aria-hidden="true"><svg viewBox="0 0 32 32" focusable="false"><g fill="currentColor" transform="matrix(1 0 -0.3333333333 1 10.6666666667 7)"><rect x="0" y="4" width="4" height="10"/><rect x="6" y="0" width="4" height="18"/><rect x="12" y="2" width="4" height="14"/></g></svg><span class="pure-wordmark">PURE</span></div></div></section><section class="ap-container ap-coa-library" id="coa-library" aria-label="Search certificates of analysis"><div class="ap-coa-search-panel"><label class="ap-coa-search-label" for="ap-coa-query">Search COAs</label><div class="ap-coa-search-field"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg><input class="ap-input" id="ap-coa-query" type="search" maxlength="120" value="${esc(params.get('q')||'')}" placeholder="Product, strength, laboratory, lot or report ID" autocomplete="off" aria-controls="ap-supplier-references"></div><div class="ap-coa-controls"><label for="ap-coa-product">Product<select class="ap-input" id="ap-coa-product" aria-controls="ap-supplier-references"><option value="">All products</option>${[...A.catalog].sort((a,b)=>a.name.localeCompare(b.name)).map(p=>`<option value="${esc(p.id)}" ${p.id===selectedProduct?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label><label for="ap-coa-size">Strength<select class="ap-input" id="ap-coa-size" data-initial-size="${esc(selectedSize)}" aria-controls="ap-supplier-references"><option value="">All strengths</option></select></label><label for="ap-coa-lab">Laboratory<select class="ap-input" id="ap-coa-lab" aria-controls="ap-supplier-references"><option value="">All laboratories</option></select></label><button id="ap-coa-reset" class="ap-button ap-button-secondary" type="button">Clear filters</button></div></div><div class="ap-coa-results-heading"><p id="ap-coa-count" role="status" aria-live="polite" aria-atomic="true">Loading COA reports…</p><a class="ap-text-link" href="/contact">Request a lot-specific COA ↗</a></div><div id="ap-supplier-references" aria-busy="true"></div></section></div>`;
 }
 const simpleLines=lines=>lines.map(({id,size,qty})=>({id,size,qty}));
 const total=lines=>lines.reduce((n,x)=>n+x.qty*x.price,0);
 function empty(title,body,href,label){return `<div class="ap-empty"><h3>${esc(title)}</h3><p>${esc(body)}</p>${href?`<a class="ap-button ap-button-secondary" href="${href}">${esc(label)} ↗</a>`:''}</div>`;}
 async function authClient(){if(!authPromise)authPromise=(async()=>{if(!window.supabase?.createClient)throw Error('Account service unavailable.');const response=await fetch('/api/customer-config',{cache:'no-store'});if(!response.ok)throw Error('Account service unavailable.');const config=await response.json();return window.supabase.createClient(config.supabaseUrl,config.anonKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,flowType:'pkce'}});})();return authPromise;}
 function inquiryForm(type){return '<form class="ap-inquiry-form" data-inquiry-type="'+esc(type)+'"><div class="ap-form-grid"><label>Name<input name="name" autocomplete="name" required maxlength="120"></label><label>Email<input name="email" type="email" autocomplete="email" required maxlength="254"></label><label>Organization<input name="organization" autocomplete="organization" maxlength="160"></label><label>Country<input name="country" autocomplete="country-name" maxlength="100"></label><label class="ap-form-wide">Topic<input name="topic" value="'+(type==='bulk'?'Bulk order quote':'General inquiry')+'" maxlength="160"></label><label class="ap-form-wide">Message<textarea name="message" required maxlength="5000" rows="5"></textarea></label><label class="ap-honeypot" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label><label class="ap-form-consent"><input type="checkbox" name="consent" required> PURE may use these details to respond to my inquiry.</label></div><button class="ap-button" type="submit">Send inquiry →</button><p class="ap-form-status" role="status" aria-live="polite"></p></form>';}
 function bulkPage(){return heading('Bulk orders','Build a bigger order.<br>Keep the details simple.','Choose quantities across exact product sizes. Review a catalog-price estimate, export your list, or send a bulk quote request to the team.')+`<div class="ap-container ap-workspace-layout"><div><div class="ap-toolbar"><label class="ap-sr" for="ap-bulk-query">Search products or sizes</label><input id="ap-bulk-query" type="search" maxlength="120" value="${esc(bulkQuery)}" placeholder="Search products, sizes, or categories"></div><p class="ap-result-count">${A.catalog.reduce((n,p)=>n+p.variants.length,0)} exact product/size combinations · quantities stay saved on this device</p><div class="ap-bulk-table-wrap"><table class="ap-bulk-table"><thead><tr><th>Compound</th><th>Size</th><th>Unit price</th><th>Qty</th><th>Line total</th></tr></thead><tbody id="ap-bulk-rows"></tbody></table></div><section id="ap-bulk-inquiry" class="ap-panel" hidden style="margin-top:25px"><span class="ap-eyebrow">SEND YOUR SELECTIONS</span><h2>Request a bulk quote.</h2><p class="ap-fine">The selected products and quantities will be sent with your inquiry. Submission does not place an order.</p>${inquiryForm('bulk')}</section></div><aside class="ap-summary"><span class="ap-eyebrow">YOUR BULK REQUEST</span><h2>Every size.<br>Every quantity.</h2><div id="ap-bulk-summary"></div></aside></div>`;}
 function bulkUnits(id){return bulk.filter(x=>x.id===id).reduce((n,x)=>n+x.qty,0);}
 function bulkUpdateCard(id,size){
  const card=$$('[data-bulk-product]').find(x=>x.dataset.bulkProduct===id);if(!card)return;
  const p=product(id),v=p?.variants.find(x=>x.size===size),qty=bulk.find(x=>x.id===id&&x.size===size)?.qty||0;
  const unit=card.querySelector('[data-bulk-unit]');if(unit&&v)unit.innerHTML=priceMarkup(v.price);
  card.dataset.selected=String(qty>0);
  card.querySelectorAll('[data-bulk-id][data-bulk-size]').forEach(input=>{if(input.dataset.bulkSize===size)input.value=qty;});
  card.querySelectorAll('[data-action="bulk-qty"][data-size]').forEach(button=>{if(button.dataset.size===size)button.disabled=Number(button.dataset.delta)<0?qty<=0:qty>=100;});
 }
 function setBulkQuantity(id,size,value){const p=product(id),v=p?.variants.find(x=>x.size===size),qty=Math.max(0,Math.min(100,Math.trunc(Number(value)||0)));if(!p||!v)return;bulk=bulk.filter(x=>!(x.id===id&&x.size===size));if(qty)bulk=A.normalizeLines([...bulk,{id,size,qty}]);A.write(bulkKey,simpleLines(bulk));bulkUpdateCard(id,size);bulkSummary();}
 function bulkResults(){
  const root=$('#ap-bulk-rows');if(!root)return;
  const list=A.catalog.filter(p=>!/\bneedles?\b/i.test(p.name)&&(bulkGroup==='All'||A.categoryOf(p)===bulkGroup)&&(p.name+' '+p.group+' '+A.categoryOf(p)).toLowerCase().includes(bulkQuery.toLowerCase()));
  root.innerHTML=list.map(p=>{
   const existing=bulk.filter(x=>x.id===p.id),saved=bulkSizes[p.id],size=(p.variants.some(x=>x.size===saved)?saved:existing[0]?.size)||p.variants[0].size,v=p.variants.find(x=>x.size===size)||p.variants[0],qty=existing.find(x=>x.size===v.size)?.qty||0;
   return `<article class="nl-bulk-product" data-bulk-product="${esc(p.id)}" data-selected="${qty>0}">
    <a class="nl-bulk-image" href="/product/${encodeURIComponent(p.id)}?size=${encodeURIComponent(v.size)}"><img src="${esc(image(p,v.size))}" alt="${esc(p.name+' '+v.size)}" loading="lazy"></a>
    <div class="nl-bulk-product-body"><span class="ap-eyebrow">${esc(p.group)}</span><h3><a href="/product/${encodeURIComponent(p.id)}?size=${encodeURIComponent(v.size)}">${esc(p.name)}</a></h3>
    <div class="nl-bulk-sizes" role="group" aria-label="Choose a strength for ${esc(p.name)}">${p.variants.map(x=>`<button type="button" data-action="bulk-size" data-id="${esc(p.id)}" data-size="${esc(x.size)}" aria-pressed="${x.size===v.size}">${esc(x.size)}</button>`).join('')}</div>
    <div class="nl-bulk-prices"><strong data-bulk-unit>${priceMarkup(v.price)}</strong><span>/unit</span></div>
    <div class="nl-bulk-product-foot"><div class="nl-bulk-quantity-controls">${quantityControls(p.id,v.size,qty,p.name,true)}</div></div></div></article>`;
  }).join('')||empty('No matching products','Try a different name or category.');
 }
 function quantityControls(id,size,qty,name,addTen=false){
  return `<button type="button" class="nl-bulk-qty-step" data-action="bulk-qty" data-id="${esc(id)}" data-size="${esc(size)}" data-delta="-1" aria-label="Decrease ${esc(name+' '+size)}" ${qty<=0?'disabled':''}>−</button>
   <input type="number" min="0" max="100" step="1" value="${qty}" data-bulk-id="${esc(id)}" data-bulk-size="${esc(size)}" aria-label="Quantity for ${esc(name+' '+size)}">
   <button type="button" class="nl-bulk-qty-step" data-action="bulk-qty" data-id="${esc(id)}" data-size="${esc(size)}" data-delta="1" aria-label="Increase ${esc(name+' '+size)}" ${qty>=100?'disabled':''}>+</button>
   ${addTen?`<button type="button" class="nl-bulk-plus-ten" data-action="bulk-qty" data-id="${esc(id)}" data-size="${esc(size)}" data-delta="10" aria-label="Add 10 units of ${esc(name+' '+size)}" ${qty>=100?'disabled':''}><span class="nl-bulk-add-label">+ Add 10 units</span><span class="nl-bulk-short-label">+10</span></button>`:`<button type="button" class="nl-bulk-menu-remove" data-action="bulk-qty" data-id="${esc(id)}" data-size="${esc(size)}" data-delta="-100" aria-label="Remove ${esc(name+' '+size)}">×</button>`}`;
 }
 function bulkSummary(){
  const root=$('#ap-bulk-summary');if(!root)return;
  const units=bulk.reduce((n,x)=>n+x.qty,0),subtotal=total(bulk),
   tierRate=window.PureQuantityPricing?.bulkRate?.(units)||0,
   tierSavingsCents=bulk.reduce((n,x)=>n+Math.round(Math.round(x.price*100)*x.qty*tierRate/10000),0),
   tierNet=subtotal-tierSavingsCents/100,ids=[...new Set(bulk.map(x=>x.id))];
  root.dataset.empty=String(units===0);
  const selection=ids.length?ids.map(id=>{
   const p=product(id),lines=bulk.filter(x=>x.id===id),count=lines.reduce((n,x)=>n+x.qty,0);
   return `<section class="nl-bulk-menu-product"><header class="nl-bulk-menu-product-head"><img src="${esc(image(p,lines[0].size))}" alt=""><span><strong>${esc(p.name)}</strong><small>${count} units</small></span></header>
    ${lines.map(x=>{const gross=Math.round(x.price*100)*x.qty,saved=Math.round(gross*tierRate/10000);return `<div class="nl-bulk-menu-line"><div class="nl-bulk-menu-controls"><span class="nl-bulk-menu-variant">${esc(x.size)} · ${priceMarkup(x.price)}/unit</span><div class="nl-bulk-quantity-controls">${quantityControls(x.id,x.size,x.qty,x.name)}</div></div><div class="nl-bulk-menu-line-price">${saved?`<del>${priceMarkup(gross/100)}</del>`:''}<strong>${priceMarkup((gross-saved)/100)}</strong></div></div>`;}).join('')}</section>`;
  }).join(''):'<div class="nl-bulk-menu-empty">Select product quantities for your order.</div>';
  root.innerHTML=`<div class="nl-bulk-summary-heading"><span class="ap-eyebrow">YOUR ORDER</span><h2>Your selections</h2><span class="nl-bulk-total-units">${units} units</span></div>
   ${units?'':'<button type="button" class="ap-button nl-bulk-add-products" data-action="bulk-add-products">ADD PRODUCTS</button>'}
   <div class="nl-bulk-summary-scroll" aria-label="Selected products">${selection}</div>
   <div class="nl-bulk-totals"><div class="nl-bulk-estimate-total"><span>Merchandise subtotal</span><strong>${priceMarkup(subtotal)}</strong></div>${tierSavingsCents>0?`<div class="nl-bulk-tier-savings"><span>Bulk savings ${tierRate/100}%</span><strong>−${priceMarkup(tierSavingsCents/100)}</strong></div><div class="nl-bulk-net"><span>After bulk savings</span><strong>${priceMarkup(tierNet)}</strong></div>`:''} </div>
   <button class="ap-button" data-action="bulk-checkout" ${units?'':'disabled'}>Checkout · ${priceMarkup(tierNet)}</button>
   <p class="ap-fine nl-bulk-checkout-note">Save 20% on 10–49 total units or 50% on 50+ units. Bulk savings don't stack with other discounts. Shipping is confirmed at checkout. Your regular cart stays saved.</p>`;
 }
 function render(path,root){
  if(!root)return;
  const pageFallback=(title,copy,href,label)=>()=>'<div class="pure-simple-page">'+heading('PURE',title,copy)+'<section class="ap-container ap-section"><a class="ap-button ap-button-secondary" href="'+href+'">'+label+' →</a></section></div>';
  const routes={
   '/bulk-orders':bulkPage,
   '/rewards':pageFallback('Points & Credit','Sign in to view your issued points and store credit.','/account#rewards-and-credit','View your balance'),
   '/coas':coaPage,
   '/contact':contactPage,'/partner-program':partnerPage,
   '/about':pageFallback('About PURE','Research compounds and product documentation for laboratory teams.','/shop','Explore the catalog'),
   '/track-order':pageFallback('Track your order','Sign in to view order status and available tracking information.','/account/purchases','View my orders')
  };
  const renderPage=routes[path];root.innerHTML=renderPage?renderPage():heading('PURE','This page could not be found.','Explore the current catalog.');
  if(path==='/bulk-orders'){if(!initialized){initialized=true;const p=product(new URLSearchParams(location.search).get('product'));if(p)bulkQuery=p.name;}bulkResults();bulkSummary();}
  if(path==='/coas')supplierReferences();
  document.title=({'/bulk-orders':'Bulk Orders','/rewards':'Points & Credit','/coas':'COA Library','/contact':'Contact','/about':'About','/partner-program':'Partner Program','/track-order':'Track Your Order'}[path]||'PURE')+' | PURE';
 }
 async function renderAccountPanel(path,root,auth,user){root.innerHTML='<p class="ap-muted">Loading your workspace…</p>';let fresh=user;try{const result=await auth.auth.getUser();if(result.data?.user)fresh=result.data.user;}catch{}const commerce=fresh.app_metadata?.alta_commerce;const data=commerce&&typeof commerce==='object'?commerce:{};
  if(path==='/account/points'||path==='/account/store-credit'){const isPoints=path.endsWith('points'),record=isPoints?data.rewards:data.store_credit;const value=isPoints?record?.points:record?.balance_cents;const valid=Number.isSafeInteger(value)&&value>=0;root.innerHTML=`<div class="ap-panel"><span class="ap-eyebrow">${isPoints?'REWARD POINTS':'ISSUED STORE CREDIT'}</span><div class="ap-plan-price">${valid?(isPoints?String(value):new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value/100)):'—'}</div><p>${valid?'Your existing balance can be applied at checkout.':'No issued '+(isPoints?'rewards':'store-credit')+' record is available for your account. A missing record is not displayed as an earned balance.'}</p></div><div class="ap-panel" style="margin-top:20px"><h3>Activity</h3>${Array.isArray(record?.events)&&record.events.length?record.events.slice(0,50).map(e=>`<p>${esc(typeof e.description==='string'?e.description:'Account adjustment')} · ${esc(typeof e.date==='string'?e.date:'')}</p>`).join(''):'<p>No issued activity to display.</p>'}</div>`;return;}
  if(path==='/account/partner'){root.innerHTML=`<div class="ap-panel"><span class="ap-eyebrow">PARTNER WORKSPACE</span><h3>${data.partner?.status==='approved'?'Partner record available':'Start a partnership conversation.'}</h3><p>${data.partner?.status==='approved'?'Your account has an approved partner status. Refer to your written agreement for terms.':'No approved partner enrollment is recorded here. Send an inquiry to discuss your organization and proposed collaboration.'}</p><a class="ap-button" href="/partner-program">Open partner program ↗</a></div>`;return;}
  root.innerHTML=empty('Workspace information unavailable','Try reloading your account.');
 }
 document.addEventListener('click',event=>{const button=event.target.closest('[data-action]');if(!button)return;const action=button.dataset.action;
  if(action==='bulk-add-products'){const query=$('#ap-bulk-query');if(query){query.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});query.focus({preventScroll:true});}return;}
  if(action==='bulk-qty'){const current=bulk.find(x=>x.id===button.dataset.id&&x.size===button.dataset.size)?.qty||0;setBulkQuantity(button.dataset.id,button.dataset.size,current+Number(button.dataset.delta));}
  if(action==='bulk-size'){const p=product(button.dataset.id),v=p?.variants.find(x=>x.size===button.dataset.size);if(p&&v){bulkSizes[p.id]=v.size;A.write(bulkSizeKey,bulkSizes);bulkResults();}}
  if(action==='bulk-category'){bulkGroup=button.dataset.group||'All';$$('[data-action="bulk-category"]').forEach(x=>x.setAttribute('aria-pressed',String(x.dataset.group===bulkGroup)));bulkResults();}
  if(action==='bulk-export')A.exportLines(bulk,'PURE-bulk-request.csv');
  if(action==='bulk-cart'){try{A.addItems(simpleLines(bulk));}catch(e){A.toast(e.message);}}
  if(action==='bulk-clear'){bulk=[];A.write(bulkKey,bulk);bulkResults();bulkSummary();}
  if(action==='bulk-checkout'){if(!bulk.length){A.toast('Choose at least one product.');return;}A.write(bulkKey,simpleLines(bulk));location.assign('/checkout?bulk=1');}
  if(action==='bulk-inquiry'){const panel=$('#ap-bulk-inquiry');panel.hidden=false;panel.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});$('input[name="name"]',panel).focus({preventScroll:true});}
 });
 document.addEventListener('input',event=>{const el=event.target;
  if(el.id==='ap-bulk-query'){bulkQuery=el.value;bulkResults();}

  if(el.matches('[data-bulk-id]')){const qty=Number(el.value);if(!Number.isInteger(qty)||qty<0||qty>100){el.setCustomValidity('Enter a whole number from 0 to 100.');return;}el.setCustomValidity('');setBulkQuantity(el.dataset.bulkId,el.dataset.bulkSize,qty);}
 });
 document.addEventListener('change',event=>{const el=event.target;if(el.id==='ap-bulk-group'){bulkGroup=el.value;bulkResults();}});
 document.addEventListener('submit',async event=>{const form=event.target;if(!form.matches('.ap-inquiry-form'))return;event.preventDefault();if(!form.reportValidity())return;const data=new FormData(form),type=form.dataset.inquiryType,button=$('button[type="submit"]',form),out=$('.ap-form-status',form);if(type==='bulk'&&!bulk.length){out.textContent='Choose products and quantities first.';return;}button.disabled=true;out.textContent='Sending your request…';if(!form.dataset.requestId)form.dataset.requestId=crypto.randomUUID();try{const result=await A.inquiry({type,request_id:form.dataset.requestId,name:data.get('name'),email:data.get('email'),organization:data.get('organization'),country:data.get('country'),topic:data.get('topic'),message:data.get('message'),website:data.get('website'),consent:data.get('consent')==='on',items:type==='bulk'?simpleLines(bulk):[]});out.textContent='Request saved. Reference: '+result.reference+'. Team notification: '+(result.notification||'queued')+'. View account responses under My account → Requests. No order was placed.';form.reset();delete form.dataset.requestId;}catch(e){out.textContent=e.message;}finally{button.disabled=false;}});
 window.AltaWorkspace={render,renderAccountPanel,authClient};
 if($('#ap-main')&&!['/','/index','/shop'].includes(A.route())&&!A.route().startsWith('/product/'))render(A.route(),$('#ap-main'));
})();
