(() => {
 'use strict';
 document.addEventListener('click',e=>{const control=e.target.closest('[data-carousel]');if(!control)return;const rail=document.getElementById('nl-featured');if(rail)rail.scrollBy({left:Number(control.dataset.carousel)*rail.clientWidth,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});});
 // Native clipboard button is added to report IDs without modifying the report data.
 const reports=document.getElementById('ap-supplier-references');
 if(reports){const decorate=()=>{for(const dt of reports.querySelectorAll('dt')){if(dt.textContent!=='Report ID')continue;const dd=dt.nextElementSibling;if(!dd||dd.querySelector('button'))continue;const id=dd.textContent;const button=document.createElement('button');button.type='button';button.className='nl-coa-copy';button.textContent='Copy';button.setAttribute('aria-label','Copy report ID '+id);button.onclick=async()=>{try{await navigator.clipboard.writeText(id);button.textContent='Copied';setTimeout(()=>button.textContent='Copy',1800);}catch{button.textContent='Select ID to copy';}};dd.append(button);}};new MutationObserver(decorate).observe(reports,{childList:true,subtree:true});decorate();}
})();

(() => {
 const active=()=>Date.now()<Date.parse(document.querySelector('meta[name="altapure-promo-end"]')?.content);
 function updateQuantity(){
  const group=document.querySelector('[data-unit-price]');
  const input=document.getElementById('ap-detail-quantity');
  if(!group||!input)return;
  const qty=Number(input.value),unit=Number(group.dataset.unitPrice);
  if(!Number.isInteger(qty)||qty<1||qty>100)return;
  const total=qty*unit;
  const format=n=>window.AltaLocale?.formatMoney?window.AltaLocale.formatMoney(n):new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n);
  for(const button of group.querySelectorAll('[data-bundle-quantity]'))button.setAttribute('aria-pressed',String(Number(button.dataset.bundleQuantity)===qty));
  const estimate=document.querySelector('[data-bundle-estimate]');
  if(estimate)estimate.textContent=format(total)+' for '+qty+' unit'+(qty===1?'':'s');
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

// The bulk order summary follows the current sticky navigation offset.
(() => {
 const header=document.querySelector('.ap-header');if(!header)return;
 const update=()=>{const top=parseFloat(getComputedStyle(header).top)||0;document.documentElement.style.setProperty('--ap-workspace-sticky-top',Math.ceil(header.getBoundingClientRect().height+top+16)+'px');};
 update();window.addEventListener('resize',update,{passive:true});
 if(typeof ResizeObserver!=='undefined')new ResizeObserver(update).observe(header);
})();
