/* Original supplier reports: catalog matches are distinct from fulfilled-lot verification. */
(function(root){
 'use strict';
 const hosts=new Set(['pub-82f90d490a8048aa9629f0ae3ea6f567.r2.dev','api.purityanalytics.com','verify.purityanalytics.com','yourpeptidebrand.com','99puritypeptides.com','lifelinkresearch.com']);
 function safeUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&hosts.has(u.hostname)?u.href:null;}catch{return null;}}
 function validReport(r){return !!(r&&r.scope==='supplier_reference'&&r.inventory_lot_linked===false&&typeof r.id==='string'&&typeof r.product_id==='string'&&typeof r.size==='string'&&r.lot&&r.report_client&&r.lab_name&&r.report_id&&safeUrl(r.document_url)&&(!r.document_pages||(Array.isArray(r.document_pages)&&r.document_pages.length>0&&r.document_pages.every(safeUrl))));}
 function searchText(value){return String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[-‐‑‒–—]/g,'').replace(/(\d)\s+(?=mg\b|mcg\b|ml\b|iu\b)/g,'$1').replace(/[^a-z0-9.+/]+/g,' ').trim();}
 function selectReports(records,{product='',size='',supplier='',laboratory='',query=''}={}){
  const terms=searchText(query).split(/\s+/).filter(Boolean);
  return records.filter(validReport).filter(r=>{
   if((product&&r.product_id!==product)||(size&&r.size!==size)||(supplier&&r.supplier_id!==supplier)||(laboratory&&r.lab_name!==laboratory))return false;
   const text=searchText([r.product,r.size,r.sample_name,r.lot,r.lab_name,r.report_id,r.supplier,r.report_client,r.supplier_sku].join(' '));
   return terms.every(term=>/^\d+(?:\.\d+)?(?:mg|mcg|ml|iu)$/.test(term)?new RegExp('(?:^|[^0-9.])'+term.replace('.','\\.')+'(?=$|[^a-z0-9])').test(text):text.includes(term));
  });
 }
 const api={safeUrl,validReport,selectReports};
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(!root.document)return;
 let promise,dialog,returnFocus;
 const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
 function link(url,label){const a=el('a',label,'ap-text-link');a.href=safeUrl(url);a.target='_blank';a.rel='noopener noreferrer';return a;}
 // Consistent secondary action; never change where the source report points.
 function originalDocumentLink(url,isImage){
  const a=link(url,isImage?'Open original report':'Open original PDF');
  a.className='ap-coa-original-link';
  const ns='http://www.w3.org/2000/svg';
  const svg=document.createElementNS(ns,'svg');
  svg.setAttribute('viewBox','0 0 24 24');
  svg.setAttribute('aria-hidden','true');
  svg.setAttribute('focusable','false');
  const path=document.createElementNS(ns,'path');
  path.setAttribute('d','M6.5 3.5h7l4 4v13h-11z M13.5 3.5v4h4 M9 12h6 M9 16h6');
  svg.append(path);
  a.prepend(svg);
  return a;
 }
 function closeViewer(){if(dialog?.open)dialog.close();dialog?.querySelector('iframe')?.remove();returnFocus?.focus();}
 function viewReport(r,button){
  if(!dialog){dialog=el('dialog',undefined,'ap-coa-dialog');dialog.setAttribute('aria-labelledby','ap-coa-viewer-title');document.body.append(dialog);dialog.addEventListener('cancel',e=>{e.preventDefault();closeViewer();});dialog.addEventListener('click',e=>{if(e.target===dialog)closeViewer();});}
  returnFocus=button;dialog.replaceChildren();
  const bar=el('div',undefined,'ap-coa-viewer-bar'),title=el('h2',r.product+' · '+r.size);title.id='ap-coa-viewer-title';const close=el('button','Close report ×','ap-button ap-button-small');close.type='button';close.onclick=closeViewer;bar.append(title,close);
  const context=el('p','COA report '+r.report_id+' · Reported lot: '+r.lot,'ap-coa-viewer-context');
  let frame;if(r.document_type==='images'){frame=el('div',undefined,'ap-coa-image-pages');for(const [i,url]of r.document_pages.entries()){const img=el('img');img.src=safeUrl(url);img.alt='Original report sheet '+(i+1)+' for '+r.sample_name;img.referrerPolicy='no-referrer';frame.append(img);}}else{frame=el('iframe');frame.title='Original COA: '+r.sample_name+' — '+r.report_id;frame.referrerPolicy='no-referrer';frame.src=safeUrl(r.document_url)+'#view=FitH';}
  const fallback=el('p',undefined,'ap-coa-viewer-context');fallback.append('If the sheet does not display on this device, ',link(r.document_url,'open the original report ↗'));
  dialog.append(bar,context,fallback,frame);dialog.showModal();close.focus();
 }
 async function render(container,catalog){
  try{
   if(!promise)promise=fetch('/data/supplier-coas.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error();return r.json();}).then(d=>{if(!Array.isArray(d.reports)||!Array.isArray(d.coverage))throw Error();return d;}).catch(e=>{promise=null;throw e;});
   const data=await promise;if(!container.isConnected)return;
   const product=document.getElementById('ap-coa-product')?.value||'',supplier=document.getElementById('ap-coa-supplier')?.value||'',query=document.getElementById('ap-coa-query')?.value||'';
   const labSelect=document.getElementById('ap-coa-lab');
   if(labSelect&&!labSelect.dataset.loaded){const labs=[...new Set(data.reports.filter(validReport).map(r=>r.lab_name))].sort((a,b)=>a.localeCompare(b));labSelect.replaceChildren(new Option('All laboratories',''),...labs.map(lab=>new Option(lab,lab)));labSelect.dataset.loaded='true';}
   const laboratory=labSelect?.value||'';
   const sizeSelect=document.getElementById('ap-coa-size');
   if(sizeSelect&&sizeSelect.dataset.product!==product){sizeSelect.dataset.product=product;const sizes=[...new Set(catalog.filter(p=>!product||p.id===product).flatMap(p=>p.variants.map(v=>v.size)))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));const initial=sizeSelect.dataset.initialSize;sizeSelect.replaceChildren(new Option('All strengths',''),...sizes.map(s=>new Option(s,s)));if(initial&&sizes.includes(initial))sizeSelect.value=initial;delete sizeSelect.dataset.initialSize;}
   const size=sizeSelect?.value||'',records=selectReports(data.reports,{product,size,supplier,laboratory,query});
   const coverage=data.coverage.filter(c=>(!product||c.product_id===product)&&(!size||c.size===size));
   const count=document.getElementById('ap-coa-count');if(count)count.textContent=records.length+' COA report'+(records.length===1?'':'s')+' found'+(query.trim()?' for “'+query.trim()+'”':'');
   container.replaceChildren();
   const grid=el('div',undefined,'ap-panel-grid ap-supplier-coa-grid');
   for(const r of records){
    const card=el('article',undefined,'ap-coa-card'),head=el('header',undefined,'pure-coa-card-head'),body=el('div',undefined,'pure-coa-card-body');head.append(el('span','COA REPORT','ap-pill'),el('h2',r.product+' · '+r.size));card.append(head,body);
    const dl=el('dl');for(const [label,value]of [['Laboratory',r.lab_name],['Certificate publisher',r.publisher],['Reported lot',r.lot],['Report / analysis date',r.report_date],['Report ID',r.report_id]])if(value)dl.append(el('dt',label),el('dd',value));body.append(dl);
    const actions=el('div',undefined,'ap-actions'),button=el('button','View COA','ap-button ap-button-small');
    button.type='button';button.onclick=()=>viewReport(r,button);
    const isImage=r.document_type==='images';
    const originalUrl=isImage&&safeUrl(r.source_library_url)?r.source_library_url:r.document_url;
    actions.append(button,originalDocumentLink(originalUrl,isImage));
    if(safeUrl(r.verification_url))actions.append(link(r.verification_url,'Certificate verification ↗'));
    body.append(actions);grid.append(card);
   }
   if(!records.length)grid.append(el('p','No COA report matches these filters. Try another selection or request the exact product, strength and lot.','ap-panel'));
   container.append(grid);
   const missing=coverage.filter(c=>!data.reports.some(r=>validReport(r)&&r.product_id===c.product_id&&r.size===c.size&&(!supplier||r.supplier_id===supplier)));
   if(missing.length&&!query.trim()&&!laboratory){const details=el('details',undefined,'ap-coa-missing');details.append(el('summary',missing.length+' selected variants still need an exact COA report'));const list=el('ul');for(const c of missing)list.append(el('li',c.product+' · '+c.size));details.append(list);container.append(details);}
   const note=el('p','These reports describe the submitted samples. A matching product name does not confirm the lot supplied with your order; request the exact fulfilled-lot COA when ordering. The original report sheets are unchanged.','ap-fine');container.append(note);
  }catch{if(container.isConnected){container.textContent='COA reports are temporarily unavailable. Please contact support@getpurelabs.com for the exact product, strength and lot.';const count=document.getElementById('ap-coa-count');if(count)count.textContent='COA reports could not be loaded.';}}
  finally{if(container.isConnected)container.setAttribute('aria-busy','false');}
 }
 api.render=render;root.AltaSupplierCoas=api;
 document.addEventListener('input',e=>{if(e.target.id==='ap-coa-query'){const c=document.getElementById('ap-supplier-references');if(c)render(c,root.AltaStore?.catalog||[]);}});
 document.addEventListener('change',e=>{if(['ap-coa-product','ap-coa-size','ap-coa-supplier','ap-coa-lab'].includes(e.target.id)){const c=document.getElementById('ap-supplier-references');if(c)render(c,root.AltaStore?.catalog||[]);}});
 document.addEventListener('click',e=>{if(e.target.closest('#ap-coa-reset')){for(const id of ['ap-coa-query','ap-coa-product','ap-coa-size','ap-coa-supplier','ap-coa-lab']){const input=document.getElementById(id);if(input)input.value='';}const c=document.getElementById('ap-supplier-references');if(c)render(c,root.AltaStore?.catalog||[]);document.getElementById('ap-coa-query')?.focus();}});
})(typeof window==='undefined'?globalThis:window);
