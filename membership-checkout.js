(()=>{
 'use strict';
 const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
 const money=(value,currency='USD')=>new Intl.NumberFormat('en-US',{style:'currency',currency,currencyDisplay:'code'}).format(value/100);
 const field=(label,name,value='',attributes='')=>'<label>'+label+'<input name="'+name+'" value="'+esc(value)+'" '+attributes+'></label>';
 function offer(root,quote,config){
  if(!root)return;
  const membership=quote?.membership,details=quote?.pricing;
  if(membership){
   root.hidden=false;root.innerHTML='<div class="pm-offer pm-offer-active"><span class="pm-eyebrow">MEMBER BENEFITS</span><h3>'+esc(membership.name||config.plans[membership.plan]?.name)+'</h3><p>'+esc(details?.membership_discount_cents>0?money(details.membership_discount_cents,quote.currency)+' membership savings applied.':'Your best eligible merchandise discount is applied.')+'</p><p>'+Number(quote.earned_points||0)+' points on this order after payment.'+(details?.membership_benefits?.free_bac_water_3ml?' Complimentary BAC Water 3 mL included.':'')+'</p><a href="/account/membership">View your membership</a></div>';return;
  }
  if(!config?.memberships_enabled||!quote?.membership_offer||sessionStorage.getItem('pure-membership-offer-dismissed')==='1'){root.hidden=true;return;}
  const tier=config.plans.vip,potential=quote.membership_offer.plans.vip;
  root.hidden=false;root.innerHTML='<div class="pm-offer"><span class="pm-eyebrow">PURE WHITE MEMBERSHIP</span><h3>'+(potential.total_savings_cents>0?'Unlock '+esc(money(potential.total_savings_cents,quote.currency))+' on this order':'More from every research order')+'</h3><p>5% off eligible merchandise, free US standard or express shipping, and 5 points per US$1.</p><p class="pm-small">The better of your member discount or coupon applies. Membership purchase: '+esc(money(tier.monthly_cents))+' for one month. Benefits start after payment is confirmed.</p><a class="ap-button" href="/checkout?plan=vip&period=monthly">Join PURE WHITE · '+esc(money(tier.monthly_cents))+'</a><div class="pm-offer-links"><a href="/memberships">Compare plans</a><button type="button" data-pm-dismiss>No thanks</button></div></div>';
  root.querySelector('[data-pm-dismiss]').onclick=()=>{sessionStorage.setItem('pure-membership-offer-dismissed','1');root.hidden=true;};
 }
 async function checkout(root,auth,user,options={}){
  let busy=false,savedId=null,quote=null,request=null,requestId=null,previousFingerprint=null,revision=0,quotedRevision=null,quotedFingerprint=null;
  const navigate=options.navigate||((href)=>location.assign(href));
  const api=window.DirectCheckout.api,kind=window.DirectCheckout.paymentKind;
  try{
   const data=await api(auth),config=data.terms.conversion,params=new URLSearchParams(location.search),plan=params.get('plan'),period=params.get('period')||'monthly';
   if(!['vip','elite'].includes(plan)||!['monthly','annual'].includes(period)||!config.memberships_enabled)throw Error('Choose a current PURE membership plan.');
   const tier=config.plans[plan];document.title=tier.name+' Checkout | PURE';
   if(data.membership){root.innerHTML='<section class="pm-checkout pm-already"><span class="pm-eyebrow">YOUR MEMBERSHIP</span><h1>'+esc(data.membership.name)+'</h1><p>Your membership is already active through '+esc(new Date(data.membership.expires_at).toLocaleDateString())+'.</p><p>You can purchase a new term after it expires. Your current cart is ready whenever you are.</p><div class="pm-actions"><a class="ap-button" href="/checkout">Continue your cart</a><a class="ap-button ap-button-secondary" href="/account/membership">View benefits</a></div></section>';return;}
   if(data.membership_pending){
    const pending=data.membership_pending,name=pending.name||window.PureMemberships.displayName(pending.plan),needsReview=pending.expired===true||pending.requires_review===true;
    const amount=Number.isSafeInteger(pending.total_cents)&&pending.total_cents>0&&['USD','CAD'].includes(pending.currency)?money(pending.total_cents,pending.currency):null;
    root.innerHTML='<section class="pm-checkout pm-pending"><span class="pm-eyebrow">MEMBERSHIP PAYMENT</span><h1>'+esc(name)+'</h1><span class="pm-pending-badge">'+(needsReview?'Needs attention':'Awaiting payment')+'</span><p>'+esc(amount?amount+' · ':'')+(pending.billing_period==='annual'?'One-year membership term.':'One-month membership term.')+'</p>'+(needsReview?'<p><strong>Unpaid membership needs attention.</strong> Open your saved order to check its status. If you have not sent payment, cancel the unpaid order before starting again. If you sent payment, contact PURE so it can be checked.</p>':'<p>Your membership purchase is already saved. Continue its payment to activate your benefits. Your product cart stays saved.</p>')+'<div class="pm-actions"><a class="ap-button" href="/account/purchases'+(pending.invoice_id?'?id='+encodeURIComponent(pending.invoice_id):'')+'">'+(needsReview?'Review membership order':'Continue payment')+'</a><a class="ap-button ap-button-secondary" href="/account/membership">View membership</a></div></section>';return;
   }
   const profile=user.user_metadata?.alta_profile||{},address=profile.shipping||{},countries=data.config.shipping_countries||['US'],countryNames=new Intl.DisplayNames(['en'],{type:'region'});
   const methods=(data.methods||[]).filter(method=>['membership','both'].includes(method.sale_scope)&&kind(method));
    // Automatic direct-card mandates have no verified processor and remain disabled; hosted card and Crypto are one-time invoices.
   root.innerHTML='<section class="pm-checkout"><a class="pm-back" href="/memberships">← Compare memberships</a><header><span class="pm-eyebrow">PURE MEMBERSHIP</span><h1>Make it '+(plan==='vip'?'WHITE.':'BLACK.')+'</h1><p>One membership. A clearer way to order.</p></header><div class="pm-checkout-grid"><form class="pm-form" data-pm-form><fieldset class="pm-terms"><legend>Your membership term</legend>'+['monthly','annual'].map(value=>'<label><input type="radio" name="period" value="'+value+'" '+(period===value?'checked':'')+'><span><strong>'+ (value==='monthly'?'One month':'One year')+'</strong><small>'+esc(money(tier[value+'_cents']))+(value==='annual'?' · Save 20%':'')+'</small></span></label>').join('')+'</fieldset><section><h2>Billing details</h2><div class="pm-fields">'+field('Full name','name',address.name||user.user_metadata?.full_name,'autocomplete="name" required maxlength="120"')+field('Organization (optional)','organization',profile.organization,'autocomplete="organization" maxlength="180"')+field('Street address','line1',address.line1,'autocomplete="billing address-line1" required minlength="3" maxlength="180"')+field('Apartment / suite (optional)','line2',address.line2,'autocomplete="billing address-line2" maxlength="180"')+field('City','city',address.city,'autocomplete="billing address-level2" required minlength="2" maxlength="80"')+field('State / province','region',address.region,'autocomplete="billing address-level1" required maxlength="80"')+field('ZIP / postal code','postal_code',address.postal_code,'autocomplete="billing postal-code" required minlength="2" maxlength="20"')+'<label>Country<select name="country" autocomplete="billing country">'+countries.map(code=>({code,label:countryNames.of(code)||code})).sort((a,b)=>a.label.localeCompare(b.label)).map(({code,label})=>'<option value="'+code+'">'+esc(label)+'</option>').join('')+'</select></label></div></section><fieldset class="pm-payment"><legend>Choose how to pay</legend>'+methods.map(method=>'<label data-pm-method="'+esc(method.id)+'"><input type="radio" name="method_id" value="'+esc(method.id)+'" required><span><strong>'+esc(method.label)+(method.currency==='CAD'?' · CAD':' · USD')+'</strong><small>'+esc(kind(method)==='interac'?'Your exact CAD total appears before you place the order. Send an Interac e-Transfer using the details shown afterward.':kind(method)==='card'?'Secure card-to-crypto checkout. Review the provider’s fees, conversion rate and final charge before paying.':'Pay USDC on Polygon from your wallet. Membership fees are charged at their stated price.')+'</small></span></label>').join('')+'<p data-pm-method-note role="status"></p></fieldset><label class="pm-consent"><input type="checkbox" name="consent" required><span>I agree to the <a href="/membership-terms.html" target="_blank" rel="noopener">membership terms</a>. This is one prepaid term with no automatic renewal. Benefits activate after payment is verified.</span></label><button class="ap-button" type="submit">Review membership total</button><p class="pm-small">Your product cart stays saved. Coupons, rewards and account credit apply to eligible products, not membership fees.</p></form><aside class="pm-checkout-summary '+(plan==='elite'?'pm-black':'')+'" aria-label="Membership order summary"><span class="pm-eyebrow">YOUR PLAN</span><h2>'+esc(tier.name)+'</h2><div data-pm-term-price></div><ul>'+window.PureMemberships.benefits(config,plan).map(value=>'<li>'+esc(value.text)+'</li>').join('')+'</ul><div data-pm-review></div><p data-pm-status role="status" aria-live="polite"></p></aside></div></section>';
   const form=root.querySelector('[data-pm-form]'),review=root.querySelector('[data-pm-review]'),status=root.querySelector('[data-pm-status]');
   form.elements.country.value=countries.includes(address.country)?address.country:'US';
   function termPrice(){const term=form.elements.period.value;root.querySelector('[data-pm-term-price]').innerHTML='<strong class="pm-fee">'+esc(money(tier[term+'_cents']))+'</strong><p>One prepaid '+(term==='annual'?'year':'month')+' · no automatic renewal</p>';}
   function paymentAvailability(){
    for(const input of form.querySelectorAll('[name=method_id]')){const method=methods.find(item=>item.id===input.value),available=method.countries?.includes(form.elements.country.value);input.disabled=busy||!available;input.closest('label').hidden=!available;if(!available)input.checked=false;}
    if(!form.querySelector('[name=method_id]:checked')){const first=form.querySelector('[name=method_id]:not(:disabled)');if(first)first.checked=true;}
    const selected=form.querySelector('[name=method_id]:checked');
    form.querySelector('[data-pm-method-note]').textContent=selected?'':'No supported payment method is currently available for this country.';
    form.querySelector('[type=submit]').disabled=busy||!selected;
   }
   function capture(){
    const values=form.elements;
    return {kind:'membership',plan,billing_period:values.period.value,name:values.name.value,organization:values.organization.value||'',address:{line1:values.line1.value,line2:values.line2.value||'',city:values.city.value,region:values.region.value,postal_code:values.postal_code.value,country:values.country.value},consent:values.consent.checked,method_id:values.method_id?.value||'',points:0,credit_cents:0,coupon:'',checkout_version:data.config.version};
   }
   function invalidate(){if(savedId)return;revision++;if(busy)return;quote=null;request=null;quotedRevision=null;quotedFingerprint=null;review.replaceChildren();status.textContent='';termPrice();}
   function lock(){busy=true;for(const element of form.elements)element.disabled=true;}
   function unlock(){busy=false;for(const element of form.elements)element.disabled=false;paymentAvailability();termPrice();}
   function showQuote(){review.innerHTML='<div class="pm-final"><span>Total due · '+quote.currency+'</span><strong>'+esc(money(quote.total_cents,quote.currency))+'</strong><p>'+(quote.currency==='CAD'?'Pay this exact CAD amount by Interac.':'The provider displays any payment fees before you pay.')+'</p><button type="button" class="ap-button'+(plan==='elite'?' ap-button-light':'')+'" data-pm-place>Purchase '+esc(tier.name)+'</button></div>';review.querySelector('[data-pm-place]').onclick=place;}
   async function place(){
    if(busy||savedId||!quote||!request)return;
    if(quotedRevision!==revision||quotedFingerprint!==JSON.stringify(capture())){invalidate();status.textContent='Your details changed. Review your membership total again before purchasing.';return;}
    lock();review.querySelector('button').disabled=true;status.textContent='Checking your membership total…';
    let mayHaveSaved=false;
    try{
     const method=methods.find(item=>item.id===request.method_id);
     if(kind(method)==='interac'){
      const fresh=await api(auth,{...request,action:'quote',fx_quote:quote.fx_quote});
      if(fresh.currency!=='CAD'||!fresh.fx_quote||!fresh.quote)throw Error('Your CAD total could not be verified.');
      const changed=fresh.total_cents!==quote.total_cents||fresh.pricing.fx_ppm!==quote.pricing.fx_ppm;
      quote=fresh;request.fx_quote=fresh.fx_quote;
      if(changed){showQuote();status.textContent='The CAD total changed. Review it, then choose Purchase again.';unlock();return;}
     }
     mayHaveSaved=true;
     const result=await api(auth,{...request,action:'place',quote:quote.quote});
     if(result.id!==request.id)throw Error('The purchase reference could not be verified.');
     savedId=result.id;
     if(kind(method)==='interac'&&(result.currency!=='CAD'||result.total_cents!==quote.total_cents||result.manual_transfer!==true))throw Error('Check your saved purchase before sending payment.');
     let next='/account/purchases?id='+encodeURIComponent(result.id);
     if(kind(method)!=='interac'){
      const payment=await window.DirectCheckout.openHostedPayment(auth,result.id,quote.total_cents,quote.currency,method,{country:request.address.country});
      if(!payment.paid)next=payment.url;
     }
     try{sessionStorage.removeItem('pure-membership-purchase');}catch{}navigate(next);
    }catch(error){
     if(mayHaveSaved){savedId=request.id;status.innerHTML='Your purchase reference is '+esc(request.id)+'. '+esc(error.message)+' <a href="/account/purchases?id='+encodeURIComponent(request.id)+'">Check payment status</a>. Your product cart is saved.';return;}
     status.textContent=error.message;unlock();review.querySelector('button').disabled=false;
    }
   }
   form.addEventListener('input',invalidate);form.addEventListener('change',invalidate);form.elements.country.addEventListener('change',paymentAvailability);
   paymentAvailability();termPrice();
   form.onsubmit=async event=>{
    event.preventDefault();if(busy||savedId||!form.reportValidity())return;
    const body=capture(),fingerprint=JSON.stringify(body),requestRevision=revision;
    if(!methods.some(method=>method.id===body.method_id&&method.countries?.includes(body.address.country))){status.textContent='Choose a supported payment method before continuing.';return;}
    quote=null;request=null;quotedRevision=null;quotedFingerprint=null;review.replaceChildren();lock();status.textContent='Calculating your membership total…';
    try{
     const stored=(()=>{try{return JSON.parse(sessionStorage.getItem('pure-membership-purchase')||'null');}catch{return null;}})();
     if(previousFingerprint!==fingerprint){requestId=stored?.fingerprint===fingerprint&&/^[a-f0-9-]{36}$/i.test(stored.id||'')?stored.id:crypto.randomUUID();previousFingerprint=fingerprint;}
     const pendingRequest={...body,id:requestId,action:'quote'};
     try{sessionStorage.setItem('pure-membership-purchase',JSON.stringify({id:requestId,fingerprint}));}catch{}
     const result=await api(auth,pendingRequest),method=methods.find(method=>method.id===body.method_id);
     if(requestRevision!==revision||fingerprint!==JSON.stringify(capture())){status.textContent='Your details changed. Review your membership total again.';return;}
     if(!result.quote||!Number.isSafeInteger(result.total_cents)||result.total_cents<=0||!['USD','CAD'].includes(result.currency)||result.currency!==method.currency||(result.currency==='CAD'&&!result.fx_quote))throw Error('The final membership total could not be verified.');
     quote=result;request={...pendingRequest,...(result.currency==='CAD'?{fx_quote:result.fx_quote}:{})};quotedRevision=requestRevision;quotedFingerprint=fingerprint;
     showQuote();status.textContent='Review the total above. Your membership starts after payment is confirmed.';review.scrollIntoView?.({block:'nearest',behavior:'auto'});
    }catch(error){quote=null;request=null;quotedRevision=null;quotedFingerprint=null;review.replaceChildren();status.textContent=error.message;}finally{unlock();}
   };
  }catch(error){root.innerHTML='<section class="pm-checkout"><h1>Membership checkout</h1><p role="alert">'+esc(error.message)+'</p><a class="ap-button" href="/memberships">View memberships</a></section>';}
 }
 window.PureMembershipCheckout={checkout,offer};
})();
