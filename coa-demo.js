'use strict';
(() => {
 const root=document.getElementById('coa-demo-results');
 const status=document.getElementById('coa-demo-status');
 if(!root||!status)return;
 const make=(tag,value)=>{const el=document.createElement(tag);el.textContent=String(value??'');return el;};
 fetch('/data/coa-demo-samples.json',{cache:'no-store'}).then(response=>{
  if(!response.ok)throw Error('Samples unavailable');return response.json();
 }).then(samples=>{
  if(!Array.isArray(samples))throw Error('Invalid samples');
  root.replaceChildren();
  let count=0;
  for(const sample of samples){
   if(!sample||sample.status!=='sample_only'||sample.document_url!==null||
      sample.report_id!==null||sample.lab_name!==null||typeof sample.product!=='string'||
      typeof sample.sku_key!=='string'||sample.lot!=='DEMO-NOT-A-REAL-LOT')continue;
   const card=make('article');card.className='coa-card';
   card.append(make('p','DEMO ONLY — NOT A COA'),make('h3',sample.product),
     make('p','Sample product key: '+sample.sku_key),
     make('p','Batch: '+sample.lot),
     make('p','Laboratory: Not supplied'),
     make('p','Report: Not supplied'),
     make('p','Verification: Not available'));
   root.append(card);count++;
  }
  status.textContent=count+' fictional layout examples. No laboratory results or certificates are represented.';
 }).catch(()=>{
  status.textContent='Demo examples are unavailable. Verified certificate status above is unaffected.';
 });
})();
