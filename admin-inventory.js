'use strict';
(() => {
 const form=document.getElementById('inventory-form');
 const password=document.getElementById('inventory-password');
 const status=document.getElementById('inventory-status');
 const content=document.getElementById('inventory-content');
 const lots=document.getElementById('inventory-lots');
 const reports=document.getElementById('inventory-reports');
 const make=(tag,text)=>{const e=document.createElement(tag);e.textContent=String(text??'');return e;};
 const renderRows=(target,items,fields)=>{
  target.replaceChildren();
  if(!items.length){const tr=make('tr');const td=make('td','No records available.');td.colSpan=fields.length;tr.append(td);target.append(tr);return;}
  for(const item of items){
   const tr=make('tr');
   for(const field of fields)tr.append(make('td',field(item)));
   target.append(tr);
  }
 };
 form.addEventListener('submit',async e=>{
  e.preventDefault();const button=form.querySelector('button');button.disabled=true;content.hidden=true;status.textContent='Loading records…';
  try{
   const response=await fetch('/api/admin-suppliers?inventory=1',{cache:'no-store',headers:{'x-admin-password':password.value}});
   if(!response.ok)throw Error(response.status===401?'Admin password not accepted.':'Inventory data unavailable.');
   const data=await response.json();
   if(!Array.isArray(data.lots)||!Array.isArray(data.quality_reports))throw Error('Invalid inventory response.');
   renderRows(lots,data.lots,[x=>x.sku_key,x=>x.lot_number,x=>x.fulfillment_site,x=>x.status,x=>x.on_hand,x=>x.reserved,x=>x.damaged]);
   renderRows(reports,data.quality_reports,[x=>x.report_id,x=>x.lab_name,x=>x.status,x=>x.publication_approved?'Approved':'Not published']);
   status.textContent=data.lots.length+' inventory lots and '+data.quality_reports.length+' quality reports loaded.';
   content.hidden=false;
  }catch(error){status.textContent=error.message;}
  finally{password.value='';button.disabled=false;}
 });
 const intakeForm=document.getElementById('intake-form');
 const intakeJson=document.getElementById('intake-json');
 const intakePassword=document.getElementById('intake-password');
 const intakeStatus=document.getElementById('intake-status');
 const intakeResults=document.getElementById('intake-results');
 const saveButton=document.getElementById('intake-save');
 const confirm=document.getElementById('intake-confirm');
 async function submitIntake(commit){
  intakeResults.replaceChildren();
  const button=intakeForm.querySelector('button[type="submit"]');
  button.disabled=true;saveButton.disabled=true;
  try{
   const rows=JSON.parse(intakeJson.value);
   if(!Array.isArray(rows)||rows.length!==1)throw Error('Enter a JSON array containing exactly one lot.');
   if(commit&&!confirm.checked)throw Error('Confirm quarantine-only import before saving.');
   const response=await fetch('/api/admin-suppliers',{method:'POST',cache:'no-store',
    headers:{'x-admin-password':intakePassword.value,'content-type':'application/json'},
    body:JSON.stringify({action:commit?'commit_inventory_intake':'preview_inventory_import',
      confirm_quarantine_only:commit&&confirm.checked,rows})});
   const result=await response.json();
   if(!response.ok&&response.status===401)throw Error('Admin password not accepted.');
   if(!response.ok&&response.status>=500)throw Error('Inventory service unavailable.');
   intakeStatus.textContent=result.saved?'One lot saved in quarantine. Not available for sale.':
    (result.accepted?.length||0)+' valid for quarantine; '+(result.rejected?.length||0)+' rejected. Nothing saved.';
   for(const rejection of result.rejected||[]){
    intakeResults.append(make('p','Row '+(rejection.index+1)+': '+rejection.reason));
   }
   if(result.saved){intakeJson.value='';confirm.checked=false;}
  }catch(error){intakeStatus.textContent=error.message;}
  finally{intakePassword.value='';button.disabled=false;saveButton.disabled=false;}
 }
 if(intakeForm)intakeForm.addEventListener('submit',event=>{event.preventDefault();submitIntake(false);});
 if(saveButton)saveButton.addEventListener('click',()=>submitIntake(true));
 const coaForm=document.getElementById('coa-intake-form');
 if(coaForm)coaForm.addEventListener('submit',async event=>{
  event.preventDefault();
  const field=id=>document.getElementById(id);
  const pass=field('coa-admin-password'),out=field('coa-intake-status');
  const button=coaForm.querySelector('button');button.disabled=true;
  try{
   const report={
    lot_id:field('coa-lot-id').value.trim(),
    report_id:field('coa-report-id').value.trim(),
    lab_name:field('coa-lab-name').value.trim(),
    source_url:field('coa-source-url').value.trim()
   };
   const response=await fetch('/api/admin-suppliers',{method:'POST',cache:'no-store',
    headers:{'x-admin-password':pass.value,'content-type':'application/json'},
    body:JSON.stringify({action:'intake_supplier_coa_reference',report})});
   const result=await response.json();
   if(!response.ok)throw Error(response.status===401?'Admin password not accepted.':
    'Reference not saved: '+String(result.reason||'Validation failed'));
   out.textContent='Reference recorded as PENDING and UNPUBLISHED. No COA verified.';
   coaForm.reset();
  }catch(error){out.textContent=error.message;}
  finally{pass.value='';button.disabled=false;}
 });
 const reviewForm=document.getElementById('coa-review-form');
 if(reviewForm)reviewForm.addEventListener('submit',async event=>{
  event.preventDefault();
  const field=id=>document.getElementById(id);
  const pass=field('coa-review-password'),out=field('coa-review-status');
  const button=reviewForm.querySelector('button');button.disabled=true;
  try{
   if(!field('coa-review-confirm').checked)throw Error('Confirmation required.');
   const action=field('coa-review-action').value;
   const response=await fetch('/api/admin-suppliers',{method:'POST',cache:'no-store',
    headers:{'x-admin-password':pass.value,'content-type':'application/json'},
    body:JSON.stringify({
      action:action==='reject'?'review_coa_reject':'review_coa_withdraw',
      report_id:field('coa-review-id').value.trim(),
      reason:field('coa-review-reason').value.trim()
    })});
   const result=await response.json();
   if(!response.ok)throw Error(response.status===401?'Admin password not accepted.':
    'Report unchanged: '+String(result.reason||'Request rejected'));
   out.textContent='Report status changed to '+result.report.status+'. Publication revoked. Audit reference: '+String(result.review_reference||'unavailable')+'.';
   reviewForm.reset();
  }catch(error){out.textContent=error.message;}
  finally{pass.value='';button.disabled=false;}
 });
})();