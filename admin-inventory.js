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
 if(intakeForm)intakeForm.addEventListener('submit',async event=>{
  event.preventDefault();intakeResults.replaceChildren();
  const button=intakeForm.querySelector('button');button.disabled=true;
  try{
   const rows=JSON.parse(intakeJson.value);
   if(!Array.isArray(rows)||rows.length<1||rows.length>100)throw Error('Enter a JSON array of 1 to 100 records.');
   const response=await fetch('/api/admin-suppliers',{method:'POST',cache:'no-store',
    headers:{'x-admin-password':intakePassword.value,'content-type':'application/json'},
    body:JSON.stringify({action:'preview_inventory_import',rows})});
   if(!response.ok)throw Error(response.status===401?'Admin password not accepted.':'Inventory preview unavailable.');
   const result=await response.json();
   intakeStatus.textContent=(result.accepted?.length||0)+' accepted for quarantine preview; '+
    (result.rejected?.length||0)+' rejected. Nothing saved.';
   for(const rejection of result.rejected||[]){
    intakeResults.append(make('p','Row '+(rejection.index+1)+': '+rejection.reason));
   }
  }catch(error){intakeStatus.textContent=error.message;}
  finally{intakePassword.value='';button.disabled=false;}
 });
})();