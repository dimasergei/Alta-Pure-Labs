(() => {
 'use strict';
 document.addEventListener('click',e=>{const control=e.target.closest('[data-carousel]');if(!control)return;const rail=document.getElementById('nl-featured');if(rail)rail.scrollBy({left:Number(control.dataset.carousel)*rail.clientWidth,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});});
 // Native clipboard button is added to report IDs without modifying the report data.
 const reports=document.getElementById('ap-supplier-references');
 if(reports){const decorate=()=>{for(const dt of reports.querySelectorAll('dt')){if(dt.textContent!=='Report ID')continue;const dd=dt.nextElementSibling;if(!dd||dd.querySelector('button'))continue;const id=dd.textContent;const button=document.createElement('button');button.type='button';button.className='nl-coa-copy';button.textContent='Copy';button.setAttribute('aria-label','Copy report ID '+id);button.onclick=async()=>{try{await navigator.clipboard.writeText(id);button.textContent='Copied';setTimeout(()=>button.textContent='Copy',1800);}catch{button.textContent='Select ID to copy';}};dd.append(button);}};new MutationObserver(decorate).observe(reports,{childList:true,subtree:true});decorate();}
})();
