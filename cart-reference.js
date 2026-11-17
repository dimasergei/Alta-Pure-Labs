(()=>{
 'use strict';
 const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format((Number(n)||0)/100);
 const html=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const couponKeys=['ap-checkout-coupon','ap-cart-coupon'];
 const saveCoupon=value=>couponKeys.forEach(key=>value?localStorage.setItem(key,value):localStorage.removeItem(key));
 const storedCoupon=()=>{const code=(localStorage.getItem(couponKeys[0])||localStorage.getItem(couponKeys[1])||'').trim().toUpperCase();const valid=code==='BLACKFRIDAY15'?code:'';saveCoupon(valid);return valid;};
 let seq=0,config=null;
 const methods=async()=>{
  if(config)return config;
  const r=await fetch('/api/customer-config?checkout=public',{cache:'no-store'});
  if(!r.ok)throw Error('Checkout details are not available.');
  return config=await r.json();
 };
 const cartKey=items=>'ap-v2-cart-extras:'+JSON.stringify(items.map(({id,size,qty})=>({id,size,qty})));
 const protectionKey='ap-checkout-protection';
 function extras(items){
  let prior=null,choice=null;
  try{
   prior=JSON.parse(sessionStorage.getItem(cartKey(items))||'null');choice=sessionStorage.getItem(protectionKey);
   // Migrate an existing US checkout choice; international carts previously had no protection control.
   if(choice!=='true'&&choice!=='false'&&Array.isArray(prior)&&(prior.includes('protection')||(localStorage.getItem('ap-shipping-country')||'US')==='US')){
    choice=String(prior.includes('protection'));sessionStorage.setItem(protectionKey,choice);
   }
  }catch{}
  if(choice!=='true'&&choice!=='false'){choice='true';try{sessionStorage.setItem(protectionKey,choice);}catch{}}
  const selected=new Set(Array.isArray(prior)?prior.filter(id=>id!=='protection'):[]);
  if(choice!=='false')selected.add('protection');
  return [...selected];
 }
 async function offer(root){
  if(!root?.isConnected)return;
  const items=window.AltaStore?.cart||[];
  if(!items.length)return;
  const selected=new Set(extras(items)),catalog=window.AltaStore?.catalog||[];
  const picks=catalog.filter(p=>!items.some(x=>x.id===p.id)&&p.variants?.length).slice(0,5);
  let appliedCoupon=storedCoupon(),hasQuote=false;
  root.innerHTML='<div class="nlc-scrollable-items cart__body" data-testid="cart-product-scroll">'
   +'<div class="nlc-unlock"><p data-nlc-unlock-copy>Free standard US shipping on orders of <strong>$150</strong> after discounts.</p><div class="nlc-progress" role="progressbar" aria-label="Free standard US shipping progress" aria-valuemin="0" aria-valuemax="150" aria-valuenow="0"><span class="nlc-progress-fill" style="width:0%"></span></div></div>'
   +'<section class="nlc-cart-lines">'+items.map(x=>
    '<div class="nlc-line"><img src="'+html(window.AltaStore.image(window.AltaStore.product(x.id),x.size))+'" alt="">'
    +'<div class="nlc-name"><div class="nlc-product-title"><strong>'+html(x.name)+'</strong><span class="nlc-size">– '+html(x.size)+'</span></div>'
    +'<div class="nlc-product-actions"><div class="nlc-quantity-row"><div class="ap-quantity"><button type="button" data-action="cart-quantity" data-key="'+html(x.key)+'" data-step="-1" aria-label="Decrease '+html(x.name)+' quantity">−</button>'
    +'<input value="'+x.qty+'" readonly aria-label="Quantity"><button type="button" data-action="cart-quantity" data-key="'+html(x.key)+'" data-step="1" aria-label="Increase '+html(x.name)+' quantity">+</button></div></div>'
    +'</div></div><div class="nlc-price"><strong>'+money(Math.round(x.price*100)*x.qty)+'</strong><button type="button" data-action="cart-remove" data-key="'+html(x.key)+'" aria-label="Remove item">×</button></div></div>'
   ).join('')+'</section>'
   +(picks.length?'<div class="nlc-recs"><h3>RECOMMENDED ADD-ONS</h3><div class="nlc-rec-track">'+picks.map(p=>{
    const v=p.variants[0];
    return '<div class="nlc-rec"><img src="'+html(window.AltaStore.image(p,v.size))+'" alt=""><div><strong>'+html(p.name)+'</strong><div class="nlc-rec-prices"><b>'+money(Math.round(v.price*100))+'</b></div><button data-action="add" data-id="'+html(p.id)+'" data-size="'+html(v.size)+'" type="button" aria-label="Add '+html(p.name)+' '+html(v.size)+' to cart">ADD MORE</button></div></div>';
   }).join('')+'</div></div>':'')
   +'</div><div class="nlc-cart-checkout cart__checkout" data-testid="cart-fixed-footer"><details class="nlc-coupon"'+(appliedCoupon?' open':'')+'><summary>Coupon code</summary><p>Use <strong>BLACKFRIDAY15</strong> for 15% off merchandise.</p><div><input type="text" name="nlc_coupon" aria-label="Coupon code" placeholder="BLACKFRIDAY15" maxlength="40" value="'+html(appliedCoupon)+'"><button type="button" data-nlc-apply>APPLY</button><button type="button" data-nlc-remove-coupon hidden>REMOVE</button></div><p data-nlc-coupon-status role="status" aria-live="polite"></p></details>'
   +'<p class="nlc-delivery-est"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 6h11v11H3zM14 10h4l3 4v3h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/></svg> <strong>Estimated delivery:</strong> <span data-nlc-estimate></span></p>'
   +'<div class="nlc-cart-totals" data-nlc-cart-totals><p role="status">Calculating your order total…</p></div>'
   +'<a class="nlc-proceed" href="/checkout">Proceed to Checkout</a>'
   +'<div class="nlc-wallet-area"><div class="nlc-pay-divider"><span>OR PAY WITH</span> <strong data-nlc-instant-amount></strong></div><div class="nlc-wallet-row" data-nlc-wallets>'
   +'<a class="nlc-wallet-link" data-nlc-wallet="apple" role="link" aria-disabled="true" aria-label="Continue with Apple Pay"><span class="nlc-wallet-lockup"><img class="nlc-wallet-logo nlc-apple-mark" src="/assets/payment-brands/apple-mark-clean.svg" width="18" height="23" alt="" aria-hidden="true"><span class="nlc-apple-pay-word">Pay</span></span></a><span class="nlc-wallet-or">or</span>'
   +'<a class="nlc-wallet-link" data-nlc-wallet="google" role="link" aria-disabled="true" aria-label="Continue with Google Pay"><span class="nlc-wallet-lockup"><img class="nlc-wallet-logo nlc-google-mark" src="/assets/payment-brands/google-g-clean.svg" width="20" height="20" alt="" aria-hidden="true"><span class="nlc-google-pay-word">Pay</span></span></a></div>'
   +'<p data-nlc-wallet-note>Choose Card or Crypto at checkout. Digital wallets are offered in the secure provider checkout when eligible.</p>'
   +'<p>Orders are for customers 21+ and research use only. Review the <a href="/research-use-policy.html">RUO Agreement</a> and <a href="/commercial-terms.html">Terms</a> before checkout.</p></div></div>';
  const track=root.querySelector('[data-nlc-cart-totals]'),input=root.querySelector('[name=nlc_coupon]'),apply=root.querySelector('[data-nlc-apply]'),remove=root.querySelector('[data-nlc-remove-coupon]'),couponStatus=root.querySelector('[data-nlc-coupon-status]');
  const redraw=async(candidate=appliedCoupon,action='refresh')=>{
   const id=++seq;
   apply.disabled=true;remove.disabled=true;
   couponStatus.textContent=action==='remove'?'Removing coupon…':candidate?'Checking coupon…':'';
   root.querySelectorAll('[data-nlc-wallet]').forEach(link=>{link.removeAttribute('href');link.setAttribute('aria-disabled','true');link.tabIndex=-1;});
   try{
    const settings=await methods();
    if(!root.isConnected||id!==seq)return;
    const country=localStorage.getItem('ap-shipping-country')||'US';
    const protection=(settings.delivery_options||[]).find(x=>x.id==='protection'&&x.enabled===true);
    if(protection&&extras(window.AltaStore.cart||items).includes('protection'))selected.add('protection');
    else selected.delete('protection');
    sessionStorage.setItem(cartKey(items),JSON.stringify([...selected]));
    const request=await fetch('/api/customer-config?checkout=cart',{method:'POST',cache:'no-store',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({items:(window.AltaStore.cart||[]).map(({id,size,qty})=>({id,size,qty})),
       method_id:null,coupon:candidate,country,delivery:{shipping:'standard',extras:[...selected].sort()}})});
    const data=await request.json().catch(()=>null);
    if(id!==seq||!root.isConnected)return;
    if(!request.ok||!Number.isSafeInteger(data?.total_cents))throw Error(data?.error||'Could not calculate your order total.');
    appliedCoupon=data.pricing?.coupon_code==='BLACKFRIDAY15'?'BLACKFRIDAY15':'';
    saveCoupon(appliedCoupon);input.value=appliedCoupon;remove.hidden=!appliedCoupon;
    couponStatus.textContent=appliedCoupon?'BLACKFRIDAY15 applied — 15% off merchandise.':action==='remove'?'Coupon removed. Regular prices restored.':'';
    const shipping=data.pricing?.delivery?.shipping_cents||0;
    const features=data.pricing?.delivery?.extras||[];
    const nodes=[['Subtotal',data.subtotal_cents]];
    const discount=appliedCoupon?data.pricing?.coupon_discount_cents||data.discount_cents||0:0;
    if(discount>0)nodes.push(['BLACKFRIDAY15 (15%)',-discount]);
    nodes.push(['Shipping',shipping]);
    for(const feature of features)nodes.push([feature.label,feature.amount_cents]);
    if(data.tax_cents>0)nodes.push(['Tax',data.tax_cents]);
    track.innerHTML=nodes.map(([label,price],index)=>'<div class="'+(index===0?'nlc-first-subtotal':label==='Shipping Protection'?'nlc-protection-static':'')+'"><span>'+html(label)+'</span><strong>'+(price<0?'−'+money(-price):label==='Shipping'&&price===0?'FREE':money(price))+'</strong></div>').join('');
    const threshold=data.free_shipping_threshold_cents||15000;
    const merchandise=Math.max(0,data.subtotal_cents-data.discount_cents);
    const remaining=Number.isSafeInteger(data.free_shipping_remaining_cents)?data.free_shipping_remaining_cents:Math.max(0,threshold-merchandise);
    const unlockText=root.querySelector('[data-nlc-unlock-copy]');
    unlockText.innerHTML=country!=='US'?'Free standard shipping is available for US orders of <strong>'+money(threshold)+'</strong> after discounts.':remaining?'Add <strong>'+money(remaining)+'</strong> more for <strong>free standard US shipping</strong>.':'<strong>Free standard US shipping included.</strong>';
    const progress=root.querySelector('.nlc-progress');progress.hidden=country!=='US';progress.setAttribute('aria-valuemax',String(threshold/100));progress.setAttribute('aria-valuenow',String(Math.min(threshold,merchandise)/100));
    root.querySelector('.nlc-progress-fill').style.width=Math.min(100,merchandise/threshold*100)+'%';
    root.querySelector('.nlc-proceed').textContent='Proceed to Checkout ('+money(data.total_cents)+')';
    root.querySelector('[data-nlc-instant-amount]').textContent=money(data.total_cents);
    const hostedCard=(settings.methods||[]).find(method=>method.native_provider==='rampex'&&method.rampex_provider==='hosted'&&method.active!==false&&method.countries?.includes(country));
    root.querySelector('[data-nlc-wallet-note]').textContent=hostedCard?'Review delivery and your total first. Apple Pay or Google Pay can be selected in the secure provider checkout when eligible.':'Digital wallet payments are unavailable for this destination. Choose an available method at checkout.';
    if(hostedCard)root.querySelectorAll('[data-nlc-wallet]').forEach(link=>{link.href='/checkout?wallet='+link.dataset.nlcWallet;link.setAttribute('aria-disabled','false');link.removeAttribute('tabindex');});
    hasQuote=true;
   }catch(error){
    if(root.isConnected&&id===seq){couponStatus.textContent=error?.message||'Could not check this coupon.';if(!hasQuote)track.textContent='Your total could not be calculated. Please try again.';}
   }finally{if(root.isConnected&&id===seq){apply.disabled=false;remove.disabled=false;}}
  };
  const dateLabel=offset=>{const date=new Date();date.setDate(date.getDate()+offset);return new Intl.DateTimeFormat('en-US',{weekday:'short',month:'short',day:'numeric'}).format(date);};
  root.querySelector('[data-nlc-estimate]').textContent=dateLabel(7)+' – '+dateLabel(13);
  apply.addEventListener('click',()=>redraw(input.value.trim().toUpperCase(),'apply'));
  input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();apply.click();}});
  remove.addEventListener('click',()=>redraw('','remove'));
  await redraw();
 }
 window.AltaCartNmi=Object.assign(window.AltaCartNmi||{},{offer});
})();
