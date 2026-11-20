(()=>{
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=(n,currency='USD')=>new Intl.NumberFormat('en-US',{style:'currency',currency}).format((Number(n)||0)/100);
 const usd=n=>money(n,'USD');
 const view=(selector,base=document)=>base.querySelector(selector);
 const all=(selector,base=document)=>Array.from(base.querySelectorAll(selector));
 const el=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=String(text);return node};
 const COUNTRIES=new Intl.DisplayNames(['en'],{type:'region'});
 const countryOptions=codes=>codes.map(code=>({code,label:COUNTRIES.of(code)||code})).sort((a,b)=>a.label.localeCompare(b.label)).map(c=>'<option value="'+esc(c.code)+'">'+esc(c.label)+'</option>').join('');
 const stepTitles=['Shipping','Delivery','Payment'];
 const shieldIcon='<svg class="nlx-shield-svg" viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 3 20 6v6c0 5-3.4 8.1-8 10-4.6-1.9-8-5-8-10V6l8-3Z"/><path d="m8 12 3 3 5-6"/></svg>';
 const cartKey=items=>'ap-v2-cart-extras:'+JSON.stringify(items.map(({id,size,qty})=>({id,size,qty})));
 const protectionKey='ap-checkout-protection';
 function wantsProtection(items){
  try{
   const choice=sessionStorage.getItem(protectionKey);
   if(choice==='true'||choice==='false')return choice==='true';
   const prior=JSON.parse(sessionStorage.getItem(cartKey(items))||'null');
   // Preserve an existing US checkout choice; international carts previously had no protection control.
   if(Array.isArray(prior)&&(prior.includes('protection')||(localStorage.getItem('ap-shipping-country')||'US')==='US')){
    const selected=prior.includes('protection');sessionStorage.setItem(protectionKey,String(selected));return selected;
   }
  }catch{}
  try{sessionStorage.setItem(protectionKey,'true');}catch{}
  return true;
 }
 const terms1='I confirm that I am at least 21 years of age and am purchasing these products for research purposes only. These products are not intended for human consumption.';
 const terms2='Purchaser Responsibility & Research Use Only. By purchasing, I accept full responsibility for safe, lawful, research-only use and acknowledge that PURE bears no liability for misuse. I agree to indemnify and hold harmless PURE from any claim. I also attest that I am a qualified researcher and will only use these products for their intended use. I also acknowledge and accept the Research Use Only Agreement and Terms & Conditions.';
 const standardCheckout=window.DirectCheckout?.checkout;
 const saveCoupon=value=>['ap-checkout-coupon','ap-cart-coupon'].forEach(key=>value?localStorage.setItem(key,value):localStorage.removeItem(key));
 const initialCoupon=()=>{const value=(localStorage.getItem('ap-checkout-coupon')||localStorage.getItem('ap-cart-coupon')||'').trim().toUpperCase();const code=value==='BLACKFRIDAY15'?value:'';saveCoupon(code);return code;};
 async function checkout(root,auth,user,options={}){
  const params=new URLSearchParams(location.search);
  if(params.has('plan')||params.has('period'))return window.PureMembershipCheckout.checkout(root,auth,user);
  if(params.get('bulk')==='1'||params.get('balance')==='1'){
   if(!standardCheckout){root.replaceChildren(el('p','nlx-error','Checkout is unavailable.'));return;}
   return standardCheckout(root,auth,user,options);
  }
  const cart=window.AltaStore?.cart||[];
  if(!cart.length){root.replaceChildren(el('p','nlx-empty','Your cart is empty.'));return;}
  let data;
  try{data=await window.DirectCheckout.api(auth);}catch(err){root.replaceChildren(el('p','nlx-error',err.message));return;}
  const paymentKind=window.DirectCheckout.paymentKind;
  const paymentMethods=(data.methods||[]).filter(m=>paymentKind(m)&&m.active!==false);
  const preferred=paymentMethods.find(m=>m.id===(options.method||params.get('method')));
  const walletPreference=['apple','google'].includes(params.get('wallet'))?params.get('wallet'):null;
  const selectedMethod=()=>paymentMethods.find(m=>paymentKind(m)===state.paymentKind&&Array.isArray(m.countries)&&m.countries.includes(shippingCountry()))||null;
  const saved=user.user_metadata?.alta_profile?.shipping||{},names=(saved.name||user.user_metadata?.full_name||'').trim().split(/\s+/);
  const nameFirst=names.shift()||'',nameLast=names.join(' ');
  const supported=data.config.shipping_countries||['US'];
  const countries=countryOptions(supported);
  const optionsById=Object.fromEntries((data.delivery_options||[]).map(x=>[x.id,x]));
  const isActive=id=>!!optionsById[id]?.enabled&&!(id==='priority'&&data.membership?.benefits?.priority_fulfillment);
  const priorExtras=(()=>{try{return JSON.parse(sessionStorage.getItem(cartKey(cart))||'null');}catch{return null;}})();

  let stage=0,quote=null,quoteVersion=0,quoteTimer=null,onePayment=false,lastPlaced=null,orderId=crypto.randomUUID(),currentPreview=null,loadingPreview=false,sms=false;
  const trustMarkup='<div class="nlx-trust"><span><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>SECURE</span><span>'+shieldIcon+'PROTECTED</span><span><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m7 12 3 3 7-7"/></svg>3RD PARTY TESTED</span></div>';
  const displayAddress=()=>{const a=state.shippingData||formatAddress();return '<b>'+esc(((state.firstName||nameFirst)+' '+(state.lastName||nameLast)).trim())+'</b><span>'+esc(a.line1||'')+'</span>'+(a.line2?'<span>'+esc(a.line2)+'</span>':'')+'<span>'+esc((a.city||'')+(a.region?', '+a.region:'')+(a.postal_code?' '+a.postal_code:''))+'</span>';};
  let savedAddon=null;
  try{
    const value=JSON.parse(sessionStorage.getItem('pure-checkout-membership-item-v1')||'null');
    if(!data.membership&&value&&['vip','elite'].includes(value.plan)&&['monthly','annual'].includes(value.period))
      savedAddon={plan:value.plan,period:value.period};
    else sessionStorage.removeItem('pure-checkout-membership-item-v1');
  }catch{sessionStorage.removeItem('pure-checkout-membership-item-v1');}
  const state={country:supported.includes(saved.country)?saved.country:'US',
    membershipAddon:savedAddon,membershipChoice:savedAddon||{plan:'vip',period:'monthly'},
    shipping:'economy',extras:new Set([...(Array.isArray(priorExtras)?priorExtras.filter(x=>x!=='protection'&&isActive(x)):[]),...(isActive('protection')&&wantsProtection(cart)?['protection']:[])]),
    coupon:initialCoupon(),paymentKind:walletPreference?'card':paymentKind(preferred)||'card',wallet:walletPreference,fxQuote:null,shippingData:null,billingData:null,billingSame:true,note:'',smsOptIn:false};
  if(state.paymentKind==='interac'&&!preferred?.countries?.includes(state.country))state.paymentKind='card';
  root.classList.add('nlx-checkout-root');document.title='Checkout | PURE';
  const div=document.createElement('div');div.className='nlx-page';root.replaceChildren(div);
  div.innerHTML='<div class="nlx-heading"><h1>Checkout</h1><p>Complete your order securely</p></div><div class="nlx-columns">'
    +'<section class="nlx-left"><nav class="nlx-progress" aria-label="Checkout steps">'+stepTitles.map((s,i)=>'<button type="button" data-nlx-step="'+i+'"><span>'+(i+1)+'</span>'+s+'</button>').join('')+'</nav><form id="nlx-form" novalidate></form></section>'
    +'<aside class="nlx-right" aria-label="Order summary"><div class="nlx-summary"><div class="nlx-summary-head"><h2>Order Summary</h2><span data-nlx-item-count></span></div>'
    +'<div class="nlx-protect" data-nlx-protection></div><div class="nlx-products" data-nlx-products></div>'
    +'<p class="nlx-coupon-help">Use <strong>BLACKFRIDAY15</strong> for 15% off merchandise.</p><div class="nlx-coupon"><input aria-label="Coupon code" name="sidebar_coupon" placeholder="BLACKFRIDAY15" maxlength="40"><button type="button" data-nlx-coupon>APPLY</button><button type="button" data-nlx-remove-coupon hidden>REMOVE</button></div><p data-nlx-coupon-status role="status" aria-live="polite"></p>'
    +'<div class="nlx-total-rows" data-nlx-totals></div><div class="nlx-points" data-nlx-points></div><p class="nlx-quote-note" data-nlx-quote-note></p><div data-pure-membership-offer></div></div></aside></div>';
  const form=view('#nlx-form',div),detail=view('.nlx-summary',div),columns=view('.nlx-columns',div);
  const mobileLayout=window.matchMedia?.('(max-width: 770px)');
  let stepActions=null,actionsHome=null;
  // Move the original action block so visual, reading and keyboard order all agree.
  // Its placeholder restores the exact desktop location when the viewport widens.
  function positionActions(){
   if(!div.isConnected){mobileLayout?.removeEventListener?.('change',positionActions);return;}
   if(!stepActions||!actionsHome)return;
   stepActions.classList.toggle('nlx-mobile-actions',!!mobileLayout?.matches);
   if(mobileLayout?.matches)columns.append(stepActions);else actionsHome.after(stepActions);
  }
  function restoreActions(){if(stepActions&&actionsHome?.parentNode)actionsHome.after(stepActions);stepActions=null;actionsHome=null;}
  function attachActions(){
   stepActions=view('.nlx-next,.nlx-payment-controls',form);
   if(!stepActions)return;
   all('button',stepActions).forEach(button=>button.setAttribute('form',form.id));
   actionsHome=document.createComment('Checkout action desktop position');stepActions.before(actionsHome);positionActions();
  }
  mobileLayout?.addEventListener?.('change',positionActions);
  const status=()=>view('[data-nlx-status]',div);
  const note=(message,error=false)=>{const target=status();if(target){target.textContent=message;target.classList.toggle('nlx-error',error);}};
  const snapshotCart=()=>window.AltaStore?.cart||[];
  const checkoutItems=()=>snapshotCart().map(({id,size,qty})=>{
   if(!Number.isSafeInteger(qty)||qty<1||qty>100)throw Error('Choose 1 to 100 units per item.');
   return {id,size,qty};
  });
  const shippingCountry=()=>form.elements.country?.value||state.shippingData?.country||state.country;
  const paymentCurrency=()=>state.paymentKind==='interac'?'CAD':'USD';
  const currentMoney=value=>Number.isSafeInteger(value)&&currentPreview?.currency===paymentCurrency()?money(value,paymentCurrency()):'Calculating…';
  function usdDisplay(value){
   if(paymentCurrency()==='USD')return usd(value);
   const rate=currentPreview?.currency==='CAD'?currentPreview.pricing?.fx_ppm:null;
   return Number.isSafeInteger(value)&&Number.isSafeInteger(rate)&&rate>0?money(Math.round(value*rate/1000000),'CAD'):'Calculating…';
  }
  function extraDisplay(id){const quoted=currentPreview?.pricing?.delivery?.extras?.find(item=>item.id===id);return quoted?currentMoney(quoted.amount_cents):usdDisplay(optionsById[id]?.price_cents);}
  function deliveryDisplay(id,amount){
   const delivery=currentPreview?.pricing?.delivery;
   if(data.membership?.benefits?.free_shipping&&shippingCountry()==='US'&&['economy','standard','express'].includes(id))return 'Included';
   if(delivery?.selection?.shipping===id)return currentMoney(delivery.shipping_cents);
   return usdDisplay(amount);
  }
  function syncCurrencyDisplays(){
   const rates=data.shipping_zones?.[shippingCountry()]||data.shipping_zones?.OTHER||{};
   all('[name=delivery_speed]',form).forEach(input=>{const price=input.closest('.nlx-delivery-card')?.querySelector('.nlx-delivery-price');if(price)price.textContent=!Number.isSafeInteger(rates[input.value])?'Unavailable':['economy','standard'].includes(input.value)&&['US','CA'].includes(shippingCountry())&&currentPreview?.free_shipping_remaining_cents===0?'FREE':deliveryDisplay(input.value,rates[input.value]);});
   all('[data-nlx-extra-price]',form).forEach(target=>target.textContent=extraDisplay(target.dataset.nlxExtraPrice));
   all('[data-nlx-cross-sell-price]',form).forEach(target=>target.textContent=usdDisplay(Number(target.dataset.nlxCrossSellPrice)));
   const shipping=view('[data-nlx-confirm-shipping-price]',form);if(shipping)shipping.textContent=currentMoney(currentPreview?.pricing?.delivery?.shipping_cents);
  }
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
    id:orderId,kind:'goods',items:checkoutItems(),
    name:((state.firstName||nameFirst)+' '+(state.lastName||nameLast)).trim(),
    phone:state.phone||'',email:user.email,organization:'',
    address:formatAddress(),research_use:!!form.elements.ruo?.checked,consent:!!consent,
    sms_opt_in:state.smsOptIn,billing_same:state.billingSame,
    note:state.note,method_id:selectedMethod()?.id,
    points:0,credit_cents:0,coupon:state.coupon,
    delivery:selection(),checkout_version:data.config.version,...(state.membershipAddon?{membership_addon:state.membershipAddon}:{}),
    ...(state.paymentKind==='interac'&&state.fxQuote?{fx_quote:state.fxQuote}:{})
  });
  async function fetchPreview(coupon=state.coupon){
   const current=++quoteVersion,addr=shippingCountry();
   loadingPreview=true;
   const s=await auth.auth.getSession(),token=s.data?.session?.access_token;
   const res=await fetch('/api/customer-config?checkout=cart',{method:'POST',cache:'no-store',
     headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},
     body:JSON.stringify({items:checkoutItems(),
       method_id:selectedMethod()?.id||null,coupon,delivery:selection(),country:addr,...(state.membershipAddon?{membership_addon:state.membershipAddon}:{}),
       ...(state.paymentKind==='interac'&&state.fxQuote?{fx_quote:state.fxQuote}:{})})});
   const result=await res.json().catch(()=>null);
   if(current!==quoteVersion||onePayment||lastPlaced)return null;
   loadingPreview=false;
   if(!res.ok||!Number.isSafeInteger(result?.total_cents))throw Error(result?.error||'Could not calculate final total.');
   if(result.currency!==paymentCurrency()||result.request_only===true||state.paymentKind==='interac'&&(!result.fx_quote||!Number.isSafeInteger(result.pricing?.fx_ppm)||result.pricing.fx_ppm<=0))throw Error('The payment currency could not be verified. Refresh your order total.');
   if(state.paymentKind==='interac')state.fxQuote=result.fx_quote;
   state.coupon=result.pricing?.coupon_code==='BLACKFRIDAY15'?'BLACKFRIDAY15':'';saveCoupon(state.coupon);
   currentPreview=result;return result;
  }
  function moneyLines(){
   const p=currentPreview;
   const subtotal=p?.pricing?.subtotal_cents??snapshotCart().reduce((n,x)=>n+Math.round(x.price*100)*x.qty,0);
   const savings=Math.max(0,p?.pricing?.coupon_discount_cents||0),cryptoSavings=Math.max(0,p?.pricing?.crypto_discount_cents||0);
   const delivery=p?.pricing?.delivery||{};
   const ships=p?.shipping_cents??0,shipBase=delivery.shipping_cents??0;
   const fees=delivery.extras||[];
   const counts=[['Subtotal',subtotal]];
   if(p?.pricing?.membership_discount_cents>0)counts.push([(p.pricing.membership_name||'Membership')+' savings',-p.pricing.membership_discount_cents]);
   if(savings)counts.push(['BLACKFRIDAY15 (15%)',-savings]);
    if(p?.pricing?.quantity_discount_cents>0)counts.push(['Quantity savings',-p.pricing.quantity_discount_cents]);
   if(cryptoSavings)counts.push(['Crypto discount (5%)',-cryptoSavings]);
   if(p?.pricing?.membership_addon)counts.push([p.pricing.membership_addon.name+' — '+(p.pricing.membership_addon.period==='monthly'?'first month':'annual'),p.pricing.membership_addon.fee_cents]);
   counts.push(['Shipping',shipBase]);
   for(const x of fees)counts.push([x.label,x.amount_cents]);
   if(!p&&ships&&!fees.length)counts.push(['Shipping and add-ons',ships]);
   if(p?.tax_cents)counts.push(['Tax',p.tax_cents]);
   counts.push([state.paymentKind==='interac'?'Total (CAD)':'Total',p?.total_cents??(subtotal-savings-cryptoSavings+ships)]);
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
    const price=Math.round(Number(variant.price)*100);
    return '<article><img src="'+esc(photo)+'" alt=""><span><strong>'+esc(item.name)+'</strong><small>'+esc(variant.size)+' · <span data-nlx-cross-sell-price="'+price+'">'+usdDisplay(price)+'</span></small></span><button type="button" data-nlx-cross-sell-add="'+esc(item.id)+'" data-size="'+esc(variant.size)+'">Add</button></article>';
   }).join('')+'</div></section>';
  }
  function renderSummary(){
   const items=snapshotCart();
   view('.nlx-summary-head h2',detail).textContent=state.paymentKind==='interac'?'Order Summary · CAD':'Order Summary';
   view('[data-nlx-item-count]',detail).textContent=items.reduce((n,x)=>n+x.qty,0)+' items';
   view('[data-nlx-protection]',detail).innerHTML=isActive('protection')?'<div class="nlx-protection-body"><span class="nlx-shield">'+shieldIcon+'</span><div class="nlx-protection-copy"><strong><span class="nlx-protection-lock" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg></span>Shipping Protection</strong><button type="button" class="nlx-disclosure-trigger" data-testid="protection-disclosure" data-nlx-info="protection" aria-controls="nlx-protection-detail" aria-expanded="false">Read more</button><div class="nlx-disclosure" id="nlx-protection-detail" data-testid="protection-disclosure-panel" data-nlx-panel hidden><p>'+esc(optionsById.protection.description||'Optional protection for eligible shipments.')+'</p><a href="/shipping-protection.html">Full shipping protection policy</a></div></div><span class="nlx-protection-price">'+extraDisplay('protection')+'</span><label class="nlx-mini-check"><input type="checkbox" data-nlx-extra="protection" '+(state.extras.has('protection')?'checked':'')+' aria-label="Shipping protection"></label></div>':'';
   view('[data-nlx-products]',detail).innerHTML='<div class="nlx-product-head"><span>PRODUCT</span><span>SUBTOTAL</span></div>'+items.map(x=>{
    const image=window.AltaStore?.image?.(window.AltaStore.product(x.id),x.size)||'';
    const line=currentPreview?.pricing?.lines?.find(item=>item.id===x.id&&item.size===x.size&&item.qty===x.qty);
    const amount=currentPreview?.currency===paymentCurrency()&&Number.isSafeInteger(line?.gross_cents)?currentMoney(line.gross_cents):paymentCurrency()==='USD'?usd(Math.round(x.price*100)*x.qty):'Calculating…';
    return '<div class="nlx-product"><button type="button" class="nlx-remove" data-nlx-remove="'+esc(x.key)+'" aria-label="Remove '+esc(x.name)+'">×</button><img src="'+esc(image)+'" alt=""><div class="nlx-product-name"><strong>'+esc(x.name)+'</strong><div class="nlx-size-line"><small>'+esc(x.size)+'</small>'+'</div><div class="nlx-qty"><button data-nlx-qty="-1" data-key="'+esc(x.key)+'" aria-label="Decrease quantity">−</button><span>'+x.qty+'</span><button data-nlx-qty="1" data-key="'+esc(x.key)+'" aria-label="Increase quantity">+</button></div></div><strong class="nlx-product-price">'+amount+'</strong></div>';
   }).join('');
   if(currentPreview?.pricing?.membership_addon){
     const member=currentPreview.pricing.membership_addon;
     view('[data-nlx-products]',detail).insertAdjacentHTML('beforeend','<div class="nlx-product nlx-membership-line"><button type="button" class="nlx-remove" data-nlx-remove-membership aria-label="Remove membership">×</button><div class="nlx-product-name"><strong>'+esc(member.name)+'</strong><span class="nlx-membership-period">'+esc(member.period==='monthly'?'First month':'Annual')+'</span></div><strong class="nlx-product-price">'+currentMoney(member.fee_cents)+'</strong></div>');
   }
   view('[data-nlx-totals]',detail).innerHTML=currentPreview?moneyLines().map(([n,v])=>'<div class="'+(['Total','Total (CAD)'].includes(n)?'nlx-grand':'')+'"><span>'+esc(n)+'</span><strong>'+currentMoney(v)+'</strong></div>').join(''):'<p role="status">Calculating your order total…</p>';
   window.PureMembershipCheckout?.offer(view('[data-pure-membership-offer]',detail),currentPreview,data.terms?.conversion,{
     selection:state.membershipChoice,
     onSelect:choice=>{state.membershipChoice=choice;renderSummary();},
     onAdd:addon=>{state.membershipAddon={plan:addon.plan,period:addon.period};sessionStorage.setItem('pure-checkout-membership-item-v1',JSON.stringify(state.membershipAddon));invalidate();renderSummary();void refresh();},
     onRemove:()=>{state.membershipAddon=null;sessionStorage.removeItem('pure-checkout-membership-item-v1');invalidate();renderSummary();void refresh();}
   });
   const removeMember=view('[data-nlx-remove-membership]',detail);
   if(removeMember)removeMember.onclick=()=>{state.membershipAddon=null;sessionStorage.removeItem('pure-checkout-membership-item-v1');invalidate();renderSummary();void refresh();};
   const balances=view('[data-nlx-points]',detail),hasBalance=(data.balances?.points||0)>0||(data.balances?.credit_cents||0)>0;balances.hidden=!hasBalance;balances.innerHTML=hasBalance?'<span>Available: '+Math.max(0,data.balances.points||0)+' points · '+usd(data.balances.credit_cents||0)+' store credit.</span>'+(state.paymentKind==='interac'?'<span>USD points and store credit cannot be applied to an Interac payment. Choose Card or Crypto to use these balances.</span>':'<a href="/checkout?balance=1">Use existing balance →</a>'):'';
   view('[data-nlx-quote-note]',detail).textContent='';
   view('[data-nlx-remove-coupon]',detail).hidden=!state.coupon;
   const coupon=view('[name=sidebar_coupon]',detail);if(document.activeElement!==coupon)coupon.value=state.coupon;
   wireDisclosures(detail);
   all('[data-nlx-extra="protection"]',detail).forEach(x=>x.addEventListener('change',()=>{
    if(onePayment||lastPlaced)return;
    x.checked?state.extras.add('protection'):state.extras.delete('protection');
    try{sessionStorage.setItem(protectionKey,String(x.checked));}catch{}
    schedule();refresh();
   }));
   all('[data-nlx-remove]',detail).forEach(b=>b.addEventListener('click',()=>{
    if(onePayment||lastPlaced)return;
    const item=snapshotCart().find(x=>x.key===b.dataset.nlxRemove);
    if(!item)return;
    window.AltaStore?.adjustQuantity?.(item.key,-item.qty);
    invalidate();renderSummary();refresh();
   }));
   all('[data-nlx-qty]',detail).forEach(b=>b.addEventListener('click',()=>{
    if(onePayment||lastPlaced)return;
    const before=snapshotCart().find(x=>x.key===b.dataset.key);
    if(!before)return;
    if(Number(b.dataset.nlxQty)>0&&before.qty>=100)return;
    window.AltaStore?.adjustQuantity?.(before.key,Number(b.dataset.nlxQty));
    invalidate();
    renderSummary();refresh();
   }));
   syncCurrencyDisplays();if(onePayment||lastPlaced)lockCheckout();
  }
  function invalidate(){if(lastPlaced||onePayment)return;sessionStorage.setItem(cartKey(snapshotCart()),JSON.stringify([...state.extras]));quoteVersion++;loadingPreview=false;view('[data-nlx-place]',div)?.setAttribute('disabled','');quote=null;currentPreview=null;orderId=crypto.randomUUID();}
  const refresh=async(candidate=state.coupon,action='refresh')=>{
   if(lastPlaced||onePayment)return;
   const apply=view('[data-nlx-coupon]',detail),remove=view('[data-nlx-remove-coupon]',detail),message=view('[data-nlx-coupon-status]',detail);
   apply.disabled=true;remove.disabled=true;
   if(action!=='refresh')message.textContent=action==='remove'?'Removing coupon…':'Checking coupon…';
   try{
    const q=await fetchPreview(candidate);
    if(q){
     renderSummary();
     message.textContent=state.coupon?'BLACKFRIDAY15 applied — 15% off merchandise.':action==='remove'?(q.pricing?.crypto_discount_cents?'Coupon removed. The 5% crypto discount applies.':'Coupon removed. Regular prices restored.'):'';
     syncCurrencyDisplays();
     if(stage===2)updatePayment();
    }
   }catch(error){
    loadingPreview=false;
    if(action!=='refresh'){await refresh();message.textContent=error.message;}else{view('[data-nlx-quote-note]',detail).textContent=error.message;note(error.message,true);}
   }finally{apply.disabled=!!(lastPlaced||onePayment);remove.disabled=!!(lastPlaced||onePayment);}
  };
  function schedule(){if(lastPlaced||onePayment)return;invalidate();clearTimeout(quoteTimer);quoteTimer=setTimeout(refresh,180);}
  function showStep(i){if(lastPlaced||onePayment){note('This order is already saved. Check its payment status before making a new order.',true);return;}stage=i;all('[data-nlx-step]',div).forEach((b,n)=>{
    b.classList.toggle('nlx-step-active',n===i);b.classList.toggle('nlx-step-done',n<i);
    b.setAttribute('aria-current',n===i?'step':'false');});
    renderStep();
    if(mobileLayout?.matches)view('.nlx-left',div).scrollIntoView({behavior:'auto',block:'start'});
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
  // Estimated dates use US Eastern calendar days and skip weekends.
  // Friday orders begin at Monday handoff; holidays/carrier exceptions are excluded.
  function arrivalDate(id,now=new Date()){
    const p=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
    const n=k=>Number(p.find(x=>x.type===k)?.value);
    const date=new Date(Date.UTC(n('year'),n('month')-1,n('day'),12));
    if(date.getUTCDay()===5)date.setUTCDate(date.getUTCDate()+3);
    else if(date.getUTCDay()===6)date.setUTCDate(date.getUTCDate()+2);
    else if(date.getUTCDay()===0)date.setUTCDate(date.getUTCDate()+1);
    let days={economy:6,standard:3,express:2,next_day:1}[id]||6;
    while(days>0){date.setUTCDate(date.getUTCDate()+1);if(![0,6].includes(date.getUTCDay()))days--;}
    return date;
  }
  const arrivalLabel=id=>id==='next_day'?'Next business day after dispatch':'Estimated arrival '+new Intl.DateTimeFormat('en-US',{timeZone:'UTC',weekday:'short',month:'short',day:'numeric'}).format(arrivalDate(id));
  function deliveryCards(){
   const rates=data.shipping_zones||{};
   const country=shippingCountry();const map=rates[country]||rates.OTHER||{};
   const options=['economy','standard','express','next_day'].map((id,i)=>{const x=optionsById[id];if(!x)return'';
    const regularAmount=map[id],eligible=x.enabled&&Number.isSafeInteger(regularAmount);const amount=['economy','standard'].includes(id)&&['US','CA'].includes(country)&&currentPreview?.free_shipping_remaining_cents===0?0:regularAmount;
    return '<label class="nlx-delivery-card '+(state.shipping===id?'nlx-chosen':'')+(eligible?'':' nlx-disabled')+'"><input type="radio" name="delivery_speed" value="'+id+'" '+(state.shipping===id?'checked ':'')+(eligible?'':'disabled')+'><span class="nlx-delivery-desc"><strong>'+esc(x.label)+'</strong><small>'+esc(arrivalLabel(id))+'</small></span><span class="nlx-delivery-price">'+(eligible?deliveryDisplay(id,amount):'Unavailable')+'</span></label>';
   }).join('');
   const extra=(data.membership?.benefits?.priority_fulfillment?[]:['priority']).map(id=>{const x=optionsById[id];if(!x)return'';
    const target='nlx-disclose-priority';
    return '<div class="nlx-extra-box nlx-extra-'+id+'"><div><span class="nlx-extra-icon">◷</span><div><strong>'+esc(x.label)+'</strong><button type="button" class="nlx-disclosure-trigger" data-nlx-info="'+id+'" data-testid="priority-disclosure" aria-expanded="false" aria-controls="'+target+'">Read more</button><div id="'+target+'" data-testid="priority-disclosure-panel" data-nlx-panel class="nlx-disclosure" hidden><p>'+esc(x.description)+'</p><p>Optional service; pricing is included only when selected in the final quote.</p></div></div></div><span data-nlx-extra-price="'+id+'">'+extraDisplay(id)+'</span><label class="nlx-extra-check"><input type="checkbox" aria-label="'+esc(x.label)+'" data-nlx-extra="'+id+'" '+(state.extras.has(id)?'checked':'')+(x.enabled?'':' disabled')+'></label></div>';
   }).join('');
   return '<h2>Delivery speed</h2><div class="nlx-delivery-list">'+options+'</div><div class="nlx-addons">'+extra+'</div>';
  }
  function lockCheckout(){all('input,select,textarea,button',div).forEach(control=>control.disabled=true);}
  function updatePayment(){
   const button=view('[data-nlx-place]',div);if(!button)return;
   const method=selectedMethod();
   all('.nlx-payment-choice',form).forEach(row=>{const chosen=row.querySelector('[name=payment_choice]').value===state.paymentKind;row.querySelector('.nlx-payment-choice-body').hidden=!chosen;row.classList.toggle('nlx-selected',chosen);});
   button.disabled=!(method&&currentPreview&&!loadingPreview&&!onePayment&&!lastPlaced&&form.elements.ruo?.checked&&form.elements.responsibility?.checked);
   const walletName=state.wallet==='apple'?'APPLE PAY':state.wallet==='google'?'GOOGLE PAY':null;
   button.textContent=(method?(state.paymentKind==='interac'?'PLACE ORDER':state.paymentKind==='card'?'CONTINUE TO '+(walletName||'CARD PAYMENT'):'CONTINUE TO CRYPTO PAYMENT'):'PAYMENT UNAVAILABLE')+' · '+currentMoney(currentPreview?.total_cents);
   const card=paymentMethods.find(m=>paymentKind(m)==='card'&&m.countries?.includes(shippingCountry()));
   all('[data-nlx-wallet]',form).forEach(control=>{control.disabled=!card||onePayment||!!lastPlaced;control.setAttribute('aria-pressed',String(state.paymentKind==='card'&&state.wallet===control.dataset.nlxWallet));});
   const amount=view('[data-nlx-wallet-amount]',form);if(amount)amount.textContent=state.paymentKind==='interac'?'Card payments in USD':usd(currentPreview?.total_cents||0);
     }
  function paymentLayout(){
   const rows=['card','crypto',...(paymentMethods.some(m=>paymentKind(m)==='interac')?['interac']:[])].map(key=>{
    const method=paymentMethods.find(m=>paymentKind(m)===key),available=method&&Array.isArray(method.countries)&&method.countries.includes(shippingCountry());
    const description=key==='interac'?'Pay in Canadian dollars by Interac e-Transfer. Your final CAD total is shown before you place the order. Receiving details and your payment reference appear immediately afterward.':key==='card'
     ? 'Secure card-to-crypto checkout. The provider displays its fees, conversion rate and final charge before you pay. Available cards and digital wallets depend on your country, device and provider eligibility.'
     : method?'Pay USDC directly on Polygon from a compatible browser wallet. You need USDC and POL for gas. Review the exact amount, recipient and authorization before you sign; payment is confirmed on chain before fulfillment.'
     :'Direct USDC on Polygon is being configured. No wallet transfer is requested until the receiving address and on-chain payment confirmation are verified.';
    return '<div class="nlx-payment-choice'+(!available?' nlx-payment-pending':'')+'"><label class="nlx-payment-option"><input type="radio" name="payment_choice" value="'+key+'" '+(state.paymentKind===key?'checked ':'')+(!available?'disabled ':'')+'><span>'+(key==='interac'?'Interac e-Transfer (CAD)':key==='card'?'Card':'Crypto')+'</span><span class="nlx-payment-state">'+(available?(key==='interac'?'CAD PAYMENT':key==='crypto'?'EXTRA 5% OFF':'SECURE CHECKOUT'):method?'UNAVAILABLE FOR DESTINATION':'SETUP PENDING')+'</span></label><div class="nlx-payment-choice-body" '+(state.paymentKind===key?'':'hidden')+'><p>'+description+'</p>'+(key==='crypto'?'<small>Save an extra 5% on merchandise after any applied coupon. Shipping, tax and fees, including protection, are excluded.</small>':'')+'</div></div>';
   }).join('');
   return '<section class="nlx-payment"><h2>Choose how to pay</h2><div class="nlx-express-label"><strong>DIGITAL WALLET</strong><span data-nlx-wallet-amount>'+(state.paymentKind==='interac'?'Card payments in USD':usd(currentPreview?.total_cents||0))+'</span></div>'
    +'<div class="nlx-wallets" data-nlx-wallets><button type="button" class="nlx-wallet-button nlx-apple-pay" data-nlx-wallet="apple" aria-label="Choose Apple Pay" aria-pressed="false"><span class="nlx-wallet-lockup"><img class="nlx-wallet-symbol nlx-apple-symbol" src="/assets/payment-brands/apple-mark-clean.svg" alt="" aria-hidden="true" width="20" height="24"><span class="nlx-wallet-wordmark">Pay</span></span></button><span class="nlx-or">or</span><button type="button" class="nlx-wallet-button nlx-google-pay" data-nlx-wallet="google" aria-label="Choose Google Pay" aria-pressed="false"><span class="nlx-wallet-lockup"><img class="nlx-wallet-symbol nlx-google-symbol" src="/assets/payment-brands/google-g-clean.svg" alt="" aria-hidden="true" width="22" height="22"><span class="nlx-wallet-wordmark">Pay</span></span></button></div>'
    +'<div class="nlx-divider"><span>OR PAY ANOTHER WAY</span></div><div class="nlx-payment-rows">'+rows+'</div>'
    +'<div class="nlx-terms"><label><input type="checkbox" name="ruo" required><span>'+esc(terms1)+'</span></label><label><input type="checkbox" name="responsibility" required><span>'+esc(terms2)+'</span></label></div>'
    +'<div class="nlx-payment-controls"><div class="nlx-status" data-nlx-status role="status" aria-live="polite"></div><button type="button" class="nlx-primary" data-nlx-place disabled>CONTINUE TO PAYMENT</button></div>'+trustMarkup+'</section>';
  }
  function renderStep(){
   restoreActions();
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
      +'<label class="nlx-small-check nlx-sms"><input type="checkbox" name="sms_opt" '+(state.smsOptIn?'checked':'')+'><span><strong>Text me order updates and offers.</strong><small>By providing your phone number you agree to receive informational and marketing text messages from PURE. Consent is not a condition of purchase. Message frequency will vary. Msg &amp; data rates may apply. Reply HELP for help or STOP to cancel. <a href="/terms-and-conditions.html">Terms</a> &amp; <a href="/privacy-policy.html">Privacy</a>.</small></span></label>'
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
    form.elements.country.addEventListener('change',()=>{state.country=shippingCountry();if(state.paymentKind==='interac'&&!selectedMethod()){state.paymentKind='card';state.wallet=null;}localStorage.setItem('ap-shipping-country',state.country);const rates=data.shipping_zones?.[state.country]||data.shipping_zones?.OTHER||{};if(!Number.isSafeInteger(rates[state.shipping]))state.shipping='economy';schedule();});
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
    form.innerHTML='<div class="nlx-step-delivery"><div class="nlx-address-confirm"><div class="nlx-address-lines">'+displayAddress()+'<span>'+esc(state.phone||'')+'</span><span>'+esc(user.email)+'</span></div><button type="button" data-nlx-back-edit>Edit</button></div>'+deliveryCards()
      +'<details class="nlx-order-note"><summary>Add order notes (optional)</summary><textarea name="note" rows="3" maxlength="1000" placeholder="Special handling instructions">'+esc(state.note)+'</textarea></details>'
            +'<div class="nlx-next"><button type="button" class="nlx-primary" data-nlx-next>Continue to payment</button></div>'+trustMarkup+'</div>';
    all('[name=delivery_speed]',form).forEach(x=>x.addEventListener('change',()=>{state.shipping=x.value;schedule();renderStep()}));
    all('[data-nlx-extra]',form).forEach(x=>x.addEventListener('change',()=>{x.checked?state.extras.add(x.dataset.nlxExtra):state.extras.delete(x.dataset.nlxExtra);schedule();renderSummary()}));
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
      +'<div><strong>DELIVERY</strong><span>'+esc(optionsById[state.shipping]?.label||'Standard delivery')+' · <span data-nlx-confirm-shipping-price>'+currentMoney(currentPreview?.pricing?.delivery?.shipping_cents)+'</span> · <strong class="nlx-arrival-confirm">'+esc(arrivalLabel(state.shipping))+'</strong>'+(state.extras.has('protection')?' <em class="nlx-protection-confirm">✓ Shipping Protection</em>':'')+'</span><button type="button" data-nlx-edit="1">Edit</button></div></div>'
      +paymentLayout()+'</div>';
    all('[data-nlx-edit]',form).forEach(x=>x.addEventListener('click',()=>showStep(Number(x.dataset.nlxEdit))));
    all('[name=payment_choice]',form).forEach(control=>control.addEventListener('change',()=>{
     if(control.disabled||onePayment||lastPlaced)return;state.paymentKind=control.value;state.wallet=null;invalidate();updatePayment();renderSummary();void refresh();
    }));
    all('[data-nlx-wallet]',form).forEach(control=>control.addEventListener('click',()=>{
     if(control.disabled||onePayment||lastPlaced)return;
     const changed=state.paymentKind!=='card';state.wallet=control.dataset.nlxWallet;state.paymentKind='card';
     const cardControl=view('[name=payment_choice][value=card]',form);if(cardControl)cardControl.checked=true;
     if(changed){invalidate();renderSummary();void refresh();}
     updatePayment();
    }));
    all('[name=ruo],[name=responsibility]',form).forEach(control=>control.addEventListener('change',updatePayment));
    view('[data-nlx-place]',form).addEventListener('click',async()=>{
     const method=selectedMethod();
     if(!method||!currentPreview||loadingPreview||onePayment||lastPlaced||!form.elements.ruo?.checked||!form.elements.responsibility?.checked)return;
     onePayment=true;quoteVersion++;lockCheckout();
     try{
      const body={...draft(true),method_id:method.id,research_use:true,consent:true};
      note('Verifying your order total…');
      const q=await window.DirectCheckout.api(auth,{...body,action:'quote'});
      if(!q?.quote||q.total_cents!==currentPreview.total_cents||q.currency!==currentPreview.currency||!!q.request_only!==!!currentPreview.request_only||state.paymentKind==='interac'&&q.pricing?.fx_ppm!==currentPreview.pricing?.fx_ppm)throw Error('Your total changed. Review the updated order before continuing.');
      if(state.paymentKind==='interac'&&(q.request_only===true||q.currency!=='CAD'||!q.fx_quote))throw Error('Your CAD total could not be verified. Refresh checkout before placing the order.');
      if(state.paymentKind==='interac')body.fx_quote=q.fx_quote;
      lastPlaced=body.id;note('Saving your order…');
      const result=await window.DirectCheckout.api(auth,{...body,action:'place',quote:q.quote});
      if(result?.id!==lastPlaced)throw Error('The saved order reference could not be verified.');
      if(state.paymentKind==='interac'&&(result.currency!=='CAD'||result.manual_transfer!==true||result.total_cents!==q.total_cents||result.request_only===true||result.status!=='accepted'&&!(result.replayed===true&&['paid','processing','shipped','delivered','void','refunded'].includes(result.status))))throw Error('The Interac order could not be verified. Check its status before trying again.');
      let destination='/account/purchases?id='+encodeURIComponent(lastPlaced);
      if(state.paymentKind==='interac')note('Your order is saved. Opening Interac payment details…');
      else if(q.total_cents>0){
       note(state.paymentKind==='card'?'Opening secure card payment…':'Opening USDC wallet payment…');
       if(typeof window.DirectCheckout.openHostedPayment!=='function')throw Error('Open your saved order to continue payment.');
       const payment=await window.DirectCheckout.openHostedPayment(auth,lastPlaced,q.total_cents,q.currency,method,{country:(state.billingData||state.shippingData||formatAddress()).country});
       if(!payment.paid)destination=payment.url;
      }
      const current=snapshotCart().map(({id,size,qty})=>({id,size,qty}));
      if(!['void','refunded'].includes(result.status)&&JSON.stringify(current)===JSON.stringify(body.items))localStorage.removeItem('pp-cart');
      sessionStorage.removeItem('ap-checkout-id');sessionStorage.removeItem('ap-checkout-fingerprint');sessionStorage.removeItem('pure-checkout-membership-item-v1');
      location.assign(destination);
     }catch(error){
      if(lastPlaced){
       note('Your order reference is '+lastPlaced+'. '+error.message+' Check its status before starting another order.',true);
       const link=el('a','nlx-view-order','CHECK SAVED ORDER');link.href='/account/purchases?id='+encodeURIComponent(lastPlaced);status().append(document.createTextNode(' '),link);
      }else{
       onePayment=false;all('input,select,textarea,button',div).forEach(control=>control.disabled=false);
       all('[name=payment_choice]',form).forEach(control=>{const method=paymentMethods.find(m=>paymentKind(m)===control.value);control.disabled=!method||!method.countries.includes(shippingCountry());});
       await refresh();updatePayment();note(error.message,true);
      }
     }
    });
    updatePayment();
   }
   attachActions();renderSummary();
  }
  const changeCoupon=(candidate,action)=>{if(lastPlaced||onePayment)return;clearTimeout(quoteTimer);invalidate();renderSummary();void refresh(candidate,action);};
  view('[data-nlx-coupon]',detail).addEventListener('click',()=>changeCoupon(view('[name=sidebar_coupon]',detail).value.trim().toUpperCase(),'apply'));
  view('[data-nlx-remove-coupon]',detail).addEventListener('click',()=>changeCoupon('','remove'));
  view('[name=sidebar_coupon]',detail).addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();view('[data-nlx-coupon]',detail).click();}});
  all('[data-nlx-step]',div).forEach(b=>b.addEventListener('click',()=>{const s=Number(b.dataset.nlxStep);if(s<=stage)showStep(s);}));
  renderStep();refresh();
 }
 const current=window.DirectCheckout;
 if(current){current.checkout=checkout;window.AltaCheckoutReference={checkout};}
})();
