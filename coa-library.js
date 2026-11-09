'use strict';
(() => {
  const search=document.getElementById('coa-search');
  const results=document.getElementById('coa-results');
  const count=document.getElementById('coa-count');
  if(!search||!results||!count)return;
  let reports=[];
  function element(tag,text){const e=document.createElement(tag);e.textContent=String(text??'');return e;}
  function render(){
    const query=search.value.trim().toLocaleLowerCase();
    const matches=reports.filter(r=>[r.product_id,r.sku_key,r.lot,r.lab_name,r.report_id].some(v=>String(v).toLocaleLowerCase().includes(query)));
    results.replaceChildren();
    count.textContent=matches.length+' verified certificate'+(matches.length===1?'':'s')+' available';
    if(!matches.length){
      const empty=element('p',reports.length?'No matching verified certificates.':'No verified certificates have been published yet.');
      empty.className='coa-empty';results.append(empty);return;
    }
    for(const r of matches){
      const card=document.createElement('article');card.className='coa-card';
      card.append(element('p','Verified batch record'),element('h2',r.sku_key));
      const dl=document.createElement('dl');
      for(const [label,value] of [['Lot',r.lot],['Laboratory',r.lab_name],['Report',r.report_id],['Report date',r.report_date]]){
        dl.append(element('dt',label),element('dd',value));
      }
      card.append(dl);
      const link=document.createElement('a');link.href=r.document_url;link.textContent='View report';link.target='_blank';link.rel='noopener noreferrer';card.append(link);
      if(r.verification_url){const verify=document.createElement('a');verify.href=r.verification_url;verify.textContent='Verify with laboratory';verify.target='_blank';verify.rel='noopener noreferrer';card.append(verify);}
      results.append(card);
    }
  }
  search.addEventListener('input',render);
  fetch('/data/verified-coas.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('Unavailable');return r.json();}).then(data=>{
    if(!Array.isArray(data))throw Error('Invalid registry');
    // Published registry is curated server-side; fail closed for unknown states.
    reports=data.filter(r=>r&&r.status==='verified'&&r.publication_approved===true&&
      typeof r.document_url==='string'&&/^https:\/\/altapurelabs\.com\//.test(r.document_url)&&
      typeof r.sku_key==='string'&&typeof r.lot==='string'&&typeof r.report_id==='string');
    render();
  }).catch(()=>{count.textContent='Certificate library temporarily unavailable.';results.replaceChildren(element('p','Please check back later.'));});
})();
