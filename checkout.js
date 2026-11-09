(() => {
  const form=document.querySelector('#checkout-form');
  if(!form) return;
  // Default to disabled, including while availability is loading or unreachable.
  window.AltaCheckoutEnabled = false;
  const reviewButton=document.querySelector('#checkout');
  if(!reviewButton)return;
  const originalReviewMarkup=reviewButton.innerHTML;
  const pausedCopy={
    en:{button:'Checkout temporarily unavailable',notice:'Online ordering is paused while we update payment options.'},
    fr:{button:'Paiement temporairement indisponible',notice:'Les commandes en ligne sont suspendues pendant la mise à jour des modes de paiement.'},
    es:{button:'Pago temporalmente no disponible',notice:'Los pedidos en línea están suspendidos mientras actualizamos los métodos de pago.'}
  };
  const availabilityNotice=document.createElement('p');
  availabilityNotice.id='checkout-availability';
  availabilityNotice.className='fine';
  availabilityNotice.setAttribute('role','status');
  reviewButton.insertAdjacentElement('afterend',availabilityNotice);
  const announce=document.querySelector('.announce');
  const pageNotice=document.createElement('p');
  pageNotice.id='checkout-paused-banner';
  pageNotice.setAttribute('role','status');
  pageNotice.hidden=true;
  if(announce)announce.append(pageNotice);
  const formSubmit=form.querySelector('[type="submit"]');
  const showAvailability=()=>{
    const enabled=window.AltaCheckoutEnabled===true;
    reviewButton.disabled=!enabled || !state.cart.length;
    if(formSubmit)formSubmit.disabled=!enabled;
    if(enabled){
      reviewButton.innerHTML=originalReviewMarkup;
      availabilityNotice.textContent='';
      pageNotice.hidden=true;
    }else{
      const lang=window.AltaLocale?.language || 'en';
      const copy=pausedCopy[lang]||pausedCopy.en;
      reviewButton.textContent=copy.button;
      availabilityNotice.textContent=copy.notice;
      pageNotice.textContent=copy.notice;
      pageNotice.hidden=false;
    }
  };
  showAvailability();
  if(window.AltaLocale?.onChange)window.AltaLocale.onChange(showAvailability);
  fetch('/api/checkout-status',{cache:'no-store'})
    .then(response=>response.ok?response.json():null)
    .then(result=>{window.AltaCheckoutEnabled=result?.enabled===true;showAvailability();})
    .catch(()=>{window.AltaCheckoutEnabled=false;showAvailability();});
  const message=document.createElement('p'); message.setAttribute('role','status'); form.append(message);
  const showShipping=()=>{
    const summary=document.querySelector('#checkout-summary');
    if(summary) {const p=summary.querySelector('p.fine'); if(p)p.textContent='USD. US shipping: $25 per order, added at checkout.';}
  };
  document.querySelector('#checkout').addEventListener('click',showShipping);
  let busy=false;
  form.addEventListener('submit',async event=>{
    event.preventDefault();event.stopImmediatePropagation();
    if(window.AltaCheckoutEnabled!==true){
      message.textContent='Online checkout is currently unavailable.';
      return;
    }
    if(busy||!form.reportValidity())return;
    busy=true;const button=form.querySelector('[type="submit"]');button.disabled=true;message.textContent='Opening secure Stripe checkout…';
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
