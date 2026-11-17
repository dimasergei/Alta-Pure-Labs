(() => {
 'use strict';
 const node=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=String(text);return e;};
 const money=(v,c='USD')=>new Intl.NumberFormat('en-US',{style:'currency',currency:c}).format(v/100);
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 async function api(auth,body,mode='customer',id){
  const s=await auth.auth.getSession(),token=s.data?.session?.access_token;if(!token)throw Error('Sign in to continue.');
  const url=mode==='orders'?'/api/customer-config?commerce=customer'+(id?'&id='+encodeURIComponent(id):''):'/api/customer-config?checkout='+mode;
  const r=await fetch(url,{method:body?'POST':'GET',cache:'no-store',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const data=await r.json();if(!r.ok)throw Error(data.error||'The request could not be confirmed.');return data;
 }
 function paymentKind(method){return method?.native_provider==='rampex'&&method.rampex_provider==='hosted'?'card':method?.native_provider==='polygon_usdc'?'crypto':null;}
 function methodAvailable(method,country){return !!paymentKind(method)&&method.active!==false&&Array.isArray(method.countries)&&method.countries.includes(country);}
 async function openHostedPayment(auth,invoice,amount,currency,method,billing={}){
  const kind=paymentKind(method);if(!kind)throw Error('This payment route is unavailable for a new order.');
  if(kind==='crypto')return{url:'/pay.html?invoice='+encodeURIComponent(invoice)};
  const session=await auth.auth.getSession(),token=session.data?.session?.access_token;
  if(!token)throw Error('Sign in again to pay your saved order.');
  const response=await fetch('/api/checkout?native=customer&invoice='+encodeURIComponent(invoice),{
   method:'POST',cache:'no-store',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
   body:JSON.stringify({action:'pay',invoice_id:invoice,attempt_id:crypto.randomUUID(),
    confirm_amount_cents:amount,confirm_currency:currency,consent:true,
    crypto_conversion_consent:kind==='card',billing})
  });
  let payment;try{payment=await response.json();}catch{throw Error('Payment status could not be verified. Do not create a second order.');}
  if(!response.ok)throw Error(payment.error||'The provider could not confirm a payment link. Check your saved order before retrying.');
  if(payment.state==='paid')return{paid:true};
  if(payment.state!=='redirected'||!payment.redirect_url)throw Error('The payment link needs review. No second payment link will be created automatically.');
  let url;try{url=new URL(payment.redirect_url);}catch{throw Error('The provider returned an invalid payment destination.');}
  const trusted=url.origin==='https://checkout.rampex.io';
  if(!trusted||url.protocol!=='https:'||url.username||url.password||url.port||url.hash||url.pathname==='/'
   ||kind==='card'&&(url.searchParams.getAll('provider').length>1||url.searchParams.has('provider')&&url.searchParams.get('provider')!=='hosted'))
   throw Error('The provider returned an unexpected payment destination.');
  return{url:url.href};
 }
 function link(label,url){const a=node('a',label);a.href=url;a.className='ap-button ap-button-secondary';return a;}
 function summary(q){const box=node('section');box.className='dc-review-summary';box.append(node('span','FINAL TOTAL'));const totals=node('div');totals.className='dc-totals';
  const rows=[['Subtotal',q.subtotal_cents]];
  if(q.pricing?.coupon_discount_cents>0)rows.push(['BLACKFRIDAY15 (15%)',-q.pricing.coupon_discount_cents]);
  if(q.pricing?.crypto_discount_cents>0)rows.push(['Crypto discount (5%)',-q.pricing.crypto_discount_cents]);
  rows.push(['Delivery',q.shipping_cents],['Tax',q.tax_cents],['Points redeemed',-q.points_redeemed],['Store credit',-q.credit_redeemed_cents],['Due now',q.total_cents]);
  for(const [label,value] of rows){if(!value&&['Points redeemed','Store credit'].includes(label))continue;const row=node('div');row.className='dc-total-row'+(label==='Due now'?' dc-due':'');row.append(node('span',label),node('strong',money(value)));totals.append(row);}
  box.append(totals);if(q.pricing?.crypto_discount_suppressed_for_balance)box.append(node('p','The 5% crypto discount requires a remaining crypto payment. Your selected account balance covers the discounted total, so regular merchandise pricing applies. A valid coupon can still be used.'));if(q.pricing?.crypto_discount_eligible&&q.pricing?.discount_source==='coupon')box.append(node('p','BLACKFRIDAY15 gives the better discount: 15% off merchandise. The 5% crypto discount does not combine with it.'));if(q.pricing?.shipping_note)box.append(node('p',q.pricing.shipping_note));return box;
 }
 function cartSummary(cart){const box=node('aside');box.className='dc-summary';box.setAttribute('aria-label','Order summary');box.append(node('h2','Your order'));
  for(const item of cart){const row=node('div');row.className='dc-cart-item';const img=node('img');img.src=window.AltaStore.image(window.AltaStore.product(item.id),item.size);img.alt='';row.append(img);const label=node('div');label.append(node('strong',item.name),node('small',item.size+' · Qty '+item.qty));row.append(label,node('strong',money(Math.round(item.price*100)*item.qty)));box.append(row);}
  const estimate=node('div');estimate.className='dc-totals';estimate.innerHTML='<p role="status">Calculating your order total…</p>';box.append(estimate);return {box,estimate};
 }
 function checkoutSteps(form,root,data,cart){
  const original=[...form.querySelectorAll(':scope > .dc-section')],details=original[0],payment=original[1],review=original[2];
  const delivery=node('section');delivery.className='dc-section';delivery.innerHTML='<span class="dc-kicker">02 · Delivery</span><h2>Delivery method</h2>'+window.ReadinessUI.delivery(data,cart);
  details.after(delivery);review.querySelector('.dc-kicker')?.remove();review.querySelector('h2')?.remove();payment.append(...review.childNodes);review.remove();payment.querySelector('.dc-kicker').textContent='03 · Payment';
  const sections=[details,delivery,payment],labels=['Shipping','Delivery','Payment'];let current=0;
  const nav=node('nav');nav.className='dc-step-nav';nav.setAttribute('aria-label','Checkout steps');const buttons=labels.map((label,i)=>{const b=node('button');b.type='button';b.innerHTML='<span>'+(i+1)+'</span>'+label;b.onclick=()=>move(i);nav.append(b);return b;});root.querySelector('.dc-steps').replaceWith(nav);
  const invalid=section=>[...section.querySelectorAll('input,select,textarea')].find(e=>!e.checkValidity());
  function show(i){current=i;sections.forEach((s,n)=>s.hidden=n!==i);buttons.forEach((b,n)=>{b.setAttribute('aria-current',n===i?'step':'false');b.classList.toggle('dc-step-complete',n<i);});}
  function move(i){if(i>current){for(let n=current;n<i;n++){const bad=invalid(sections[n]);if(bad){show(n);bad.reportValidity();return;}}}show(i);}
  sections.forEach((section,i)=>{const actions=node('div');actions.className='dc-step-actions';if(i>0){const back=node('button','← Back');back.type='button';back.className='ap-button ap-button-secondary';back.onclick=()=>move(i-1);actions.append(back);}if(i<2){const next=node('button','Continue to '+labels[i+1]+' →');next.type='button';next.className='ap-button';next.dataset.stepNext=String(i);next.onclick=()=>move(i+1);actions.append(next);}section.append(actions);});
  form.noValidate=true;show(0);
  return {ready(){if(current<2){move(current+1);return false;}for(let i=0;i<sections.length;i++){const bad=invalid(sections[i]);if(bad){show(i);bad.reportValidity();return false;}}return true;}};
 }
 async function checkout(root,auth,user,options={}){
  try{
   const params=new URLSearchParams(location.search);if(params.has('plan')||params.has('period')){location.replace('/checkout');return;}
   const bulk=params.get('bulk')==='1',data=await api(auth),cart=bulk?window.AltaStore.normalizeLines(window.AltaStore.read('ap-bulk-draft-v2',[])):window.AltaStore?.cart||[];
   root.innerHTML='<div class="dc-topline"><a href="'+(bulk?'/bulk-orders':'/shop')+'">← Continue shopping</a><a href="/account/purchases">My orders</a></div><header class="dc-heading"><h1>Checkout</h1><p class="dc-steps">Your details &nbsp; / &nbsp; Review order &nbsp; / &nbsp; Payment</p></header>'; document.title='Checkout | PURE';
   if(!cart.length){root.append(node('p',bulk?'Your bulk order is empty.':'Your cart is empty.'),link(bulk?'Build a bulk order':'Shop products',bulk?'/bulk-orders':'/shop'));return;}
   const methods=data.methods.filter(method=>(method.sale_scope==='both'||method.sale_scope==='goods')&&paymentKind(method));
   const profile=user.user_metadata?.alta_profile||{},address=profile.shipping||{};
   const form=node('form');form.className='ap-form dc-form';
   form.innerHTML=`<section class="dc-section"><span class="dc-kicker">01 · Delivery details</span><h2>Where should we send your order?</h2><p>Free standard US shipping on merchandise orders of $150 after discounts. <a href="/account/profile">Manage saved details</a></p><div class="dc-fields"><label>Full name<input name="name" autocomplete="shipping name" maxlength="120" required value="${esc(address.name||user.user_metadata?.full_name||'')}"></label><label>Laboratory / organization (optional)<input name="organization" maxlength="180" autocomplete="shipping organization" value="${esc(address.organization||profile.organization||'')}"></label><label>Street address<input name="line1" autocomplete="shipping address-line1" required minlength="3" maxlength="180" value="${esc(address.line1||'')}"></label><label>Apartment, suite, etc. (optional)<input name="line2" autocomplete="shipping address-line2" maxlength="180" value="${esc(address.line2||'')}"></label><div class="ap-form-row"><label>City<input name="city" required minlength="2" maxlength="80" autocomplete="shipping address-level2" value="${esc(address.city||'')}"></label><label>State<input name="region" required maxlength="80" autocomplete="shipping address-level1" value="${esc(address.region||'')}"></label></div><div class="ap-form-row"><label>ZIP code<input name="postal_code" required minlength="2" maxlength="20" autocomplete="shipping postal-code" value="${esc(address.postal_code||'')}"></label><label>Country<select name="country" autocomplete="shipping country"><option value="US">United States</option></select></label></div><p class="dc-note"><a href="/shipping-policy.html">See delivery estimates and shipping details</a></p></div></section><section class="dc-section"><span class="dc-kicker">02 · Payment</span><h2>Choose how to pay</h2><p>Review the total before placing your order.</p>${['card','crypto'].map(kind=>{const method=methods.find(item=>paymentKind(item)===kind);return '<label class="dc-method"><input type="radio" name="method_id" data-payment-kind="'+kind+'" value="'+esc(method?.id||'')+'" '+(method?'':'disabled data-unavailable="true"')+' required><span><strong>'+(kind==='card'?'Card':'Crypto')+'</strong><small>'+(kind==='card'?'Secure card-to-crypto checkout. The provider displays fees, conversion rate and final charge before you pay. Cards and digital wallets depend on country, device and eligibility.':method?'Pay USDC directly on Polygon with a compatible browser wallet. You need POL for gas; verify the exact authorization before signing. Save 5% on merchandise, or use a better valid coupon. Discounts do not combine.':'SETUP PENDING — Direct USDC on Polygon becomes available after the receiving address and on-chain confirmation are verified.')+'</small></span></label>';}).join('')}</section><section class="dc-section"><span class="dc-kicker">03 · Review</span><h2>Finish your order</h2><div class="dc-coupon"><label>Coupon code (optional)<input name="coupon" maxlength="40" placeholder="BLACKFRIDAY15" autocomplete="off"></label><small>Use BLACKFRIDAY15 for 15% off merchandise.</small><div class="ap-actions"><button type="button" class="ap-button ap-button-secondary" data-dc-apply-coupon>Apply</button><button type="button" class="ap-button ap-button-secondary" data-dc-remove-coupon hidden>Remove</button></div><p data-dc-coupon-status role="status" aria-live="polite"></p></div><details class="dc-rewards"><summary>Use points or store credit</summary><p class="dc-note">Available: ${Math.max(0,data.balances.points)} points · ${money(data.balances.credit_cents)} store credit.</p><div class="ap-form-row"><label>Points to use<input name="points" type="number" min="0" step="1" max="${Math.max(0,data.balances.points)}" value="0"></label><label>Store credit (US$)<input name="credit" type="number" min="0" step="0.01" max="${(data.balances.credit_cents/100).toFixed(2)}" value="0"></label></div><p class="dc-note">100 points = US$1; minimum 100 points. Points apply to merchandise; credit can also cover delivery.</p></details><div class="dc-fields"><label>Order note (optional)<textarea name="note" rows="2" maxlength="1000"></textarea></label><label class="ap-checkbox-label"><input name="research_use" type="checkbox" required> I am 21 or older. Products are for controlled laboratory research only, not human or animal use.</label><label class="ap-checkbox-label"><input name="consent" type="checkbox" required><span>I agree to the <a href="/commercial-terms.html" target="_blank" rel="noopener">checkout terms</a>, <a href="/shipping-policy.html" target="_blank" rel="noopener">shipping policy</a> and <a href="/refund-policy.html" target="_blank" rel="noopener">refund policy</a>.</span></label><button type="submit" class="ap-button">Review order total →</button></div></section>`;
   const countries=data.config.shipping_countries||['US'],countryNames=new Intl.DisplayNames(['en'],{type:'region'});
   form.elements.country.innerHTML=countries.map(code=>({code,label:countryNames.of(code)||code})).sort((a,b)=>a.label.localeCompare(b.label)).map(({code,label})=>'<option value="'+esc(code)+'">'+esc(label)+'</option>').join('');
   const savedCountry=address.country||localStorage.getItem('ap-shipping-country');
   form.elements.country.value=countries.includes(savedCountry)?savedCountry:'US';
   const preferred=options.method||new URLSearchParams(location.search).get('method');
   function syncPaymentAvailability(){
    for(const control of form.querySelectorAll('[name=method_id]')){const method=methods.find(m=>m.id===control.value),available=methodAvailable(method,form.elements.country.value);control.disabled=!available;control.dataset.unavailable=String(!available);if(!available)control.checked=false;}
    if(!form.querySelector('[name=method_id]:checked')){const preferredControl=[...form.querySelectorAll('[name=method_id]')].find(control=>!control.disabled&&control.value===preferred)||form.querySelector('[name=method_id]:not(:disabled)');if(preferredControl)preferredControl.checked=true;}
   }
   syncPaymentAvailability();form.elements.country.addEventListener('change',syncPaymentAvailability);
   const {box:aside,estimate}=cartSummary(cart),layout=node('div');layout.className='dc-layout';
   const review=node('div'),status=node('p');status.className='dc-confirm-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');aside.append(review,status);layout.append(form,aside);root.append(layout);const steps=checkoutSteps(form,root,data,cart);window.ReadinessUI.enhanceCheckout(form,aside,auth,cart,data);
   let busy=false,body,nmiWidget=null,nmiLocked=false,lastFingerprint=sessionStorage.getItem('ap-checkout-fingerprint')||'',requestId=sessionStorage.getItem('ap-checkout-id')||crypto.randomUUID();sessionStorage.setItem('ap-checkout-id',requestId);
   form.addEventListener('input',()=>{if(!busy){nmiWidget?.destroy();nmiWidget=null;nmiLocked=false;review.replaceChildren();estimate.hidden=false;status.textContent='';}});
   form.onsubmit=async e=>{e.preventDefault();if(busy||form.dataset.couponPending==='true'||!steps.ready())return;busy=true;const button=form.querySelector('button[type="submit"]');button.disabled=true;status.textContent='Calculating your total…';
    try{
     const d=Object.fromEntries(new FormData(form));for(const control of form.elements)control.disabled=true;const request={kind:'goods',items:cart.map(({id,size,qty})=>({id,size,qty})),address:{line1:d.line1,line2:d.line2,city:d.city,region:d.region,postal_code:d.postal_code,country:d.country},research_use:d.research_use==='on',name:d.name,organization:d.organization,note:d.note,consent:d.consent==='on',method_id:d.method_id,points:Number(d.points||0),credit_cents:Math.round(Number(d.credit||0)*100),coupon:form.dataset.appliedCoupon||'',delivery:window.ReadinessUI.selection(form),checkout_version:data.config.version};
     const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(request))))).map(x=>x.toString(16).padStart(2,'0')).join('');if(lastFingerprint&&lastFingerprint!==fingerprint){requestId=crypto.randomUUID();sessionStorage.setItem('ap-checkout-id',requestId);}lastFingerprint=fingerprint;sessionStorage.setItem('ap-checkout-fingerprint',fingerprint);
     body={...request,id:requestId,action:'quote'};const q=await api(auth,body);estimate.hidden=true;review.replaceChildren(summary(q));review.scrollIntoView({behavior:'auto',block:'nearest'});status.textContent='Review the final total, then place your order.';
     const selected=methods.find(m=>m.id===body.method_id),kind=paymentKind(selected);
     if(!methodAvailable(selected,body.address.country))throw Error('This payment method is unavailable for your destination.');
     const place=node('button',q.total_cents===0?'Place order using account balance':kind==='card'?'Place order & pay by card':'Place order & pay with crypto');place.type='button';place.className='ap-button';review.append(place);
     if(kind==='card'){const note=node('p','Your order is priced in USD. The payment provider displays its fees, conversion rate and final charge before you pay. Identity verification and country or device restrictions may apply.');note.className='dc-note';review.append(note);}
     place.onclick=async()=>{if(busy)return;busy=true;place.disabled=true;button.disabled=true;for(const x of form.elements)x.disabled=true;status.textContent='Saving your order. Please wait…';
      let savedOrder;
      try{
       savedOrder=body.id;const result=await api(auth,{...body,action:'place',quote:q.quote});if(result.id!==savedOrder)throw Error('The saved order reference could not be verified.');
       let next='/account/purchases?id='+encodeURIComponent(result.id);
       if(q.total_cents>0){
        status.textContent=kind==='card'?'Opening secure card payment…':'Opening USDC wallet payment…';
        const payment=await openHostedPayment(auth,result.id,q.total_cents,q.currency,selected,{country:body.address.country});
        next=payment.paid?next:payment.url;
       }
       sessionStorage.removeItem('ap-checkout-id');sessionStorage.removeItem('ap-checkout-fingerprint');
       if(bulk){const current=window.AltaStore.normalizeLines(window.AltaStore.read('ap-bulk-draft-v2',[]));if(JSON.stringify(current.map(({id,size,qty})=>({id,size,qty})))===JSON.stringify(body.items))localStorage.removeItem('ap-bulk-draft-v2');}else{const current=window.AltaStore?.cart||[];if(JSON.stringify(current.map(({id,size,qty})=>({id,size,qty})))===JSON.stringify(body.items)){localStorage.removeItem('pp-cart');}}
       location.assign(next);
      }catch(err){
       status.replaceChildren();
       if(savedOrder){
        status.append(node('span','Order '+savedOrder+' was saved. '+err.message+' Do not submit a new order.'));
        status.append(document.createTextNode(' '));
        status.append(link('View saved order','/account/purchases?id='+encodeURIComponent(savedOrder)));
        place.textContent='CHECK SAVED ORDER';place.disabled=true;
        return;
       }else status.textContent=err.message+' Your checkout reference is '+requestId+'.';
       busy=false;place.disabled=false;button.disabled=false;for(const x of form.elements)x.disabled=x.dataset.unavailable==='true';
      }
     };
    }catch(err){status.textContent=err.message;}finally{busy=false;for(const control of form.elements)control.disabled=control.dataset.unavailable==='true';}
   };
  }catch(e){root.replaceChildren(node('p',e.message));}
 }
 async function orders(root,auth,user,options={}){
  root.replaceChildren(node('p','Loading orders…'));
  const compact=id=>'AP'+String(id||'').replace(/-/g,'').slice(0,10).toUpperCase();
  const state=s=>({accepted:'Awaiting payment',paid:'Paid',processing:'Processing',shipped:'Shipped',delivered:'Delivered',refunded:'Refunded',void:'Canceled',issued:'Payment pending',requested:'Under review'}[s]||String(s||'Pending'));
  try{
   const data=await api(auth,null,'orders',new URLSearchParams(location.search).get('id'));root.replaceChildren();
   const invoices=(data.invoices||[]).filter(r=>options.view==='tracking'?!!r.tracking_number||r.shipments?.some(s=>s.tracking_number):options.view==='pending'?['accepted','issued','requested'].includes(r.status):true);
   if(!invoices.length)root.append(node('p',options.view==='tracking'?'Tracking appears here when your order ships.':options.view==='pending'?'No orders are awaiting payment.':'No checkout orders yet.'));
   for(const r of invoices){
    const card=node('article');card.className='ap-panel dc-clean-order';
    const head=node('div');head.className='dc-clean-order-head';
    const left=node('div');left.append(node('h2','Order '+compact(r.id)),node('small',new Date(r.created_at).toLocaleString()));
    const right=node('div');right.className='dc-clean-order-right';right.append(node('strong',money(r.total_cents,r.currency)),node('span',state(r.status)));
    head.append(left,right);card.append(head);
    const items=node('div');items.className='dc-clean-items';
    for(const x of r.pricing?.lines||r.request_data?.items||[]){
     const item=node('div');item.append(node('span',(x.name||'Research item')+' · '+(x.size||'')+' × '+(x.qty||1)));
     if(Number.isSafeInteger(x.line_total_cents))item.append(node('strong',money(x.line_total_cents,r.currency)));
     items.append(item);
    }if(items.childElementCount)card.append(items);
    const detail=node('div');detail.className='dc-clean-meta';detail.append(node('span','Payment: '+state(r.status)));
    if(r.tracking_number)detail.append(node('span','Tracking: '+r.tracking_carrier+' '+r.tracking_number));
    if(r.status==='accepted')detail.append(node('span','Payment required before fulfillment'));
    card.append(detail);
    const actions=node('div');actions.className='dc-clean-actions';
    if(r.status==='accepted'&&r.payable&&r.payment_snapshot){
     const m=r.payment_snapshot;
     if(m.payment_url)actions.append(link('Pay securely',m.payment_url));
     else{actions.append(node('p',m.label+' · '+m.payee));const i=node('pre',m.instructions);i.style.whiteSpace='pre-wrap';actions.append(i);}
    }else if(r.status==='accepted'&&!r.payable)actions.append(node('p','Payment unavailable. Contact support or cancel this unpaid order.'));
    if(r.checkout_version&&r.status==='accepted'){
     const cancel=node('button','Cancel order'),out=node('p');cancel.type='button';cancel.className='ap-button ap-button-secondary';out.setAttribute('role','status');out.className='dc-cancel-feedback';
     cancel.onclick=async()=>{
      if(!window.confirm('Cancel '+compact(r.id)+'? Only continue if you have not paid. Any issued payment link may remain valid; do not use it after cancellation.'))return;
      cancel.disabled=true;try{const response=await api(auth,{action:'cancel',id:r.id,no_payment_sent:true});if(response.status!=='void')throw Error('Cancellation not confirmed.');await orders(root,auth,user,options);}catch(e){out.textContent=e.message;cancel.disabled=false;}
     };actions.append(cancel,out);
    }
    if(r.status==='void')actions.append(node('p','This order was canceled. No refund was automatically issued.'));
    card.append(actions);root.append(card);
   }
  }catch(e){root.replaceChildren(node('p',e.message));}
 }
 async function balance(root,auth,path){return window.ReadinessUI.balance(root,auth,path);}
 async function overview(root,auth,user){return window.ReadinessUI.overview(root,auth,user);}
 window.DirectCheckout={api,checkout,orders,balance,overview,openHostedPayment,paymentKind,methodAvailable};
})();
