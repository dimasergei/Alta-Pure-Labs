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
 async function openRampexPayment(auth,invoice,amount,currency){
  const session=await auth.auth.getSession(),token=session.data?.session?.access_token;
  if(!token)throw Error('Sign in again to pay your saved order.');
  const response=await fetch('/api/checkout?native=customer&invoice='+encodeURIComponent(invoice),{
   method:'POST',cache:'no-store',
   headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
   body:JSON.stringify({action:'pay',invoice_id:invoice,attempt_id:crypto.randomUUID(),
    confirm_amount_cents:amount,confirm_currency:currency,
    consent:true,crypto_conversion_consent:true})
  });
  let payment;try{payment=await response.json();}catch{throw Error('Payment status could not be verified. Do not create a second order.');}
  if(!response.ok)throw Error(payment.error||'Rampex could not create the payment link. Check your order before retrying.');
  if(payment.state==='paid')return{paid:true};
  if(payment.state!=='redirected'||!payment.redirect_url)
   throw Error('The payment link needs review. No second payment link will be created automatically.');
  let url;try{url=new URL(payment.redirect_url);}catch{throw Error('Rampex returned an invalid payment destination.');}
  if(url.origin!=='https://checkout.rampex.io'||url.username||url.password||url.hash||url.pathname==='/')
   throw Error('Rampex returned an unexpected payment destination.');
  return{url:url.href};
 }
 function link(label,url){const a=node('a',label);a.href=url;a.className='ap-button ap-button-secondary';return a;}
 function summary(q){const box=node('section');box.className='dc-review-summary';box.append(node('span','FINAL TOTAL'));const totals=node('div');totals.className='dc-totals';
  for(const [label,value] of [['Subtotal',q.subtotal_cents],['Discounts',-q.discount_cents],['Delivery',q.shipping_cents],['Tax',q.tax_cents],['Points redeemed',-q.points_redeemed],['Store credit',-q.credit_redeemed_cents],['Due now',q.total_cents]]){if(!value&&['Discounts','Points redeemed','Store credit'].includes(label))continue;const row=node('div');row.className='dc-total-row'+(label==='Due now'?' dc-due':'');row.append(node('span',label),node('strong',money(value)));totals.append(row);}
  if(q.pricing.bogo_free_units)box.append(node('p','BOGO: '+q.pricing.bogo_free_units+' free unit'+(q.pricing.bogo_free_units===1?'':'s')+' included in your ordered quantities.'));if(q.pricing.coupon_code)box.append(node('p','Coupon '+q.pricing.coupon_code+' applied.'));box.append(totals,node('p','Earn '+q.earned_points+' points when payment is confirmed.'));if(q.pricing.shipping_note)box.append(node('p',q.pricing.shipping_note));return box;
 }
 function cartSummary(cart,goods,plan,data){const box=node('aside');box.className='dc-summary';box.setAttribute('aria-label','Order summary');box.append(node('h2','Your order'));
  const lines=goods?cart:[{name:data.terms.memberships[plan].name,size:'365-day membership',qty:1,price:data.terms.memberships[plan].price_cents/100}];
  for(const x of lines){const row=node('div');row.className='dc-cart-item';if(goods){const img=node('img');img.src=window.AltaStore.image(window.AltaStore.product(x.id),x.size);img.alt='';row.append(img);}else row.append(node('span','365'));const label=node('div');label.append(node('strong',x.name),node('small',x.size+' · Qty '+x.qty));row.append(label,node('strong',money(Math.round(x.price*100)*x.qty)));box.append(row);}
  const estimate=node('div');estimate.className='dc-totals';estimate.innerHTML='<div class="dc-total-row"><span>Subtotal before discounts</span><strong>'+money(lines.reduce((sum,x)=>sum+Math.round(x.price*100)*x.qty,0))+'</strong></div><div class="dc-total-row"><span>Delivery</span><strong>'+(goods?'US$25.00':'Not required')+'</strong></div>';
  const note=node('p','Review your total to apply eligible discounts, points and store credit. All checkout amounts are in USD.');note.className='dc-note';estimate.append(note);box.append(estimate);return {box,estimate};
 }
 function checkoutSteps(form,root,goods,data){
  const original=[...form.querySelectorAll(':scope > .dc-section')],details=original[0],payment=original[1],review=original[2];
  const delivery=node('section');delivery.className='dc-section';delivery.innerHTML='<span class="dc-kicker">02 · '+(goods?'Delivery':'Membership')+'</span><h2>'+(goods?'Delivery method':'Your annual pass')+'</h2><div class="nl-delivery-option"><strong>'+(goods?'Standard US delivery · US$25.00':'365-day membership')+'</strong><p>'+(goods?esc(data.config.shipping_note):'Your pass starts after payment is confirmed. No automatic renewal.')+'</p></div>';
  if(goods)delivery.innerHTML='<span class="dc-kicker">02 · Delivery</span><h2>Delivery method</h2>'+window.ReadinessUI.delivery(data);
  details.after(delivery);review.querySelector('.dc-kicker')?.remove();review.querySelector('h2')?.remove();payment.append(...review.childNodes);review.remove();payment.querySelector('.dc-kicker').textContent='03 · Payment';
  const sections=[details,delivery,payment],labels=goods?['Shipping','Delivery','Payment']:['Details','Membership','Payment'];let current=0;
  const nav=node('nav');nav.className='dc-step-nav';nav.setAttribute('aria-label','Checkout steps');const buttons=labels.map((label,i)=>{const b=node('button');b.type='button';b.innerHTML='<span>'+(i+1)+'</span>'+label;b.onclick=()=>move(i);nav.append(b);return b;});root.querySelector('.dc-steps').replaceWith(nav);
  const invalid=section=>[...section.querySelectorAll('input,select,textarea')].find(e=>!e.checkValidity());
  function show(i){current=i;sections.forEach((s,n)=>s.hidden=n!==i);buttons.forEach((b,n)=>{b.setAttribute('aria-current',n===i?'step':'false');b.classList.toggle('dc-step-complete',n<i);});}
  function move(i){if(i>current){for(let n=current;n<i;n++){const bad=invalid(sections[n]);if(bad){show(n);bad.reportValidity();return;}}}show(i);}
  sections.forEach((section,i)=>{const actions=node('div');actions.className='dc-step-actions';if(i>0){const back=node('button','← Back');back.type='button';back.className='ap-button ap-button-secondary';back.onclick=()=>move(i-1);actions.append(back);}if(i<2){const next=node('button','Continue to '+labels[i+1]+' →');next.type='button';next.className='ap-button';next.dataset.stepNext=String(i);next.onclick=()=>move(i+1);actions.append(next);}section.append(actions);});
  form.noValidate=true;show(0);
  return {ready(){if(current<2){move(current+1);return false;}for(let i=0;i<sections.length;i++){const bad=invalid(sections[i]);if(bad){show(i);bad.reportValidity();return false;}}return true;}};
 }
 async function checkout(root,auth,user){
  try{
   const data=await api(auth),plan=new URLSearchParams(location.search).get('plan'),goods=!['vip','elite'].includes(plan),cart=window.AltaStore?.cart||[];
   root.innerHTML='<div class="dc-topline"><a href="/shop">← Continue shopping</a><a href="/account/purchases">My orders</a></div><header class="dc-heading"><h1>Checkout</h1><p class="dc-steps">Your details &nbsp; / &nbsp; Review order &nbsp; / &nbsp; Payment</p></header>'; document.title='Checkout | AltaPure Labs';
   if(goods&&!cart.length){root.append(node('p','Your cart is empty.'),link('Shop products','/shop'));return;}
   if(!goods&&data.membership){root.append(node('p','You already have an active '+data.membership.plan.toUpperCase()+' pass.'),link('View membership','/account/membership'));return;}
   const methods=data.methods.filter(m=>m.sale_scope==='both'||m.sale_scope===(goods?'goods':'membership'));
   if(!methods.length){root.append(node('p','No payment method is currently available for this purchase. Please contact the team.'),link('Contact','/contact'));return;}
   const profile=user.user_metadata?.alta_profile||{},address=profile.shipping||{};
   const form=node('form');form.className='ap-form dc-form';
   form.innerHTML=`<section class="dc-section"><span class="dc-kicker">01 · ${goods?'Delivery details':'Membership details'}</span><h2>${goods?'Where should we send your order?':data.terms.memberships[plan].name}</h2><p>${goods?'Standard US delivery · US$25 per order.':data.terms.memberships[plan].discount_bps/100+'% merchandise savings for 365 days. No automatic renewal.'} <a href="/account/profile">Manage saved details</a></p><div class="dc-fields"><label>Full name<input name="name" autocomplete="shipping name" maxlength="120" required value="${esc(address.name||user.user_metadata?.full_name||'')}"></label><label>Laboratory / organization (optional)<input name="organization" maxlength="180" autocomplete="shipping organization" value="${esc(address.organization||profile.organization||'')}"></label>${goods?'<label>Street address<input name="line1" autocomplete="shipping address-line1" required minlength="3" maxlength="180" value="'+esc(address.line1||'')+'"></label><label>Apartment, suite, etc. (optional)<input name="line2" autocomplete="shipping address-line2" maxlength="180" value="'+esc(address.line2||'')+'"></label><div class="ap-form-row"><label>City<input name="city" required minlength="2" maxlength="80" autocomplete="shipping address-level2" value="'+esc(address.city||'')+'"></label><label>State<input name="region" required maxlength="80" autocomplete="shipping address-level1" value="'+esc(address.region||'')+'"></label></div><div class="ap-form-row"><label>ZIP code<input name="postal_code" required minlength="2" maxlength="20" autocomplete="shipping postal-code" value="'+esc(address.postal_code||'')+'"></label><label>Country<select name="country" autocomplete="shipping country"><option value="US">United States</option></select></label></div><p class="dc-note">'+(address.country&&address.country!=='US'?'Your saved address is outside the United States. Enter a US delivery address to continue. ':'')+'<a href="/shipping-policy.html">See delivery estimates and shipping details</a></p>':''}</div></section><section class="dc-section"><span class="dc-kicker">02 · Payment</span><h2>Choose how to pay</h2><p>Review the total before placing your order.</p>${methods.map((m,i)=>'<label class="dc-method"><input type="radio" name="method_id" value="'+esc(m.id)+'" '+(i===0?'checked':'')+' required><span><strong>'+esc(m.label)+'</strong><small>'+(m.kind==='bank_transfer'?(goods?'Save an extra 5% on merchandise. ':'')+'Bank instructions appear after you place your order. Payment is confirmed before fulfillment.':['peptidepay','rampex'].includes(m.provider_key)?'Card-to-crypto checkout through the provider. Review its currency, fees and eligibility before paying.':'Continue to the secure payment form after placing your order.')+'</small></span></label>').join('')}</section><section class="dc-section"><span class="dc-kicker">03 · Review</span><h2>Finish your order</h2>${goods?'<label class="dc-coupon">Coupon code (optional)<input name="coupon" maxlength="40" placeholder="BOGO" autocomplete="off"><small>Buy 1, get 1 free on matching pairs. BOGO adds another 10% off merchandise.</small></label><details class="dc-rewards"><summary>Use points or store credit</summary><p class="dc-note">Available: '+Math.max(0,data.balances.points)+' points · '+money(data.balances.credit_cents)+' store credit.</p><div class="ap-form-row"><label>Points to use<input name="points" type="number" min="0" step="1" max="'+Math.max(0,data.balances.points)+'" value="0"></label><label>Store credit (US$)<input name="credit" type="number" min="0" step="0.01" max="'+(data.balances.credit_cents/100).toFixed(2)+'" value="0"></label></div><p class="dc-note">100 points = US$1; minimum 100 points. Points apply to merchandise; credit can also cover delivery.</p></details>':''}<div class="dc-fields"><label>Order note (optional)<textarea name="note" rows="2" maxlength="1000"></textarea></label>${goods?'<label class="ap-checkbox-label"><input name="research_use" type="checkbox" required> I am 21 or older. Products are for controlled laboratory research only, not human or animal use.</label>':''}<label class="ap-checkbox-label"><input name="consent" type="checkbox" required><span>I agree to the <a href="/commercial-terms.html" target="_blank" rel="noopener">checkout terms</a>, <a href="/shipping-policy.html" target="_blank" rel="noopener">shipping policy</a> and <a href="/refund-policy.html" target="_blank" rel="noopener">refund policy</a>.</span></label><button type="submit" class="ap-button">Review order total →</button></div></section>`;
   const preferred=new URLSearchParams(location.search).get('method');if(methods.some(m=>m.id===preferred))form.elements.method_id.value=preferred;
   const {box:aside,estimate}=cartSummary(cart,goods,plan,data),layout=node('div');layout.className='dc-layout';
   const review=node('div'),status=node('p');status.className='dc-confirm-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');aside.append(review,status);layout.append(form,aside);root.append(layout);const steps=checkoutSteps(form,root,goods,data);window.ReadinessUI.enhanceCheckout(form,aside,auth,goods?cart:[],data);
   let busy=false,body,lastFingerprint=sessionStorage.getItem('ap-checkout-fingerprint')||'',requestId=sessionStorage.getItem('ap-checkout-id')||crypto.randomUUID();sessionStorage.setItem('ap-checkout-id',requestId);
   form.addEventListener('input',()=>{if(!busy){review.replaceChildren();estimate.hidden=false;status.textContent='';}});
   form.onsubmit=async e=>{e.preventDefault();if(busy||!steps.ready())return;busy=true;const button=form.querySelector('button[type="submit"]');button.disabled=true;status.textContent='Calculating your total…';
    try{
     const d=Object.fromEntries(new FormData(form));for(const control of form.elements)control.disabled=true;const request={kind:goods?'goods':'membership',...(goods?{items:cart.map(({id,size,qty})=>({id,size,qty})),address:{line1:d.line1,line2:d.line2,city:d.city,region:d.region,postal_code:d.postal_code,country:d.country},research_use:d.research_use==='on'}:{plan}),name:d.name,organization:d.organization,note:d.note,consent:d.consent==='on',method_id:d.method_id,points:Number(d.points||0),credit_cents:Math.round(Number(d.credit||0)*100),coupon:d.coupon||'',delivery:window.ReadinessUI.selection(form),checkout_version:data.config.version};
     const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(request))))).map(x=>x.toString(16).padStart(2,'0')).join('');if(lastFingerprint&&lastFingerprint!==fingerprint){requestId=crypto.randomUUID();sessionStorage.setItem('ap-checkout-id',requestId);}lastFingerprint=fingerprint;sessionStorage.setItem('ap-checkout-fingerprint',fingerprint);
     body={...request,id:requestId,action:'quote'};const q=await api(auth,body);estimate.hidden=true;review.replaceChildren(summary(q));review.scrollIntoView({behavior:'auto',block:'nearest'});status.textContent='Review the final total, then place your order.';
     const selected=methods.find(m=>m.id===body.method_id),rampex=selected?.native_provider==='rampex'&&q.total_cents>0;
     const place=node('button',q.total_cents===0?'Place order using account balance':rampex?'Place order & pay by card':'Place order and continue to payment');place.type='button';place.className='ap-button';review.append(place);
     if(rampex){const note=node('p','One-time payment of the final total shown above. Secure card payment opens with Stripe via Rampex; provider fees and identity verification may apply.');note.className='dc-note';review.append(note);}
     place.onclick=async()=>{if(busy)return;busy=true;place.disabled=true;button.disabled=true;for(const x of form.elements)x.disabled=true;status.textContent='Saving your order. Please wait…';
      let savedOrder;
      try{
       const result=await api(auth,{...body,action:'place',quote:q.quote});savedOrder=result.id;
       let next='/account/purchases?id='+encodeURIComponent(result.id);
       if(rampex){
        status.textContent='Opening secure card payment…';
        const payment=await openRampexPayment(auth,result.id,q.total_cents,q.currency);
        next=payment.paid?next:payment.url;
       }else if(q.total_cents>0&&selected?.kind!=='bank_transfer')next='/pay.html?invoice='+encodeURIComponent(result.id);
       sessionStorage.removeItem('ap-checkout-id');sessionStorage.removeItem('ap-checkout-fingerprint');
       if(goods){const current=window.AltaStore?.cart||[];if(JSON.stringify(current.map(({id,size,qty})=>({id,size,qty})))===JSON.stringify(body.items))localStorage.removeItem('pp-cart');}
       location.assign(next);
      }catch(err){
       status.replaceChildren();
       if(savedOrder){
        status.append(node('span','Order '+savedOrder+' was saved. '+err.message+' Do not submit a new order.'));
        status.append(document.createTextNode(' '));
        status.append(link('View saved order','/account/purchases?id='+encodeURIComponent(savedOrder)));
        place.textContent='Continue payment for saved order';
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
 async function balance(root,auth,path){return window.ReadinessUI.balance(root,auth,path);
  try{const d=await api(auth),points=path.endsWith('points');root.replaceChildren(node('h2',points?d.balances.points+' points':money(d.balances.credit_cents)),node('p',points?'Earn 1 point per US$1 of paid merchandise after discounts and redemptions. Redeem 100 points for US$1; minimum 100 points. Shipping, taxes and memberships do not earn points.':'Issued USD store credit can be used for products and delivery. It is not cash and is not a gift-card balance.'),node('p','Redemptions are reserved when an order is placed. Cancelling an unpaid order or completing a full refund restores them. Refunds reverse earned points; a points debt is repaid by later earnings. No automatic expiry.'),link('Shop','/shop'),link('Pending orders','/account/purchases'),node('h3','Activity'));
   const events=d.events.filter(e=>e.asset===(points?'points':'credit'));if(!events.length)root.append(node('p','No activity yet.'));for(const e of events)root.append(node('p',new Date(e.created_at).toLocaleDateString()+' · '+e.reason+' · '+(e.delta>0?'+':'')+(points?e.delta:money(e.delta))));
  }catch(e){root.replaceChildren(node('p',e.message));}
 }
 async function overview(root,auth,user){return window.ReadinessUI.overview(root,auth,user);
  try{const [d,o]=await Promise.all([api(auth),api(auth,null,'orders')]);root.replaceChildren(node('h2','Welcome'+(user.user_metadata?.full_name?', '+user.user_metadata.full_name:'')),node('p',user.email),node('p',(d.membership?'Alta '+d.membership.plan.toUpperCase()+' · active until '+new Date(d.membership.expires_at).toLocaleDateString():'Free member account')),node('p',d.balances.points+' points · '+money(d.balances.credit_cents)+' store credit'),link('Points','/account/points'),link('Store credit','/account/store-credit'),link('Membership','/account/membership'),node('h3','Recent checkout orders'));
   if(!o.invoices.length)root.append(node('p','No checkout orders yet.'));for(const r of o.invoices.slice(0,5))root.append(link((r.checkout_version?'ORD-':'INV-')+r.id.slice(0,8).toUpperCase()+' · '+(r.status==='accepted'?'Awaiting payment':r.status),'/account/purchases?id='+r.id));
   root.append(link('All checkout orders','/account/purchases'),link('Earlier orders','/account/purchases?view=history'));
  }catch(e){root.replaceChildren(node('p',e.message));}
 }
 window.DirectCheckout={api,checkout,orders,balance,overview};
})();
