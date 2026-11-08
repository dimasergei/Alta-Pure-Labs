(() => {
  const form=document.querySelector('#checkout-form');
  if(!form) return;
  const message=document.createElement('p'); message.setAttribute('role','status'); form.append(message);
  const showShipping=()=>{
    const summary=document.querySelector('#checkout-summary');
    if(summary) {const p=summary.querySelector('p.fine'); if(p)p.textContent='USD. US shipping: $25 per order, added at checkout. Test mode only.';}
  };
  document.querySelector('#checkout').addEventListener('click',showShipping);
  let busy=false;
  form.addEventListener('submit',async event=>{
    event.preventDefault();event.stopImmediatePropagation();
    if(busy||!form.reportValidity())return;
    busy=true;const button=form.querySelector('[type="submit"]');button.disabled=true;message.textContent='Opening secure test checkout…';
    try{
      const data=new FormData(form);
      const headers={'Content-Type':'application/json'};
      if(window.supabase?.createClient){const cr=await fetch('/api/customer-config',{cache:'no-store'});if(cr.ok){const cfg=await cr.json();const auth=window.supabase.createClient(cfg.supabaseUrl,cfg.anonKey,{auth:{persistSession:true,autoRefreshToken:true}});const {data:s}=await auth.auth.getSession();if(s.session?.access_token)headers.Authorization='Bearer '+s.session.access_token;}}
      const response=await fetch('/api/checkout',{method:'POST',headers,body:JSON.stringify({name:data.get('name'),email:data.get('email'),org:data.get('org'),research:data.get('research')==='on',items:state.cart.map(i=>({id:i.id,size:i.size,qty:i.qty}))})});
      const result=await response.json(); if(!response.ok)throw new Error(result.error||'Checkout failed.');
      const url=new URL(result.url);if(url.protocol!=='https:'||url.hostname!=='checkout.stripe.com')throw new Error('Unexpected checkout address.');
      location.assign(url.href);
    }catch(e){message.textContent=e.message;button.disabled=false;busy=false;}
  },true);
})();
