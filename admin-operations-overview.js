'use strict';
(() => {
 const form=document.getElementById('overview-login'),input=document.getElementById('admin-secret'),button=document.getElementById('refresh');
 const status=document.getElementById('overview-status'),panel=document.getElementById('overview-results'),metrics=document.getElementById('overview-metrics'),updated=document.getElementById('overview-updated');
 if(!form||!input||!button||!status||!panel||!metrics)return;
 const labels={
  orders_total:'Total order records',orders_paid:'Orders marked paid',orders_unfulfilled:'Orders unfulfilled',
  orders_processing:'Orders processing',orders_shipped:'Orders marked shipped',orders_delivered:'Orders marked delivered',
  suppliers_total:'Supplier records',suppliers_active:'Active suppliers',
  supplier_batches_total:'Supplier batch records',notifications_total:'Notification records'
 };
 form.addEventListener('submit',async e=>{
  e.preventDefault();panel.hidden=true;metrics.replaceChildren();button.disabled=true;status.textContent='Loading live counts…';
  try{
   const response=await fetch('/api/admin-suppliers?overview=1',{method:'GET',cache:'no-store',headers:{'x-admin-password':input.value}});
   if(!response.ok)throw Error(response.status===401?'Admin password not accepted.':'Operational data is temporarily unavailable.');
   const data=await response.json();
   if(!data||typeof data.counts!=='object')throw Error('Invalid response.');
   for(const [key,label] of Object.entries(labels)){
    const value=data.counts[key];
    if(!Number.isSafeInteger(value)||value<0)continue;
    const card=document.createElement('article');card.className='metric';
    const number=document.createElement('strong');number.textContent=String(value);
    const caption=document.createElement('span');caption.textContent=label;
    card.append(number,caption);metrics.append(card);
   }
   updated.textContent='Generated: '+new Date(data.generated_at).toLocaleString()+' · Checkout '+(data.checkout_enabled?'enabled':'paused');
   status.textContent='Operational snapshot loaded.';panel.hidden=false;
  }catch(error){status.textContent=error.message;}
  finally{input.value='';button.disabled=false;}
 });
})();