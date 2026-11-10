/* Original supplier reports: catalog matches are distinct from fulfilled-lot verification. */
(function(root){
 'use strict';
 const hosts=new Set(['pub-82f90d490a8048aa9629f0ae3ea6f567.r2.dev','api.purityanalytics.com','verify.purityanalytics.com','yourpeptidebrand.com','99puritypeptides.com','lifelinkresearch.com']);
 function safeUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&hosts.has(u.hostname)?u.href:null;}catch{return null;}}
 function validReport(r){return !!(r&&r.scope==='supplier_reference'&&r.inventory_lot_linked===false&&typeof r.id==='string'&&typeof r.product_id==='string'&&typeof r.size==='string'&&r.lot&&r.report_client&&r.lab_name&&r.report_id&&safeUrl(r.document_url)&&(!r.document_pages||(Array.isArray(r.document_pages)&&r.document_pages.length>0&&r.document_pages.every(safeUrl))));}
 function selectReports(records,{product='',size='',supplier='',query=''}={}){const q=query.trim().toLowerCase();return records.filter(validReport).filter(r=>(!product||r.product_id===product)&&(!size||r.size===size)&&(!supplier||r.supplier_id===supplier)&&[r.product,r.size,r.sample_name,r.lot,r.lab_name,r.report_id,r.supplier,r.report_client,r.supplier_sku].join(' ').toLowerCase().includes(q));}
 const api={safeUrl,validReport,selectReports};
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(!root.document)return;
 let promise,dialog,returnFocus;
 const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
 function link(url,label){const a=el('a',label,'ap-text-link');a.href=safeUrl(url);a.target='_blank';a.rel='noopener noreferrer';return a;}
 function closeViewer(){if(dialog?.open)dialog.close();dialog?.querySelector('iframe')?.remove();returnFocus?.focus();}
 function viewReport(r,button){
  if(!dialog){dialog=el('dialog',undefined,'ap-coa-dialog');dialog.setAttribute('aria-labelledby','ap-coa-viewer-title');document.body.append(dialog);dialog.addEventListener('cancel',e=>{e.preventDefault();closeViewer();});dialog.addEventListener('click',e=>{if(e.target===dialog)closeViewer();});}
  returnFocus=button;dialog.replaceChildren();
  const bar=el('div',undefined,'ap-coa-viewer-bar'),title=el('h2',r.product+' · '+r.size);title.id='ap-coa-viewer-title';const close=el('button','Close report ×','ap-button ap-button-small');close.type='button';close.onclick=closeViewer;bar.append(title,close);
  const context=el('p','Supplier: '+r.supplier+' · Report client: '+r.report_client+' · Lot: '+r.lot,'ap-coa-viewer-context');
  let frame;if(r.document_type==='images'){frame=el('div',undefined,'ap-coa-image-pages');for(const [i,url]of r.document_pages.entries()){const img=el('img');img.src=safeUrl(url);img.alt='Original report sheet '+(i+1)+' for '+r.sample_name;img.referrerPolicy='no-referrer';frame.append(img);}}else{frame=el('iframe');frame.title='Original COA: '+r.sample_name+' — '+r.report_id;frame.referrerPolicy='no-referrer';frame.src=safeUrl(r.document_url)+'#view=FitH';}
  const fallback=el('p',undefined,'ap-coa-viewer-context');fallback.append('If the sheet does not display on this device, ',link(r.document_url,'open the original report ↗'));
  dialog.append(bar,context,fallback,frame);dialog.showModal();close.focus();
 }
 async function render(container,catalog){
  try{
   if(!promise)promise=fetch('/data/supplier-coas.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error();return r.json();}).then(d=>{if(!Array.isArray(d.reports)||!Array.isArray(d.coverage))throw Error();return d;}).catch(e=>{promise=null;throw e;});
   const data=await promise;if(!container.isConnected)return;
   const product=document.getElementById('ap-coa-product')?.value||'',supplier=document.getElementById('ap-coa-supplier')?.value||'',query=document.getElementById('ap-coa-query')?.value||'';
   const sizeSelect=document.getElementById('ap-coa-size');
   if(sizeSelect&&sizeSelect.dataset.product!==product){sizeSelect.dataset.product=product;const sizes=[...new Set(catalog.filter(p=>!product||p.id===product).flatMap(p=>p.variants.map(v=>v.size)))];sizeSelect.replaceChildren(new Option('All strengths',''),...sizes.map(s=>new Option(s,s)));}
   const size=sizeSelect?.value||'',records=selectReports(data.reports,{product,size,supplier,query});
   const coverage=data.coverage.filter(c=>(!product||c.product_id===product)&&(!size||c.size===size));
   const covered=coverage.filter(c=>data.reports.some(r=>validReport(r)&&r.product_id===c.product_id&&r.size===c.size&&(!supplier||r.supplier_id===supplier))).length;
   const count=document.getElementById('ap-coa-count');if(count)count.textContent=records.length+' supplier reports found · '+covered+' of '+coverage.length+' selected catalog variants documented';
   container.replaceChildren();
   const grid=el('div',undefined,'ap-panel-grid ap-supplier-coa-grid');
   for(const r of records){
    const card=el('article',undefined,'ap-coa-card');card.append(el('span','SUPPLIER REPORT','ap-pill'),el('h2',r.product+' · '+r.size),el('p',r.supplier,'ap-coa-supplier-name'));
    const dl=el('dl');for(const [label,value]of [['Report client / ordered by',r.report_client],['Laboratory',r.lab_name],['Certificate publisher',r.publisher],['Supplier lot',r.lot],['Report / analysis date',r.report_date],['Report ID',r.report_id],['Supplier SKU',r.supplier_sku]])if(value)dl.append(el('dt',label),el('dd',value));card.append(dl);
    const actions=el('div',undefined,'ap-actions'),button=el('button','View COA','ap-button ap-button-small');button.type='button';button.onclick=()=>viewReport(r,button);actions.append(button,link(r.document_type==='images'?r.source_library_url:r.document_url,r.document_type==='images'?'Original report ↗':'Original PDF ↗'));if(safeUrl(r.verification_url))actions.append(link(r.verification_url,'Certificate verification ↗'));card.append(actions,el('p',r.match_note,'ap-fine'));grid.append(card);
   }
   if(!records.length)grid.append(el('p','No original supplier report matches these filters. Try another selection or request the exact product, strength and lot.','ap-panel'));
   container.append(grid);
   const missing=coverage.filter(c=>!data.reports.some(r=>validReport(r)&&r.product_id===c.product_id&&r.size===c.size&&(!supplier||r.supplier_id===supplier)));
   if(missing.length){const details=el('details',undefined,'ap-coa-missing');details.append(el('summary',missing.length+' selected variants still need an exact supplier report'));const list=el('ul');for(const c of missing)list.append(el('li',c.product+' · '+c.size));details.append(list);container.append(details);}
   const note=el('p','PeptideDropship identifies Life Link Research as its report source. All sheets retain their original client and attribution. A matching product label is not confirmation of the lot supplied with your order; missing lots and report discrepancies are noted on each card.','ap-fine');container.append(note);
  }catch{if(container.isConnected)container.textContent='Supplier reports are temporarily unavailable. Please contact us for the exact product, strength and lot.';}
 }
 api.render=render;root.AltaSupplierCoas=api;
 document.addEventListener('input',e=>{if(e.target.id==='ap-coa-query'){const c=document.getElementById('ap-supplier-references');if(c)render(c,root.AltaStore?.catalog||[]);}});
 document.addEventListener('change',e=>{if(['ap-coa-product','ap-coa-size','ap-coa-supplier'].includes(e.target.id)){const c=document.getElementById('ap-supplier-references');if(c)render(c,root.AltaStore?.catalog||[]);}});
})(typeof window==='undefined'?globalThis:window);
