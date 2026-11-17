/* UI capability gates use the server's verified payment and delivery configuration. */
(()=>{
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format((n||0)/100);
 const empty=(title,text)=>`<div class="rd-empty"><span aria-hidden="true">◇</span><h3>${title}</h3><p>${text}</p><a class="ap-button" href="/shop">Start Shopping</a></div>`;
 function walletButtons(c={}){return `<div class="rd-wallets" aria-label="Express checkout">${[['apple_pay','Apple Pay'],['google_pay','Google Pay']].map(([key,label])=>c[key]?`<a class="rd-wallet" href="/checkout?method=${encodeURIComponent(c.card_method_id)}&wallet=${key}">${label}</a>`:`<button type="button" class="rd-wallet" disabled data-unavailable="true" aria-label="${label} — awaiting activation">${label}<small>Awaiting activation</small></button>`).join('')}</div>`;}
 const cartKey=items=>'ap-v2-cart-extras:'+JSON.stringify(items.map(({id,size,qty})=>({id,size,qty})));
 const protectionKey='ap-checkout-protection';
 function wantsProtection(items){
  try{
   const choice=sessionStorage.getItem(protectionKey);
   if(choice==='true'||choice==='false')return choice==='true';
   const prior=JSON.parse(sessionStorage.getItem(cartKey(items))||'null');
   if(Array.isArray(prior)&&(prior.includes('protection')||(localStorage.getItem('ap-shipping-country')||'US')==='US')){
    const selected=prior.includes('protection');sessionStorage.setItem(protectionKey,String(selected));return selected;
   }
  }catch{}
  try{sessionStorage.setItem(protectionKey,'true');}catch{}
  return true;
 }
 function delivery(data,cart=[]){
  const options=data.delivery_options||[];
  return `<h3>Delivery speed</h3><p>Free standard US shipping on merchandise orders of $150 after discounts.</p><div class="rd-delivery-grid">${options.filter(o=>o.kind==='shipping').map(o=>`<label class="rd-delivery ${!o.enabled?'rd-unavailable':''}"><input type="radio" name="shipping_speed" value="${esc(o.id)}" ${o.id==='standard'?'checked':''} ${!o.enabled?'disabled data-unavailable="true"':''}><strong>${esc(o.label)}</strong><span data-rd-shipping-price="${esc(o.id)}">${money(o.price_cents)}</span><small>${esc(o.description)}</small>${!o.enabled?'<em>Not available yet</em>':''}</label>`).join('')}</div><div class="rd-delivery-extras">${options.filter(o=>o.kind==='extra').map(o=>`<label class="rd-extra ${!o.enabled?'rd-unavailable':''}"><input type="checkbox" name="delivery_extra" value="${esc(o.id)}" ${o.id==='protection'&&o.enabled&&wantsProtection(cart)?'checked ':''}${!o.enabled?'disabled data-unavailable="true"':''}><span><strong>${esc(o.label)}</strong><small>${esc(o.description)}</small>${o.id==='protection'?'<a href="/shipping-protection.html">Shipping protection terms</a>':''}${!o.enabled?'<em>Not available yet</em>':''}</span><b>${money(o.price_cents)}</b></label>`).join('')}</div>`;
 }
 function selection(form){return{shipping:form.elements.shipping_speed?.value||'standard',extras:[...form.querySelectorAll('[name=delivery_extra]:checked')].map(x=>x.value)};}
 function enhanceCheckout(form,aside,auth,cart,data){
  // Card wallets are offered by the hosted provider when eligible; no placeholder native buttons.

  if(!cart.length||!form.elements.line1)return;
  const optionsById=Object.fromEntries((data.delivery_options||[]).map(option=>[option.id,option]));
  const savedExtras=(()=>{try{return JSON.parse(sessionStorage.getItem(cartKey(cart))||'null');}catch{return null;}})();
  for(const input of form.querySelectorAll('[name=delivery_extra]')){
   input.checked=!!optionsById[input.value]?.enabled&&(input.value==='protection'?wantsProtection(cart):Array.isArray(savedExtras)&&savedExtras.includes(input.value));
  }
  function syncDelivery(quote){
   const country=form.elements.country?.value||'US';
   const fallback=Object.fromEntries((data.delivery_options||[]).filter(o=>o.kind==='shipping').map(o=>[o.id,o.price_cents]));
   const rates=data.shipping_zones?.[country]||data.shipping_zones?.OTHER||(country==='US'?fallback:{});
   for(const input of form.querySelectorAll('[name=shipping_speed]')){
    const eligible=!!optionsById[input.value]?.enabled&&Number.isSafeInteger(rates[input.value]);
    input.disabled=!eligible;if(!eligible)input.checked=false;
    input.closest('.rd-delivery')?.classList.toggle('rd-unavailable',!eligible);
    const price=form.querySelector('[data-rd-shipping-price="'+input.value+'"]');
    if(price)price.textContent=!eligible?'Unavailable':input.value==='standard'&&country==='US'&&quote?.free_shipping_remaining_cents===0?'FREE':money(rates[input.value]);
   }
   if(!form.querySelector('[name=shipping_speed]:checked')){const standard=form.querySelector('[name=shipping_speed][value=standard]:not(:disabled)');if(standard)standard.checked=true;}
   try{sessionStorage.setItem(cartKey(cart),JSON.stringify(selection(form).extras));}catch{}
  }
  syncDelivery();
  const estimate=aside.querySelector('.dc-totals'),input=form.elements.coupon,apply=form.querySelector('[data-dc-apply-coupon]'),remove=form.querySelector('[data-dc-remove-coupon]'),status=form.querySelector('[data-dc-coupon-status]');let timer,sequence=0;
  const keys=['ap-checkout-coupon','ap-cart-coupon'];
  const saved=(localStorage.getItem(keys[0])||localStorage.getItem(keys[1])||'').trim().toUpperCase();
  form.dataset.appliedCoupon=saved==='BLACKFRIDAY15'?saved:'';
  keys.forEach(key=>form.dataset.appliedCoupon?localStorage.setItem(key,form.dataset.appliedCoupon):localStorage.removeItem(key));
  if(input)input.value=form.dataset.appliedCoupon;
  async function refresh(candidate=form.dataset.appliedCoupon,action='refresh'){
   const n=++sequence;form.dataset.couponPending='true';if(apply)apply.disabled=true;if(remove)remove.disabled=true;
   if(status&&action!=='refresh')status.textContent=action==='remove'?'Removing coupon…':'Checking coupon…';
   try{
    const session=await auth.auth.getSession(),headers={'Content-Type':'application/json'};if(session.data.session)headers.Authorization='Bearer '+session.data.session.access_token;
    const r=await fetch('/api/customer-config?checkout=cart',{method:'POST',cache:'no-store',headers,body:JSON.stringify({items:cart.map(({id,size,qty})=>({id,size,qty})),coupon:candidate,method_id:form.elements.method_id.value,country:form.elements.country?.value||'US',delivery:selection(form)})}),q=await r.json();
    if(n!==sequence)return;if(!r.ok||!Number.isSafeInteger(q.total_cents))throw Error(q.error||'Could not calculate your total.');
    form.dataset.appliedCoupon=q.pricing?.coupon_code==='BLACKFRIDAY15'?'BLACKFRIDAY15':'';
    keys.forEach(key=>form.dataset.appliedCoupon?localStorage.setItem(key,form.dataset.appliedCoupon):localStorage.removeItem(key));
    if(input)input.value=form.dataset.appliedCoupon;if(remove)remove.hidden=!form.dataset.appliedCoupon;
    if(status)status.textContent=form.dataset.appliedCoupon?'BLACKFRIDAY15 applied — 15% off merchandise.':action==='remove'?(q.pricing?.crypto_discount_cents>0?'Coupon removed. Your 5% Crypto discount still applies.':'Coupon removed. Regular prices restored.'):'';
    const rows=[['Subtotal',q.subtotal_cents]];
    if(q.pricing?.coupon_discount_cents>0)rows.push(['BLACKFRIDAY15 (15%)',-q.pricing.coupon_discount_cents]);
    if(q.pricing?.crypto_discount_cents>0)rows.push(['Crypto discount (5%)',-q.pricing.crypto_discount_cents]);
    rows.push(['Delivery & options',q.shipping_cents],['Estimated total',q.total_cents]);
    estimate.innerHTML=rows.map(([label,v])=>`<div class="dc-total-row"><span>${label}</span><strong>${money(v)}</strong></div>`).join('')+(q.pricing?.discount_source==='coupon_crypto'?'<p class="dc-note">Your coupon is applied first, then an extra 5% Crypto discount on the remaining merchandise.</p>':'')+'<p class="dc-note">Existing points and store credit are applied when you review the final total.</p>';
    syncDelivery(q);
   }catch(error){if(n===sequence&&status)status.textContent=error.message;}
   finally{if(n===sequence){form.dataset.couponPending='false';if(apply)apply.disabled=false;if(remove)remove.disabled=false;}}
  }
  const change=(candidate,action)=>{clearTimeout(timer);form.dispatchEvent(new Event('input',{bubbles:true}));void refresh(candidate,action);};
  apply?.addEventListener('click',()=>change(input.value.trim().toUpperCase(),'apply'));
  remove?.addEventListener('click',()=>change('','remove'));
  input?.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();apply?.click();}});
  const onDeliveryChange=event=>{
   if(!['method_id','shipping_speed','delivery_extra','country'].includes(event.target.name))return;
   if(event.target.name==='delivery_extra'&&event.target.value==='protection'){
    try{sessionStorage.setItem(protectionKey,String(event.target.checked));}catch{}
   }
   if(event.target.name==='country')localStorage.setItem('ap-shipping-country',event.target.value);
   syncDelivery();clearTimeout(timer);timer=setTimeout(()=>refresh(),180);
  };
  form.addEventListener('input',onDeliveryChange);
  form.addEventListener('change',onDeliveryChange);
  void refresh();
 }
 async function overview(root,auth,user){try{const [d,o]=await Promise.all([window.DirectCheckout.api(auth),window.DirectCheckout.api(auth,null,'orders')]);const paid=o.invoices.filter(order=>['paid','processing','shipped','delivered'].includes(order.status));
  root.innerHTML=`<div class="rd-welcome"><small>YOUR ACCOUNT</small><h1>Hey, ${esc(user.user_metadata?.first_name||user.user_metadata?.full_name?.split(' ')[0]||'researcher')}.</h1><span>Orders, saved details and balances</span></div><div class="rd-overview-grid"><section class="ae-panel"><h2>Your orders</h2><p>Review purchases, payment status and tracking.</p><a href="/account/purchases">View orders →</a></section><section class="ae-panel rd-points"><small>POINTS BALANCE</small><strong>${d.balances.points}</strong><p>${money(d.balances.credit_cents)} store credit</p><a href="/account/points">View points →</a> · <a href="/account/store-credit">View store credit →</a></section></div><div class="rd-stat-grid"><article><strong>${o.invoices.length}</strong><span>Orders in current checkout</span></article><article><strong>${money(paid.reduce((n,x)=>n+x.total_cents,0))}</strong><span>Paid order total</span></article><article><strong>${money(d.balances.credit_cents)}</strong><span>Available store credit</span></article></div><div class="rd-quick-links">${[['Partner Program','Referral codes, earnings and payouts','partner'],['Profile','Contact details and saved addresses','profile'],['Orders','Purchases, history and tracking','purchases']].map(([a,b,path])=>`<a href="/account/${path}"><strong>${a}</strong><span>${b}</span><b>Open →</b></a>`).join('')}</div><section class="ae-panel"><h2>Recent orders</h2>${o.invoices.length?'<div class="rd-table"><table><thead><tr><th>Order</th><th>Date</th><th>Status</th><th>Total</th></tr></thead><tbody>'+o.invoices.slice(0,5).map(order=>`<tr><td><a href="/account/purchases?id=${encodeURIComponent(order.id)}">ORD-${esc(order.id.slice(0,8).toUpperCase())}</a></td><td>${new Date(order.created_at).toLocaleDateString()}</td><td>${esc(order.status==='accepted'?'Awaiting payment':order.status)}</td><td>${money(order.total_cents)}</td></tr>`).join('')+'</tbody></table></div>':empty('No orders yet','Your orders and tracking will appear here.')}<a href="/account/purchases">All orders, including historical purchases →</a></section><a href="/account/requests">Support requests →</a>`;
 }catch(error){root.textContent=error.message;}}
 async function balance(root,auth,path){try{const data=await window.DirectCheckout.api(auth),points=path.endsWith('points'),rows=data.events.filter(event=>event.asset===(points?'points':'credit'));root.innerHTML=`<section class="ae-panel rd-balance"><small>AVAILABLE BALANCE</small><h2>${points?data.balances.points+' points':money(data.balances.credit_cents)}</h2><p>${points?'Use your existing points at checkout. Redeem 100 points for $1; minimum 100 points.':'Use your USD store credit for products and delivery at checkout. You choose how much to apply.'}</p><a href="/shop">Shop products →</a></section><section class="ae-panel"><h2>${points?'Points':'Store credit'} history</h2><p>Credits, redemptions and adjustments on your account. Showing the latest ${rows.length} entries.</p>${rows.length?'<div class="rd-table"><table><thead><tr><th>Date</th><th>Detail</th><th>Amount</th></tr></thead><tbody>'+rows.map(event=>`<tr><td>${new Date(event.created_at).toLocaleDateString()}</td><td>${esc(event.reason)}</td><td>${event.delta>0?'+':''}${points?event.delta:money(event.delta)}</td></tr>`).join('')+'</tbody></table></div>':empty('No activity yet','Your credits and redemptions will appear here.')}<p class="dc-note">Redemptions are reserved when an order is placed. Cancellation of an unpaid order or a full refund restores them. Balances do not automatically expire.</p></section>`;}catch(error){root.textContent=error.message;}}
 window.ReadinessUI={walletButtons,delivery,selection,enhanceCheckout,overview,balance};
})();
