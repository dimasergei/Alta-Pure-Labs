/* PURE Member Stack — a benefit of an active paid membership, not a subscription. */
(() => {
 'use strict';
 const draftKey='pure-member-stack-v1',endpoint='/api/customer-config?research_builder=1';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=c=>window.AltaLocale?.price?window.AltaLocale.price(c,{compact:true,showCode:false}):new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(c/100);
 const readDraft=()=>{try{const v=JSON.parse(localStorage.getItem(draftKey)||'{}');return Array.isArray(v.lines)?v.lines.slice(0,4).map(x=>({id:x.id,size:x.size,qty:1})):[];}catch{return [];}};
 async function mount(root,options={}){
  if(!root)return;
  let auth=options.auth||null;
  const request=async body=>{
   if(!auth&&window.AltaWorkspace?.authClient)auth=await window.AltaWorkspace.authClient();
   const session=await auth?.auth?.getSession?.(),token=session?.data?.session?.access_token;
   if(!token)throw Error('Sign in to your PURE membership account.');
   const response=await fetch(endpoint,{method:body?'POST':'GET',cache:'no-store',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
   const result=await response.json();if(!response.ok)throw Error(result.error||'Member Stack is unavailable.');return result;
  };
  root.innerHTML='<section class="nl-builder-loading ap-container" role="status">Loading your Member Stack benefit…</section>';
  let data;
  try{data=await request();}
  catch(error){root.innerHTML='<section class="ap-container nl-builder-loading"><h2>Member Stack</h2><p role="alert">'+esc(error.message)+'</p><a class="ap-button" href="/memberships">View PURE memberships</a></section>';return;}
  const catalog=(data.catalog||[]).filter(x=>x.category==='injectables'&&Array.isArray(x.variants)&&x.variants.some(v=>v.price>0));
  const get=id=>catalog.find(x=>x.id===id),variant=(id,size)=>get(id)?.variants.find(v=>v.size===size&&Number.isFinite(v.price)&&v.price>0);
  let lines=readDraft().filter(x=>!!variant(x.id,x.size)),quote=null,pending=false,serial=0,filter='',group='All',error='';
  lines=lines.filter((x,i)=>lines.findIndex(y=>y.id===x.id)===i);
  const sizes=Object.fromEntries(catalog.map(p=>[p.id,lines.find(x=>x.id===p.id)?.size||p.variants[0].size]));
  const persist=()=>localStorage.setItem(draftKey,JSON.stringify({lines}));
  const selection=()=>lines.map(x=>({id:x.id,size:x.size,qty:1}));
  const groups=['All',...new Set(catalog.map(x=>x.group).filter(Boolean))];
  const cardImage=(p,size)=>{try{const result=window.AltaStore?.image?.(window.AltaStore.product?.(p.id)||p,size);if(typeof result==='string'&&(result.startsWith('/')&&!result.startsWith('//')||result.startsWith('https://')))return result;}catch{}return '/assets/research-vials-pure.webp';};
  root.innerHTML='<section class="nl-builder-hero"><div class="ap-container"><span class="nl-capsule">PURE MEMBER BENEFIT</span><h1 class="nl-autostack-title"><span class="nl-autostack-name">MEMBER STACK</span></h1><p>Choose four different compounds and strengths. Your PURE membership unlocks 40% off this set, included BAC Water 3mL and US express shipping.</p></div></section><section class="ap-container nl-builder-benefits"><article class="nl-builder-benefit"><strong class="nl-builder-benefit-value">40%</strong><span>Off your stack</span><small>PURE member benefit</small></article><article class="nl-builder-benefit"><strong class="nl-builder-benefit-value">4</strong><span>Your compounds</span><small>Choose exact strengths</small></article><article class="nl-builder-benefit"><strong class="nl-builder-benefit-value">BAC 3mL</strong><span>Included</span><small>With your stack order</small></article><article class="nl-builder-benefit"><strong class="nl-builder-benefit-value">Express</strong><span>US shipping included</span><small>Per stack purchase</small></article></section><div class="ap-container nl-builder-layout"><section class="nl-builder-catalog"><div class="nl-builder-toolbar"><label class="ap-sr" for="pure-member-stack-search">Search compounds</label><input id="pure-member-stack-search" type="search" maxlength="120" placeholder="Search compounds" autocomplete="off"></div><div class="nl-builder-categories" role="group" aria-label="Research categories"></div><p id="pure-member-stack-count" class="ap-result-count" role="status"></p><div id="pure-member-stack-grid" class="ap-builder-grid"></div></section><aside class="ap-summary nl-builder-summary" aria-label="Your Member Stack"><div id="pure-member-stack-summary"></div><p class="nl-builder-feedback" role="status" aria-live="polite"></p></aside></div>';
  document.title='Member Stack | PURE';
  const feedback=msg=>{const el=root.querySelector('.nl-builder-feedback');if(el)el.textContent=msg;};
  function renderProducts(){
   root.querySelector('.nl-builder-categories').innerHTML=groups.map(x=>'<button type="button" data-group="'+esc(x)+'" aria-pressed="'+String(x===group)+'">'+esc(x)+'</button>').join('');
   const items=catalog.filter(p=>(group==='All'||p.group===group)&&(!filter||p.name.toLowerCase().includes(filter)||p.group?.toLowerCase().includes(filter)));
   root.querySelector('#pure-member-stack-count').textContent=items.length+' compounds';
   root.querySelector('#pure-member-stack-grid').innerHTML=items.map(p=>{
    const v=variant(p.id,sizes[p.id]),cents=Math.round(v.price*100),sale=cents-Math.floor(cents*4000/10000),picked=lines.some(x=>x.id===p.id);
    return '<article class="nl-builder-product" data-product="'+esc(p.id)+'"><a class="ap-product-image" href="/product/'+encodeURIComponent(p.id)+'?size='+encodeURIComponent(v.size)+'" aria-label="View '+esc(p.name)+'"><img src="'+esc(cardImage(p,v.size))+'" alt="'+esc(p.name+' product packaging')+'" loading="lazy"></a><div class="ap-product-body"><h3>'+esc(p.name)+'</h3><div class="ap-size-options" role="group" aria-label="'+esc(p.name)+' strength">'+p.variants.filter(v=>v.price>0).map(x=>'<button type="button" data-size="'+esc(x.size)+'" data-id="'+esc(p.id)+'" aria-pressed="'+String(x.size===v.size)+'">'+esc(x.size)+'</button>').join('')+'</div><p class="ap-product-price">'+money(sale)+' <del>'+money(cents)+'</del><small>Member Stack · one unit</small></p><div class="ap-product-actions"><button class="ap-add" type="button" data-add="'+esc(p.id)+'" aria-pressed="'+picked+'" '+(!picked&&lines.length>=4?'disabled':'')+'>'+ (picked?'Selected ✓':'Add to set +')+'</button></div></div></article>';
   }).join('')||'<p class="nl-builder-empty">No compounds match your search.</p>';
  }
  function renderSummary(){
   const subtotal=lines.reduce((n,x)=>n+Math.round(variant(x.id,x.size).price*100),0);
   const savings=lines.reduce((n,x)=>{const c=Math.round(variant(x.id,x.size).price*100);return n+Math.floor(c*4000/10000);},0);
   const complete=lines.length===4&&!pending&&!error&&quote?.total_cents>0;
   const amount=quote?.total_cents??subtotal-savings;
   root.querySelector('#pure-member-stack-summary').innerHTML='<div class="nl-builder-summary-heading"><h2>Your Member Stack</h2><span class="nl-builder-selected">'+lines.length+' of 4 selected</span></div><div class="nl-builder-slots">'+Array.from({length:4},(_,i)=>{
    const x=lines[i],p=x&&get(x.id);
    return '<div class="nl-builder-slot'+(x?' is-selected':'')+'"><span class="nl-builder-slot-copy">'+(x?'<strong>'+esc(p?.name||x.id)+'</strong><small>'+esc(x.size)+' · Qty 1</small>':'<strong>Choose a compound</strong>')+'</span>'+(x?'<button type="button" data-remove="'+esc(x.id)+'" aria-label="Remove '+esc(p?.name||x.id)+'">×</button>':'')+'</div>';
   }).join('')+'</div><div class="nl-price-list"><div><span>Product subtotal</span><span>'+money(subtotal)+'</span></div><div class="nl-builder-savings"><span>Member Stack savings · 40%</span><strong>−'+money(savings)+'</strong></div><div><span>BAC Water 3mL</span><span>Included</span></div><div><span>US express shipping</span><span>Included</span></div><div class="nl-price-total"><span>Stack subtotal</span><strong>'+money(amount)+'</strong></div></div>'+(error?'<p class="nl-builder-availability" role="alert">'+esc(error)+'</p>':'')+'<div class="ap-summary-actions"><button type="button" class="ap-button" data-checkout '+(!complete?'disabled':'')+'>'+(lines.length!==4?'Choose '+(4-lines.length)+' more':pending?'Checking prices…':'Checkout Member Stack')+'</button></div><p class="nl-builder-terms">Your member benefit applies to this individual purchase. Final payment is confirmed at checkout. Your PURE membership is the only membership plan.</p><div class="nl-builder-secondary-actions"><button type="button" data-clear '+(!lines.length?'disabled':'')+'>Clear selections</button><a href="/account/membership">Your membership</a></div>';
  }
  async function refresh(){
   const generation=++serial;pending=lines.length===4;quote=null;error='';renderProducts();renderSummary();if(!pending)return;
   try{const result=await request({action:'quote',mode:'member_stack',items:selection()});
    if(generation!==serial)return;
    if(!Number.isSafeInteger(result.total_cents)||result.total_cents<=0||result.mode!=='member_stack')throw Error('Current member pricing could not be confirmed.');
    quote=result;
   }catch(e){if(generation===serial)error=e.message;}
   finally{if(generation===serial){pending=false;renderSummary();}}
  }
  root.querySelector('#pure-member-stack-search').oninput=e=>{filter=e.target.value.trim().toLowerCase().slice(0,120);renderProducts();};
  root.addEventListener('click',event=>{
   const button=event.target.closest('button');if(!button||!root.contains(button)||button.disabled)return;
   if(button.dataset.group){group=button.dataset.group;renderProducts();return;}
   if(button.dataset.size){if(!variant(button.dataset.id,button.dataset.size))return;sizes[button.dataset.id]=button.dataset.size;lines=lines.map(x=>x.id===button.dataset.id?{...x,size:button.dataset.size}:x);persist();refresh();return;}
   if(button.dataset.add){const id=button.dataset.add;lines=lines.some(x=>x.id===id)?lines.filter(x=>x.id!==id):lines.length>=4?lines:[...lines,{id,size:sizes[id],qty:1}];persist();refresh();return;}
   if(button.dataset.remove){lines=lines.filter(x=>x.id!==button.dataset.remove);persist();refresh();return;}
   if(button.hasAttribute('data-clear')){lines=[];persist();refresh();return;}
   if(button.hasAttribute('data-checkout')&&quote&&lines.length===4&&!pending&&!error){
    persist();(options.navigate||(href=>location.assign(href)))('/checkout?member_stack=1');
   }
  });
  renderProducts();await refresh();
 }
 window.PureResearchBuilder={mount,readDraft};
})();
