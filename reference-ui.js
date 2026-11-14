(() => {
 'use strict';
 document.addEventListener('click',e=>{const control=e.target.closest('[data-carousel]');if(!control)return;const rail=document.getElementById('nl-featured');if(rail)rail.scrollBy({left:Number(control.dataset.carousel)*rail.clientWidth,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});});
 // Native clipboard button is added to report IDs without modifying the report data.
 const reports=document.getElementById('ap-supplier-references');
 if(reports){const decorate=()=>{for(const dt of reports.querySelectorAll('dt')){if(dt.textContent!=='Report ID')continue;const dd=dt.nextElementSibling;if(!dd||dd.querySelector('button'))continue;const id=dd.textContent;const button=document.createElement('button');button.type='button';button.className='nl-coa-copy';button.textContent='Copy';button.setAttribute('aria-label','Copy report ID '+id);button.onclick=async()=>{try{await navigator.clipboard.writeText(id);button.textContent='Copied';setTimeout(()=>button.textContent='Copy',1800);}catch{button.textContent='Select ID to copy';}};dd.append(button);}};new MutationObserver(decorate).observe(reports,{childList:true,subtree:true});decorate();}
})();

(() => {
 const end=Date.parse(document.querySelector('meta[name="altapure-promo-end"]')?.content);
 if(!Number.isFinite(end))return;
 const tick=()=>{
  const seconds=Math.max(0,Math.ceil((end-Date.now())/1000));
  document.documentElement.classList.toggle('ap-promo-ended',seconds===0);
  const clock=document.querySelector('[data-promo-clock]');
  if(!clock)return;
  clock.hidden=seconds===0;
  const units=[Math.floor(seconds/86400),Math.floor(seconds/3600)%24,Math.floor(seconds/60)%60,seconds%60];
  const cells=['days','hours','minutes','seconds'];
  cells.forEach((key,index)=>{
   const cell=clock.querySelector('[data-promo-'+key+']');
   if(cell)cell.textContent=String(units[index]).padStart(2,'0');
  });
 };
 tick();
 setInterval(tick,1000);
})();

(() => {
 const active=()=>Date.now()<Date.parse(document.querySelector('meta[name="altapure-promo-end"]')?.content);
 function updateQuantity(){
  const group=document.querySelector('[data-unit-price]');
  const input=document.getElementById('ap-detail-quantity');
  if(!group||!input)return;
  const qty=Number(input.value),unit=Number(group.dataset.unitPrice);
  if(!Number.isInteger(qty)||qty<1||qty>(active()?50:100))return;
  const total=qty*unit;
  const format=n=>window.AltaLocale?.formatMoney?window.AltaLocale.formatMoney(n):new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n);
  for(const button of group.querySelectorAll('[data-bundle-quantity]'))button.setAttribute('aria-pressed',String(Number(button.dataset.bundleQuantity)===qty));
  const estimate=document.querySelector('[data-bundle-estimate]');
  if(estimate)estimate.textContent=format(total)+' for '+qty+' purchased unit'+(qty===1?'':'s')+(active()?' + '+qty+' free':'')+' · before additional discounts';
  const mobile=document.querySelector('[data-mobile-total]');
  if(mobile)mobile.textContent=format(total)+' estimated total';
 }
 document.addEventListener('click',event=>{
  const bundle=event.target.closest('[data-bundle-quantity]');
  if(bundle){
   const input=document.getElementById('ap-detail-quantity');
   if(input){input.value=bundle.dataset.bundleQuantity;input.dispatchEvent(new Event('input',{bubbles:true}));}
  }
  if(bundle||event.target.closest('[data-action="detail-quantity"]'))queueMicrotask(updateQuantity);
 });
 document.addEventListener('input',event=>{if(event.target.id==='ap-detail-quantity')updateQuantity();});
 const main=document.getElementById('ap-main');
 if(main)new MutationObserver(records=>{if(records.some(r=>[...r.addedNodes].some(n=>n.nodeType===1&&(n.matches?.('.nl-detail')||n.querySelector?.('.nl-detail')))))updateQuantity();}).observe(main,{childList:true});
 updateQuantity();
})();
