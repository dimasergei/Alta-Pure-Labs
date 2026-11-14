(()=>{
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const usd=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format((Number(n)||0)/100);
 const view=(selector,base=document)=>base.querySelector(selector);
 const all=(selector,base=document)=>Array.from(base.querySelectorAll(selector));
 const el=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=String(text);return node};
 const COUNTRIES=new Intl.DisplayNames(['en'],{type:'region'});
 const countryOptions=codes=>codes.map(code=>({code,label:COUNTRIES.of(code)||code})).sort((a,b)=>a.label.localeCompare(b.label)).map(c=>'<option value="'+esc(c.code)+'">'+esc(c.label)+'</option>').join('');
 const stepTitles=['Shipping','Delivery','Payment'];
 const payCards=[
  ['visa','Visa'],['apple','Apple Pay'],['google','Google Pay'],['mastercard','Mastercard'],['amex','American Express'],['discover','Discover']
 ];
 const logo=(type,text)=>'<img class="nlx-payment-mark" src="/assets/payment-brands/'+type+'.svg" alt="'+esc(text)+'" width="45" height="30" loading="lazy">';
 const shieldIcon='<svg class="nlx-shield-svg" viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 3 20 6v6c0 5-3.4 8.1-8 10-4.6-1.9-8-5-8-10V6l8-3Z"/><path d="m8 12 3 3 5-6"/></svg>';
 const sparkleIcon='<svg data-icon="sparkles" viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m12 2 1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8L12 2ZM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z"/></svg>';
 const cartKey=items=>'ap-v2-cart-extras:'+JSON.stringify(items.map(({id,size,qty})=>({id,size,qty})));
 const terms1='I confirm that I am at least 21 years of age and am purchasing these products for research purposes only. These products are not intended for human consumption.';
 const terms2='Purchaser Responsibility & Research Use Only. By purchasing, I accept full responsibility for safe, lawful, research-only use and acknowledge that AltaPure Labs bears no liability for misuse. I agree to indemnify and hold harmless AltaPure Labs from any claim. I also attest that I am a qualified researcher and will only use these products for their intended use. I also acknowledge and accept the Research Use Only Agreement and Terms & Conditions.';
 // Keep the original membership-only checkout before overriding goods checkout.
 const membershipCheckout=window.DirectCheckout?.checkout;
 async function checkout(root,auth,user,options={}){
  if(['vip','elite'].includes(new URLSearchParams(location.search).get('plan'))){
   if(!membershipCheckout){root.replaceChildren(el('p','nlx-error','Membership checkout is unavailable.'));return;}
   return membershipCheckout(root,auth,user,options);
  }
  const cart=window.AltaStore?.cart||[];
  if(!cart.length){root.replaceChildren(el('p','nlx-empty','Your cart is empty.'));return;}
  let data;
  try{data=await window.DirectCheckout.api(auth);}catch(err){root.replaceChildren(el('p','nlx-error',err.message));return;}
  const method=(data.methods||[]).find(m=>m.native_provider==='nmi'&&data.nmi?.ready&&data.nmi.method_id===m.id);
  const previewMethod=(data.methods||[]).find(m=>m.native_provider==='nmi')||(data.methods||[]).find(m=>m.kind!=='bank_transfer')||data.methods?.[0]||null;
  const saved=user.user_metadata?.alta_profile?.shipping||{},names=(saved.name||user.user_metadata?.full_name||'').trim().split(/\s+/);
  const nameFirst=names.shift()||'',nameLast=names.join(' ');
  const supported=data.config.shipping_countries||['US'];
  const countries=countryOptions(supported);
  const optionsById=Object.fromEntries((data.delivery_options||[]).map(x=>[x.id,x]));
  const isActive=id=>!!optionsById[id]?.enabled;
  const priorExtras=(()=>{try{return JSON.parse(sessionStorage.getItem(cartKey(cart))||'null');}catch{return null;}})();

  let stage=0,quote=null,quoteVersion=0,quoteTimer=null,nmiComponent=null,onePayment=false,lastPlaced=null,orderId=crypto.randomUUID(),currentPreview=null,loadingPreview=false,sms=false;
  const trustMarkup='<div class="nlx-trust"><span><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>SECURE</span><span>'+shieldIcon+'PROTECTED</span><span><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m7 12 3 3 7-7"/></svg>3RD PARTY TESTED</span></div>';
  const displayAddress=()=>{const a=state.shippingData||formatAddress();return '<b>'+esc(((state.firstName||nameFirst)+' '+(state.lastName||nameLast)).trim())+'</b><span>'+esc(a.line1||'')+'</span>'+(a.line2?'<span>'+esc(a.line2)+'</span>':'')+'<span>'+esc((a.city||'')+(a.region?', '+a.region:'')+(a.postal_code?' '+a.postal_code:''))+'</span><span>'+esc(a.country||'')+'</span>';};
  const state={country:supported.includes(saved.country)?saved.country:'US',
    shipping:'standard',extras:new Set([...(Array.isArray(priorExtras)?priorExtras.filter(x=>isActive(x)):[]),...(isActive('protection')&&(supported.includes(saved.country)?saved.country:'US')==='US'?['protection']:[])]),
    coupon:localStorage.getItem('ap-checkout-coupon')||'',priorityPeriod:'monthly',shippingProtection:isActive('protection'),shippingData:null,billingData:null,billingSame:true,note:'',smsOptIn:false};
  root.classList.add('nlx-checkout-root');document.title='Checkout | AltaPure Labs';
  const div=document.createElement('div');div.className='nlx-page';root.replaceChildren(div);
  div.innerHTML='<div class="nlx-heading"><h1>Checkout</h1><p>Complete your order securely</p></div><div class="nlx-columns">'
    +'<section class="nlx-left"><nav class="nlx-progress" aria-label="Checkout steps">'+stepTitles.map((s,i)=>'<button type="button" data-nlx-step="'+i+'"><span>'+(i+1)+'</span>'+s+'</button>').join('')+'</nav><form id="nlx-form" novalidate></form></section>'
    +'<aside class="nlx-right" aria-label="Order summary"><div class="nlx-summary"><div class="nlx-summary-head"><h2>Order Summary</h2><span data-nlx-item-count></span></div>'
    +'<div class="nlx-protect" data-nlx-protection></div><div class="nlx-products" data-nlx-products></div>'
    +'<div class="nlx-coupon"><input aria-label="Coupon code" name="sidebar_coupon" placeholder="Coupon code" maxlength="40"><button type="button" data-nlx-coupon>APPLY</button></div>'
    +'<div class="nlx-total-rows" data-nlx-totals></div><div class="nlx-points" data-nlx-points></div><p class="nlx-quote-note" data-nlx-quote-note></p></div></aside></div>';
  const form=view('#nlx-form',div),detail=view('.nlx-summary',div);
  if(state.country!=='US')state.extras.delete('protection');
  const status=()=>view('[data-nlx-status]',form);
  const note=(message,error=false)=>{const target=status();if(target){target.textContent=message;target.classList.toggle('nlx-error',error);}};
  const snapshotCart=()=>window.AltaStore?.cart||[];
  const shippingCountry=()=>form.elements.country?.value||state.shippingData?.country||state.country;
  const selection=()=>({shipping:state.shipping,extras:[...state.extras].sort()});
  const formatAddress=()=>state.shippingData||{
   line1:saved.line1||'',line2:saved.line2||'',city:saved.city||'',region:saved.region||'',
   postal_code:saved.postal_code||'',country:state.country
  };
  function keepShipping(){
   const c=form.elements;
   state.shippingData={line1:c.line1.value.trim(),line2:c.line2.value.trim(),city:c.city.value.trim(),
    region:c.region.value.trim(),postal_code:c.postal_code.value.trim(),country:c.country.value};
   state.firstName=c.first_name.value.trim();state.lastName=c.last_name.value.trim();state.phone=c.phone.value.trim();
   state.country=c.country.value;state.billingSame=c.billing_same.checked;
   state.smsOptIn=c.sms_opt.checked;
   state.billingData=!state.billingSame?{
    line1:c.billing_line1.value.trim(),city:c.billing_city.value.trim(),region:c.billing_region.value.trim(),
    postal_code:c.billing_postal.value.trim(),country:c.billing_country.value}:null;
   form.dataset.shipName=(state.firstName+' '+state.lastName).trim();
   form.dataset.shipAddress=[state.shippingData.line1,state.shippingData.line2,state.shippingData.city,state.shippingData.region,state.shippingData.postal_code,state.country].filter(Boolean).join(' · ');
  }

  const draft=consent=>({
    id:orderId,kind:'goods',items:snapshotCart().map(({id,size,qty})=>({id,size,qty})),
    name:((state.firstName||nameFirst)+' '+(state.lastName||nameLast)).trim(),
    phone:state.phone||'',email:user.email,organization:'',
    address:formatAddress(),research_use:!!form.elements.ruo?.checked,consent:!!consent,
    sms_opt_in:state.smsOptIn,billing_same:state.billingSame,
    note:state.note,method_id:method?.id||previewMethod?.id,
    points:0,credit_cents:0,coupon:state.coupon,
    delivery:selection(),checkout_version:data.config.version
  });
  async function fetchPreview(){
   const current=++quoteVersion,addr=shippingCountry();
   loadingPreview=true;
   const s=await auth.auth.getSession(),token=s.data?.session?.access_token;
   const res=await fetch('/api/customer-config?checkout=cart',{method:'POST',cache:'no-store',
     headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},
     body:JSON.stringify({items:snapshotCart().map(({id,size,qty})=>({id,size,qty})),
       method_id:(stage===2&&form.querySelector('[name=payment_choice]:checked')?.value==='bank'?(data.methods||[]).find(m=>m.kind==='bank_transfer'&&m.active!==false)?.id:null)||method?.id||previewMethod?.id||null,coupon:state.coupon,delivery:selection(),country:addr})});
   const result=await res.json().catch(()=>null);
   if(current!==quoteVersion)return null;
   loadingPreview=false;
   if(!res.ok)throw Error(result?.error||'Could not calculate final total.');
   currentPreview=result;return result;
  }
  function moneyLines(){
   const p=currentPreview;
   const subtotal=p?.subtotal_cents??snapshotCart().reduce((n,x)=>n+Math.round(x.price*100)*x.qty,0);
   const savings=p?.discount_cents??0;
   const delivery=p?.pricing?.delivery||{};
   const ships=p?.shipping_cents??0,shipBase=delivery.shipping_cents??0;
   const fees=delivery.extras||[];
   const counts=[['Subtotal',subtotal]];
   if(savings)counts.push(['Discounts',-savings]);
   counts.push(['Shipping',shipBase]);
   for(const x of fees)counts.push([x.label,x.amount_cents]);
   if(!p&&ships&&!fees.length)counts.push(['Shipping and add-ons',ships]);
   counts.push(['Total',p?.total_cents??(subtotal-savings+ships)]);
   return counts;
  }
  function wireDisclosures(scope){
   all('button[data-nlx-info]',scope).forEach(button=>button.addEventListener('click',()=>{
    const id=button.getAttribute('aria-controls'),panel=id&&scope.querySelector('#'+id);
    if(!panel)return;
    const open=button.getAttribute('aria-expanded')==='true';
    button.setAttribute('aria-expanded',String(!open));panel.hidden=open;
   }));
  }
  function shippingCrossSell(){
   const items=snapshotCart();
   const picks=(window.AltaStore?.catalog||[]).filter(x=>!items.some(line=>line.id===x.id)&&Array.isArray(x.variants)&&x.variants.length).slice(0,2);
   if(!picks.length)return '';
   return '<section class="nlx-cross-sell" data-nlx-cross-sell><h3>Recommended for your research</h3><div>'+picks.map(item=>{
    const variant=item.variants[0],photo=window.AltaStore?.image?.(item,variant.size)||'';
    return '<article><img src="'+esc(photo)+'" alt=""><span><strong>'+esc(item.name)+'</strong><small>'+esc(variant.size)+' · '+usd(Math.round(Number(variant.price)*100))+'</small></span><button type="button" data-nlx-cross-sell-add="'+esc(item.id)+'" data-size="'+esc(variant.size)+'">Add</button></article>';
   }).join('')+'</div></section>';
  }
  // Only the authoritative quote can certify free promotional units.
  function quotedFreeUnits(line,preview=currentPreview){
   const matching=Array.isArray(preview?.pricing?.lines)?preview.pricing.lines.find(row=>
    row.id===line.id&&row.size===line.size&&row.qty===line.qty):null;
   const n=matching?.bogo_free_units;
   return Number.isSafeInteger(n)&&n>0&&n<=line.qty&&['bogo','bogo+coupon_bogo'].includes(matching?.discount_reason)?n:0;
  }
  function renderSummary(){
   const items=snapshotCart();
   view('[data-nlx-item-count]',detail).textContent=items.reduce((n,x)=>n+x.qty,0)+' items';
   view('[data-nlx-protection]',detail).innerHTML=isActive('protection')&&state.country==='US'?'<div class="nlx-protection-body"><span class="nlx-shield">'+shieldIcon+'</span><div class="nlx-protection-copy"><strong>Shipping Protection</strong><button type="button" class="nlx-disclosure-trigger" data-testid="protection-disclosure" data-nlx-info="protection" aria-controls="nlx-protection-detail" aria-expanded="false">Read more</button><div class="nlx-disclosure" id="nlx-protection-detail" data-testid="protection-disclosure-panel" data-nlx-panel hidden><p>'+esc(optionsById.protection.description||'Optional protection for eligible shipments.')+'</p><a href="/shipping-protection.html">Full shipping protection policy</a></div></div><span class="nlx-protection-price">'+usd(optionsById.protection.price_cents)+'</span><label class="nlx-mini-check"><input type="checkbox" data-nlx-extra="protection" '+(state.extras.has('protection')?'checked':'')+' aria-label="Shipping protection"></label></div>':'';
   view('[data-nlx-products]',detail).innerHTML='<div class="nlx-product-head"><span>PRODUCT</span><span>SUBTOTAL</span></div>'+items.map(x=>{
    const image=window.AltaStore?.image?.(window.AltaStore.product(x.id),x.size)||'';
    const free=quotedFreeUnits(x)||(Date.now()<Date.parse('2026-11-26T23:59:59-06:00')&&x.qty===1?1:0);
    return '<div class="nlx-product"><button type="button" class="nlx-remove" data-nlx-remove="'+esc(x.key)+'" aria-label="Remove '+esc(x.name)+'">×</button><img src="'+esc(image)+'" alt=""><div class="nlx-product-name"><strong>'+esc(x.name)+'</strong><small>'+esc(x.size)+'</small>'+(free?'<span class="nlx-promo-free" data-testid="checkout-bogo-free">+'+free+' FREE</span>':'')+'<div class="nlx-qty"><button data-nlx-qty="-1" data-key="'+esc(x.key)+'" aria-label="Decrease quantity">−</button><span>'+x.qty+'</span><button data-nlx-qty="1" data-key="'+esc(x.key)+'" aria-label="Increase quantity">+</button></div></div><strong class="nlx-product-price">'+usd(Math.round(x.price*100)*x.qty)+'</strong></div>';
   }).join('');
   view('[data-nlx-totals]',detail).innerHTML=moneyLines().map(([n,v])=>'<div class="'+(n==='Total'?'nlx-grand':'')+'"><span>'+esc(n)+'</span><strong>'+usd(v)+'</strong></div>').join('');
   const points=currentPreview?.earned_points||0;
   view('[data-nlx-points]',detail).innerHTML='<span class="nlx-points-text">'+sparkleIcon+' Earn <strong>'+Math.max(0,points)+' points</strong> on this order</span><a href="/memberships">Earn more →</a>';
   view('[data-nlx-quote-note]',detail).textContent='';
   const coupon=view('[name=sidebar_coupon]',detail);if(document.activeElement!==coupon)coupon.value=state.coupon;
   wireDisclosures(detail);
   all('[data-nlx-extra="protection"]',detail).forEach(x=>x.addEventListener('change',()=>{
    x.checked?state.extras.add('protection'):state.extras.delete('protection');schedule();refresh();
   }));
   all('[data-nlx-remove]',detail).forEach(b=>b.addEventListener('click',()=>{
    const item=snapshotCart().find(x=>x.key===b.dataset.nlxRemove);
    if(!item)return;
    window.AltaStore?.adjustQuantity?.(item.key,-item.qty);
    invalidate();renderSummary();refresh();
   }));
   all('[data-nlx-qty]',detail).forEach(b=>b.addEventListener('click',()=>{
    const before=snapshotCart().find(x=>x.key===b.dataset.key);
    if(!before)return;
    window.AltaStore?.adjustQuantity?.(before.key,Number(b.dataset.nlxQty));
    invalidate();
    renderSummary();refresh();
   }));
  }
  function invalidate(){if(lastPlaced)return;sessionStorage.setItem(cartKey(snapshotCart()),JSON.stringify([...state.extras]));localStorage.setItem('ap-checkout-coupon',state.coupon);quote=null;currentPreview=null;nmiComponent?.destroy();nmiComponent=null;onePayment=false;orderId=crypto.randomUUID();}
  const refresh=async()=>{
   if(lastPlaced)return;
   try{
    const q=await fetchPreview();if(q){renderSummary();if(stage===2){const btn=view('[data-nlx-place]',form);if(btn){const bank=(data.methods||[]).find(m=>m.kind==='bank_transfer'&&m.active!==false);const selected=form.querySelector('[name=payment_choice]:checked')?.value;btn.disabled=!(selected==='bank'&&bank&&form.elements.ruo?.checked&&form.elements.responsibility?.checked);btn.textContent=selected==='bank'&&bank?'Place bank transfer order · '+usd(q.total_cents):'Payment method awaiting activation · '+usd(q.total_cents);}}}
   }catch(error){view('[data-nlx-quote-note]',detail).textContent=error.message;note(error.message,true);}
  };
  function schedule(){if(lastPlaced)return;invalidate();clearTimeout(quoteTimer);quoteTimer=setTimeout(refresh,180);}
  function showStep(i){if(lastPlaced){note('This order is already saved. Check its payment status before making a new order.',true);return;}stage=i;all('[data-nlx-step]',div).forEach((b,n)=>{
    b.classList.toggle('nlx-step-active',n===i);b.classList.toggle('nlx-step-done',n<i);
    b.setAttribute('aria-current',n===i?'step':'false');});
    renderStep();
  }
  function checkRequired(selector){const input=all(selector,form).find(x=>!x.checkValidity());if(input){input.reportValidity();input.focus();return false;}return true;}
  function goNext(){
   if(stage===0){
     if(!checkRequired('[data-nlx-shipping] input[required], [data-nlx-shipping] select[required]'))return;
     if(!supported.includes(shippingCountry()))return note('Select a supported destination.',true);
     keepShipping();
   }
   if(stage===1){
     state.note=form.elements.note?.value.trim()||'';
     if(!currentPreview){refresh();return;}
   }
   if(stage<2)showStep(stage+1);
  }
  function deliveryCards(){
   const rates=data.shipping_zones||{};
   const country=shippingCountry();const map=rates[country]||rates.OTHER||{};
   const options=['standard','express','next_day'].map((id,i)=>{const x=optionsById[id];if(!x)return'';
    const amount=map[id],eligible=x.enabled&&Number.isSafeInteger(amount);
    return '<label class="nlx-delivery-card '+(state.shipping===id?'nlx-chosen':'')+(eligible?'':' nlx-disabled')+'"><input type="radio" name="delivery_speed" value="'+id+'" '+(state.shipping===id?'checked ':'')+(eligible?'':'disabled')+'><span class="nlx-delivery-desc"><strong>'+esc(x.label)+'</strong><small>'+esc(id==='standard'?'Estimated at dispatch · Tracked service':id==='express'?'Estimated at dispatch · Expedited service where available':'Estimated at dispatch · Next-day service where eligible')+'</small></span><span class="nlx-delivery-price">'+(eligible?usd(amount):'Unavailable')+'</span></label>';
   }).join('');
   const extra=['priority','cold_chain'].map((id,i)=>{const x=optionsById[id];if(!x)return'';
    const label=id==='priority'?'priority':'cold-chain',target='nlx-disclose-'+label;
    return '<div class="nlx-extra-box nlx-extra-'+id+'"><div><span class="nlx-extra-icon">'+(id==='priority'?'◷':'❄')+'</span><div><strong>'+esc(x.label)+'</strong><p>'+esc(x.description)+'</p><button type="button" class="nlx-disclosure-trigger" data-nlx-info="'+id+'" data-testid="'+label+'-disclosure" aria-expanded="false" aria-controls="'+target+'">Read more</button><div id="'+target+'" data-testid="'+label+'-disclosure-panel" data-nlx-panel class="nlx-disclosure" hidden><p>'+esc(x.description)+'</p><p>Optional service; pricing is included only when selected in the final quote.</p></div></div></div><span>'+usd(x.price_cents)+'</span><label class="nlx-extra-check"><input type="checkbox" aria-label="'+esc(x.label)+'" data-nlx-extra="'+id+'" '+(state.extras.has(id)?'checked':'')+(x.enabled?'':' disabled')+'></label></div>';
   }).join('');
   return '<h2>Delivery speed</h2><div class="nlx-delivery-list">'+options+'</div><div class="nlx-addons">'+extra+'</div>';
  }
  const plan=data.terms?.conversion?.plans?.vip;
  function offerBox(){
   if(!plan)return '';
   const monthly='$19.99',annual='$191.90'; // Display-only Gold offer; backend plan pricing differs, so activation is gated.
   return '<section class="nlx-member-offer"><div><span class="nlx-optional">OPTIONAL</span><strong class="nlx-member-label">ALTA GOLD MEMBERSHIP</strong></div><h3>Save <em>$21.73</em> today</h3><p>Free express shipping on every order · 5% off every order · 5x points per $1</p><div class="nlx-member-types"><button type="button" data-nlx-plan="monthly" class="'+(state.priorityPeriod==='monthly'?'selected':'')+'"><strong>Monthly</strong><small>'+monthly+'/mo</small></button><button type="button" data-nlx-plan="annual" class="'+(state.priorityPeriod==='annual'?'selected':'')+'"><strong>Annual <span class="nlx-annual-badge">-20%</span></strong><small>'+annual+'/yr</small></button></div><div class="nlx-member-actions"><button type="button" data-nlx-skip>No thanks</button><button type="button" data-testid="membership-activate" class="nlx-member-unavailable" disabled title="Gold membership pricing requires activation in the membership system">Activate · '+(state.priorityPeriod==='annual'?annual+'/yr':monthly+'/mo')+' →</button></div><small>The membership checks out on its own. Your cart is saved and comes back with your member pricing.</small><a class="nlx-compare" href="/memberships">Compare plans</a></section>';
  }
  function paymentLayout(){
   const amount=usd(currentPreview?.total_cents||0);
   const bank=(data.methods||[]).find(m=>m.kind==='bank_transfer'&&m.active!==false);
   return '<section class="nlx-payment"><h2>Payment</h2><div class="nlx-express-label"><strong>EXPRESS CHECKOUT</strong><span>'+amount+'</span></div>'
     +'<div class="nlx-wallets" data-nlx-wallets><button type="button" class="nlx-wallet-unavailable" disabled>'+"<svg class=\"nlx-wallet-symbol nlx-apple-symbol\" viewBox=\"0 0 24 24\" width=\"28\" height=\"28\" aria-hidden=\"true\"><path fill=\"currentColor\" d=\"M17.2 12.3c0-2 1.6-3.1 1.7-3.2-1-1.5-2.6-1.7-3.2-1.7-1.3-.1-2.5.8-3.2.8-.7 0-1.7-.8-2.8-.7-1.5 0-2.9.9-3.7 2.2-1.6 2.7-.4 6.8 1.1 9 .7 1.1 1.5 2.3 2.6 2.3 1 0 1.4-.7 2.7-.7 1.2 0 1.6.7 2.7.7 1.2 0 1.9-1 2.6-2.1.8-1.2 1.1-2.3 1.2-2.4-2.2-.8-2.4-3-2.4-3.2zM14.7 6.1c.6-.8 1-1.8.9-2.8-.9 0-2 .6-2.6 1.3-.6.7-1.1 1.8-1 2.8 1 .1 2-.5 2.7-1.3z\"/></svg>"+'<b>Pay</b></button><span class="nlx-or">or</span><button type="button" class="nlx-wallet-unavailable" disabled>'+"<svg class=\"nlx-wallet-symbol nlx-google-symbol\" viewBox=\"0 0 48 48\" width=\"27\" height=\"27\" aria-hidden=\"true\"><path fill=\"#EA4335\" d=\"M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z\"/><path fill=\"#4285F4\" d=\"M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6C44.4 38.03 46.98 31.89 46.98 24.55z\"/><path fill=\"#FBBC05\" d=\"M10.53 28.59A14.4 14.4 0 0 1 9.75 24c0-1.59.27-3.13.76-4.59l-7.98-6.19A23.88 23.88 0 0 0 0 24c0 3.87.93 7.51 2.56 10.78l7.97-6.19z\"/><path fill=\"#34A853\" d=\"M24 48c6.48 0 11.93-2.13 15.91-5.8l-7.73-6c-2.15 1.45-4.92 2.3-8.18 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.97 6.19C6.51 42.62 14.62 48 24 48z\"/></svg>"+'<b>Pay</b></button></div>'
     +'<p class="nlx-wallet-consent">By tapping Apple Pay or Google Pay, you confirm you are at least 21, are buying for research use only, and accept the <a href="/research-use-policy.html">Research Use Only Agreement</a> and <a href="/commercial-terms.html">Terms &amp; Conditions</a>.</p>'
     +'<div class="nlx-divider"><span>OR PAY ANOTHER WAY</span></div>'
     +'<div class="nlx-payment-rows"><div class="nlx-payment-choice"><label class="nlx-payment-option"><input type="radio" name="payment_choice" value="card" checked><span>Credit/Debit Card</span><span class="nlx-card-logos"><img class="nlx-card-brand" src="/assets/payment-brands/visa-blue.svg" alt="Visa" width="62" height="38"><img class="nlx-card-brand" src="/assets/payment-brands/amex-blue.svg" alt="American Express" width="62" height="38"></span></label><div class="nlx-payment-choice-body"><p>Pay with your credit card</p><label>Card number *<input disabled autocomplete="off" placeholder="•••• •••• •••• ••••" aria-label="Card number unavailable until processor activation"></label><div class="nlx-two"><label>Expiry (MM/YY) *<input disabled placeholder="MM / YY"></label><label>Card code *<input disabled placeholder="CVC"></label></div><small>Card payments are not available until processor activation.</small></div></div>'
     +'<div class="nlx-payment-choice"><label class="nlx-payment-option"><input type="radio" name="payment_choice" value="other_card"><span>Credit/Debit Cards (All Types)</span><span class="nlx-phone-icon"><svg class="nlx-phone-symbol" viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="2" width="12" height="20" rx="2"/><path d="M10 18h4"/></svg></span><b class="nlx-fee-pill">No Fees!</b></label><div class="nlx-payment-choice-body" hidden><p>Bank/Card Statement Information: This transaction will appear as from *ByteNFT.</p><small>This payment method is not active.</small></div></div>'
     +'<div class="nlx-payment-choice"><label class="nlx-payment-option"><input type="radio" name="payment_choice" value="bank"><span>Same-Day Bank Payment</span><span class="nlx-bank-icon"><svg class="nlx-bank-symbol" viewBox="0 0 24 24" width="25" height="25" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m2 10 10-7 10 7M4 10h16M5 10v10M10 10v10M14 10v10M19 10v10M2 21h20"/></svg></span><b class="nlx-fee-pill">5% off</b></label><div class="nlx-payment-choice-body" hidden><p>Pay with your bank account through our secured gateway. You’ll be redirected to your bank to sign in and approve the payment. Your credentials remain with your bank.</p><div class="nlx-bank-logos"><label class="nlx-bank-link"><span class="nlx-bank-link-dot" role="radio" aria-checked="true" aria-disabled="true"></span><span>Link a new bank account</span></label><img class="nlx-bank-logo nlx-chase-mark" alt="Chase" src="/assets/payment-brands/chase-reference.png" width="45" height="45"><img class="nlx-bank-logo nlx-bofa-mark" alt="Bank of America" src="/assets/payment-brands/bofa-reference.png" width="45" height="45"><img class="nlx-bank-logo nlx-wf-mark" alt="Wells Fargo" src="/assets/payment-brands/wf-reference.png" width="45" height="45"><span class="nlx-bank-logo nlx-more-mark">&amp; more</span></div><small>'+(bank?'Bank transfer is available through the verified receiving method. Bank-account linking and redirect are a non-operational preview.':'Bank payment is awaiting activation. Bank-account linking and redirect are not operational.')+'</small></div></div></div>'
     +'<div class="nlx-inline-nmi" data-nlx-nmi hidden></div>'
     +'<div class="nlx-we-accept"><span>WE ACCEPT</span><div>'+payCards.map(([type,label])=>logo(type,label)).join('')+'</div><small>Card and wallet methods shown for reference; not yet activated.</small></div>'
     +'<div class="nlx-terms"><label><input type="checkbox" name="ruo" required><span>'+esc(terms1)+'</span></label><label><input type="checkbox" name="responsibility" required><span>'+esc(terms2)+'</span></label></div>'
     +'<div class="nlx-status" data-nlx-status role="status" aria-live="polite"></div><button type="button" class="nlx-primary" data-nlx-place disabled>Place order · '+amount+'</button>'
     +trustMarkup+'</section>';
  }
  function renderStep(){
   if(stage===0){
    form.innerHTML='<div class="nlx-step-shipping" data-nlx-shipping><h2>Where should it ship?</h2><h3>YOUR INFORMATION</h3>'
      +'<div class="nlx-two"><label>First name *<input name="first_name" autocomplete="given-name" required maxlength="60" value="'+esc(nameFirst)+'" placeholder="First name"></label><label>Last name *<input name="last_name" required maxlength="60" autocomplete="family-name" value="'+esc(nameLast)+'" placeholder="Last name"></label></div>'
      +'<label>Phone number *<input name="phone" type="tel" required minlength="7" maxlength="30" autocomplete="tel" placeholder="Phone number" value="'+esc(state.phone||saved.phone||'')+'"></label><h3>SHIPPING ADDRESS</h3>'
      +'<label>Country / Region *<select name="country" autocomplete="country" required>'+countries+'</select></label>'
      +'<label>Street address *<input name="line1" required maxlength="180" autocomplete="shipping address-line1" placeholder="Street address" value="'+esc(state.shippingData?.line1||saved.line1||'')+'"></label>'
      +'<label>Suite, building, unit (optional)<input name="line2" maxlength="180" autocomplete="shipping address-line2" placeholder="Suite, building, unit" value="'+esc(state.shippingData?.line2||saved.line2||'')+'"></label>'
      +'<div class="nlx-two"><label>City *<input name="city" required maxlength="80" autocomplete="shipping address-level2" placeholder="City" value="'+esc(state.shippingData?.city||saved.city||'')+'"></label><label>State / Province / Region *<input name="region" required maxlength="80" autocomplete="shipping address-level1" placeholder="State or region" value="'+esc(state.shippingData?.region||saved.region||'')+'"></label></div>'
      +'<label>Postal / ZIP code *<input name="postal_code" required minlength="2" maxlength="20" autocomplete="shipping postal-code" placeholder="Postal or ZIP code" value="'+esc(state.shippingData?.postal_code||saved.postal_code||'')+'"></label>'
      +'<label>Email (optional)<input name="email" type="email" readonly value="'+esc(user.email)+'"></label><p class="nlx-email-help">Order confirmation and tracking go here. Leave blank to use your account email.</p>'
      +'<label class="nlx-small-check nlx-sms"><input type="checkbox" name="sms_opt" '+(state.smsOptIn?'checked':'')+'><span><strong>Text me order updates and offers.</strong><small>By providing your phone number you agree to receive informational and marketing text messages from AltaPure Labs. Consent is not a condition of purchase. Message frequency will vary. Msg &amp; data rates may apply. Reply HELP for help or STOP to cancel. <a href="/terms-and-conditions.html">Terms</a> &amp; <a href="/privacy-policy.html">Privacy</a>.</small></span></label>'
      +'<label class="nlx-small-check"><input type="checkbox" name="billing_same" '+(state.billingSame?'checked':'')+'>Billing address same as shipping</label>'
      +'<div class="nlx-billing-other" hidden><h3>BILLING ADDRESS</h3>'
      +'<label>Billing street *<input name="billing_line1" maxlength="180" placeholder="Billing street address"></label>'
      +'<div class="nlx-two"><label>Billing city *<input name="billing_city" maxlength="80"></label><label>Billing state / region *<input name="billing_region" maxlength="80"></label></div>'
      +'<div class="nlx-two"><label>Billing postal code *<input name="billing_postal" maxlength="20"></label><label>Billing country *<select name="billing_country">'+countries+'</select></label></div></div>'
      +shippingCrossSell()+'<div class="nlx-next"><button type="button" class="nlx-primary" data-nlx-next>Continue</button></div>'+trustMarkup+'</div>';
    form.elements.country.value=state.country;form.elements.billing_country.value=state.billingData?.country||state.country;
    if(!state.billingSame){
     const b=state.billingData||{};for(const [k,v] of Object.entries({billing_line1:b.line1,billing_city:b.city,billing_region:b.region,billing_postal:b.postal_code})){
      if(form.elements[k])form.elements[k].value=v||'';
     }
     view('.nlx-billing-other',form).hidden=false;all('input',view('.nlx-billing-other',form)).forEach(x=>x.required=true);
    }
    form.elements.country.addEventListener('change',()=>{const prior=state.country;state.country=shippingCountry();localStorage.setItem('ap-shipping-country',state.country);if(state.country!=='US'&&state.shipping==='next_day')state.shipping='standard';if(prior==='US'&&state.country!=='US')state.extras.delete('protection');schedule();});
    const other=view('.nlx-billing-other',form);form.elements.billing_same.addEventListener('change',()=>{
      other.hidden=form.elements.billing_same.checked;all('input',other).forEach(x=>x.required=!other.hidden);
    });
    all('[data-nlx-cross-sell-add]',form).forEach(button=>button.addEventListener('click',()=>{
     try{
      if(typeof window.AltaStore?.addItems!=='function')throw Error('The cart is unavailable.');
      window.AltaStore.addItems([{id:button.dataset.nlxCrossSellAdd,size:button.dataset.size,qty:1}]);
      invalidate();renderStep();refresh();
     }catch(error){view('[data-nlx-quote-note]',detail).textContent=error.message;}
    }));
    view('[data-nlx-next]',form).addEventListener('click',goNext);
   }else if(stage===1){
    form.innerHTML='<div class="nlx-step-delivery"><div class="nlx-address-confirm"><div class="nlx-address-lines">'+displayAddress()+'<span>'+esc(state.phone||'')+'</span><span>'+esc(user.email)+'</span></div><button type="button" data-nlx-back-edit>Edit</button></div>'+deliveryCards()+offerBox()
      +'<details class="nlx-order-note"><summary>Add order notes (optional)</summary><textarea name="note" rows="3" maxlength="1000" placeholder="Special handling instructions">'+esc(state.note)+'</textarea></details>'
      +'<p class="nlx-shipping-terms">Carrier eligibility and customs/import requirements depend on destination. International duties, taxes and restrictions are not included in the displayed shipping fee.</p>'
      +'<div class="nlx-next"><button type="button" class="nlx-primary" data-nlx-next>Continue to payment</button></div>'+trustMarkup+'</div>';
    all('[name=delivery_speed]',form).forEach(x=>x.addEventListener('change',()=>{state.shipping=x.value;schedule();renderStep()}));
    all('[data-nlx-extra]',form).forEach(x=>x.addEventListener('change',()=>{x.checked?state.extras.add(x.dataset.nlxExtra):state.extras.delete(x.dataset.nlxExtra);schedule();renderSummary()}));
    all('[data-nlx-plan]',form).forEach(x=>x.addEventListener('click',()=>{state.priorityPeriod=x.dataset.nlxPlan;renderStep()}));
    view('[data-nlx-skip]',form)?.addEventListener('click',()=>view('.nlx-member-offer',form)?.remove());
    view('[data-nlx-back-edit]',form).addEventListener('click',()=>{state.note=form.elements.note?.value||'';showStep(0);});
    view('[data-nlx-next]',form).addEventListener('click',goNext);
    wireDisclosures(form);
   }else{
    const ship=state.shippingData||formatAddress(),bill=state.billingData||ship;
    const hidden=Object.entries({name:((state.firstName||nameFirst)+' '+(state.lastName||nameLast)).trim(),
      line1:ship.line1,city:ship.city,region:ship.region,postal_code:ship.postal_code,country:ship.country,
      billing_line1:bill.line1,billing_city:bill.city,billing_region:bill.region,billing_postal:bill.postal_code,
      billing_country:bill.country,billing_same:state.billingSame?'true':'false'})
      .map(([k,v])=>'<input type="hidden" name="'+esc(k)+'" value="'+esc(v||'')+'">').join('');
    form.innerHTML=hidden+'<div class="nlx-step-payment"><div class="nlx-confirm"><div><strong>CONTACT</strong><span>'+esc(user.email)+'<br>'+esc(state.phone||'')+'</span><button type="button" data-nlx-edit="0">Edit</button></div>'
      +'<div><strong>SHIP TO</strong><span class="nlx-address-lines">'+displayAddress()+'</span><button type="button" data-nlx-edit="0">Edit</button></div>'
      +'<div><strong>DELIVERY</strong><span>'+esc(optionsById[state.shipping]?.label||'Standard delivery')+' · '+usd(currentPreview?.pricing?.delivery?.shipping_cents||0)+(state.extras.has('protection')?' <em class="nlx-protection-confirm">✓ Shipping Protection</em>':'')+'</span><button type="button" data-nlx-edit="1">Edit</button></div></div>'
      +paymentLayout()+'</div>';
    all('[data-nlx-edit]',form).forEach(x=>x.addEventListener('click',()=>showStep(Number(x.dataset.nlxEdit))));
    const bank=(data.methods||[]).find(m=>m.kind==='bank_transfer'&&m.active!==false);
    const choosePayment=()=>{
      const selected=form.querySelector('[name=payment_choice]:checked')?.value;
      all('.nlx-payment-choice',form).forEach(row=>{row.querySelector('.nlx-payment-choice-body').hidden=row.querySelector('[name=payment_choice]').value!==selected;row.classList.toggle('nlx-selected',row.querySelector('[name=payment_choice]').value===selected);});
      const btn=view('[data-nlx-place]',form);
      btn.disabled=!(selected==='bank'&&bank&&form.elements.ruo?.checked&&form.elements.responsibility?.checked);
      btn.textContent=selected==='bank'&&bank?'Place bank transfer order · '+usd(currentPreview?.total_cents||0):'Payment method awaiting activation · '+usd(currentPreview?.total_cents||0);
    };
    all('[name=payment_choice], [name=ruo], [name=responsibility]',form).forEach(x=>x.addEventListener('change',()=>{choosePayment();if(x.name==='payment_choice')refresh();}));
    view('[data-nlx-place]',form).addEventListener('click',async()=>{
      if(!bank||form.querySelector('[name=payment_choice]:checked')?.value!=='bank'||!form.elements.ruo?.checked||!form.elements.responsibility?.checked)return;
      const button=view('[data-nlx-place]',form);button.disabled=true;
      try{
        const body={...draft(true),method_id:bank.id,research_use:true,consent:true};
        const q=await window.DirectCheckout.api(auth,{...body,action:'quote'});
        if(!q?.quote)throw Error('Unable to verify bank transfer total.');
        const result=await window.DirectCheckout.api(auth,{...body,action:'place',quote:q.quote});
        if(!result?.id)throw Error('Bank transfer order was not confirmed.');
        lastPlaced=result.id;
        location.assign('/account/purchases?id='+encodeURIComponent(result.id));
      }catch(error){note(error.message||'Unable to place bank transfer order.',true);button.disabled=false;}
    });
    choosePayment();
   }
   renderSummary();
  }
  async function preparePayment(){
   const target=view('[data-nlx-nmi]',form);
   if(!target)return;
   nmiComponent?.destroy();nmiComponent=null;
   if(!method){target.textContent='Secure card and digital-wallet processing is being activated for AltaPure.';return;}
   if(!form.elements.ruo?.checked||!form.elements.responsibility?.checked)return;
   try{
    const b=draft(true);b.research_use=true;b.consent=true;
    const q=await window.DirectCheckout.api(auth,{...b,action:'quote'});
    quote=q;currentPreview=q;renderSummary();view('[data-nlx-place]',form).textContent='Place order · '+usd(q.total_cents);
    const payment=async details=>{
     if(onePayment)return{pending:true};
     onePayment=true;lastPlaced=null;
     try{
      note('Saving your order and confirming your secure payment…');
      const placed=await window.DirectCheckout.api(auth,{...b,action:'place',quote:q.quote});
      lastPlaced=placed.id;
      const token=await auth.auth.getSession(),access=token.data?.session?.access_token;
      if(!access)throw Error('Sign in to finish your saved order.');
      const r=await fetch('/api/checkout?native=customer&invoice='+encodeURIComponent(lastPlaced),{
       method:'POST',headers:{Authorization:'Bearer '+access,'Content-Type':'application/json'},
       body:JSON.stringify({action:'pay',invoice_id:lastPlaced,attempt_id:crypto.randomUUID(),
        confirm_amount_cents:q.total_cents,confirm_currency:q.currency,consent:true,
        payment_token:details.token,billing:details.billing,cardholder_auth:details.cardholder_auth})});
      const confirmed=await r.json().catch(()=>null);
      if(!r.ok)throw Error(confirmed?.error||'The provider has not confirmed payment. Please check your order.');
      if(confirmed.state==='paid'){
       nmiComponent?.destroy();target.replaceChildren(el('strong','nlx-payment-done','Payment confirmed.'));
       const link=el('a','nlx-view-order','View your paid order');link.href='/account/purchases?id='+encodeURIComponent(lastPlaced);target.append(link);
       note('Payment confirmed. Your order has been saved.');
       sessionStorage.removeItem('ap-checkout-id');sessionStorage.removeItem('ap-checkout-fingerprint');
       localStorage.removeItem('pp-cart');sessionStorage.removeItem(cartKey(snapshotCart()));return{paid:true};
      }
      if(confirmed.state==='declined'){note('Card declined. Your order is saved; review it before retrying.',true);return{pending:true};}
      note('Payment is being verified. Do not submit another charge.');return{pending:true};
     }catch(err){
      note((lastPlaced?'Order saved. ':'')+err.message+' Do not create a duplicate order.',true);
      if(lastPlaced){const link=el('a','nlx-view-order','Check saved order status');link.href='/account/purchases?id='+encodeURIComponent(lastPlaced);target.append(link);}
      return{pending:true};
     }
    };
    nmiComponent=await window.AltaNmiInline.mount({host:target,config:data.nmi,methodId:method.id,
      amount:q.total_cents,currency:q.currency,form,onError:err=>note(err.message,true),onPayment:payment});
    view('[data-nlx-place]',form).hidden=true;
    note('Pay securely using the card form or an available digital wallet.');
   }catch(err){note(err.message,true);}
  }
  view('[data-nlx-coupon]',detail).addEventListener('click',()=>{
   state.coupon=view('[name=sidebar_coupon]',detail).value.trim().toUpperCase();schedule();
  });
  all('[data-nlx-step]',div).forEach(b=>b.addEventListener('click',()=>{const s=Number(b.dataset.nlxStep);if(s<=stage)showStep(s);}));
  renderStep();refresh();
 }
 const current=window.DirectCheckout;
 if(current){current.checkout=checkout;window.AltaCheckoutReference={checkout};}
})();
