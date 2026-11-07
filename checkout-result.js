(async()=>{
const el=document.querySelector('#status'), id=new URLSearchParams(location.search).get('session_id');
if(!id){el.textContent='Missing checkout reference.';return;}
for(let i=0;i<12;i++){
  try{const r=await fetch('/api/order-status?session_id='+encodeURIComponent(id));if(!r.ok)throw new Error();const data=await r.json();
  if(data.status==='paid'){el.textContent='Test payment verified and order saved. Total: '+new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(data.total_cents/100)+'.';return;}
  if(['failed','expired'].includes(data.status)){el.textContent='Checkout '+data.status+'. Your cart has been retained.';return;}
  }catch(e){}
  await new Promise(r=>setTimeout(r,2000));
}
el.textContent='Payment confirmation is still pending. Check Stripe and Supabase before retrying. Your cart has been retained.';
})();
