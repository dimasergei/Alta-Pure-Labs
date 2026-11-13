(()=>{
 'use strict';
 const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format((Number(n)||0)/100);
 const html=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let seq=0,config=null;
 const methods=async()=>{
  if(config)return config;
  const r=await fetch('/api/customer-config?checkout=public',{cache:'no-store'});
  if(!r.ok)throw Error('Checkout details are not available.');
  return config=await r.json();
 };
 // One cart's elective services cannot silently be copied into an unrelated order.
 const cartKey=items=>'ap-v2-cart-extras:'+JSON.stringify(items.map(({id,size,qty})=>({id,size,qty})));
 function extras(items){const home=localStorage.getItem('ap-shipping-country')||'US';try{const v=JSON.parse(sessionStorage.getItem(cartKey(items))||'null');return Array.isArray(v)?v:home==='US'?['protection']:[];}catch{return home==='US'?['protection']:[];}}

 const before=window.AltaCartNmi?.offer;
 async function offer(root){
  if(!root?.isConnected)return;
  const items=window.AltaStore?.cart||[];
  if(!items.length)return;
  const selected=new Set(extras(items)),catalog=window.AltaStore?.catalog||[];
  const picks=catalog.filter(p=>!items.some(x=>x.id===p.id)).slice(0,5);
  let subtotal=items.reduce((n,x)=>n+Math.round(x.price*100)*x.qty,0);
  const unlock=target=>money(Math.max(0,target-subtotal));
  root.innerHTML='<div class="nlc-scrollable-items cart__body" data-testid="cart-product-scroll">'
   +'<div class="nlc-unlock"><p data-nlc-unlock-copy>Add <strong>'+unlock(25000)+'</strong> more to unlock <strong>Free Priority Shipping</strong></p><div class="nlc-progress" role="progressbar" aria-label="Shipping rewards progress" aria-valuemin="0" aria-valuemax="299" aria-valuenow="'+Math.min(299,Math.floor(subtotal/100))+'"><span class="nlc-progress-fill" style="width:'+Math.min(100,subtotal/29900*100)+'%"></span><span class="nlc-gift nlc-gift-one" tabindex="0" aria-label="Free Priority Shipping at $250">♔<span class="nlc-gift-tip">Free Priority Shipping — $250.00</span></span><span class="nlc-gift nlc-gift-two" tabindex="0" aria-label="Free BAC Water and Free Shipping at $299">♔<span class="nlc-gift-tip">Free BAC Water + Free Shipping — $299.00</span></span></div></div>'
   +'<section class="nlc-cart-lines">'+items.map(x=>
    '<div class="nlc-line"><img src="'+html(window.AltaStore.image(window.AltaStore.product(x.id),x.size))+'" alt="">'
    +'<div class="nlc-name"><strong>'+html(x.name)+'</strong><small>'+html(x.size)+'</small>'
    +'<span hidden data-testid="cart-bogo-free" data-nlc-bogo-line></span><div class="nlc-quantity-row"><div class="ap-quantity"><button type="button" data-action="cart-quantity" data-key="'+html(x.key)+'" data-step="-1" aria-label="Decrease '+html(x.name)+' quantity">−</button>'
    +'<input value="'+x.qty+'" readonly aria-label="Quantity"><button type="button" data-action="cart-quantity" data-key="'+html(x.key)+'" data-step="1" aria-label="Increase '+html(x.name)+' quantity">+</button></div></div>'
    +'</div><div class="nlc-price"><strong>'+money(Math.round(x.price*100)*x.qty)+'</strong><button type="button" data-action="cart-remove" data-key="'+html(x.key)+'" aria-label="Remove item">×</button></div></div>'
   ).join('')+'</section>'
   +(picks.length?'<div class="nlc-recs"><h3>RECOMMENDED ADD-ONS</h3><div class="nlc-rec-track">'+picks.map(p=>{
    const v=p.variants[0];
    return '<div class="nlc-rec"><img src="'+html(window.AltaStore.image(p,v.size))+'" alt=""><div><strong>'+html(p.name)+'</strong><div class="nlc-rec-prices"><s>'+money(Math.round(v.price*100))+'</s> <b>'+money(Math.round(v.price*100)-Math.floor(v.price*10))+'</b></div><small>Save 10% · code BOGO</small><button data-action="add" data-id="'+html(p.id)+'" type="button">ADD MORE</button></div></div>';
   }).join('')+'</div></div>':'')
   +'</div><div class="nlc-cart-checkout cart__checkout" data-testid="cart-fixed-footer"><details class="nlc-coupon"><summary>Coupon code</summary><div><input type="text" name="nlc_coupon" placeholder="Coupon code" maxlength="40" value="'+html(localStorage.getItem('ap-checkout-coupon')||'')+'"><button type="button" data-nlc-apply>APPLY</button></div></details>'
   +'<p class="nlc-delivery-est"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 6h11v11H3zM14 10h4l3 4v3h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/></svg> <strong>Estimated delivery:</strong> <span data-nlc-estimate></span></p>'
   +'<div class="nlc-cart-totals" data-nlc-cart-totals><p role="status">Calculating your order total…</p></div>'
   +'<a class="nlc-proceed" href="/checkout">Proceed to Checkout</a>'
   +'<div class="nlc-wallet-area"><div class="nlc-pay-divider"><span>OR PAY INSTANTLY</span> <strong data-nlc-instant-amount></strong></div><div class="nlc-wallet-row" data-nlc-wallets>'
   +'<button type="button" disabled aria-label="Apple Pay pending activation"><span class="nlc-apple-mark" aria-hidden="true"></span><span>Pay</span></button>'
   +'<span class="nlc-wallet-or">or</span><button type="button" disabled aria-label="Google Pay pending activation"><svg class="nlc-google-mark" viewBox="0 0 48 48" width="23" height="23" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6C44.4 38.03 46.98 31.89 46.98 24.55z"/><path fill="#FBBC05" d="M10.53 28.59A14.4 14.4 0 0 1 9.75 24c0-1.59.27-3.13.76-4.59l-7.98-6.19A23.88 23.88 0 0 0 0 24c0 3.87.93 7.51 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.91-5.8l-7.73-6c-2.15 1.45-4.92 2.3-8.18 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.97 6.19C6.51 42.62 14.62 48 24 48z"/></svg><span>Pay</span></button></div>'
   +'<p>By paying, you confirm you are 21+, buying for research use only, and accept the <a href="/research-use-policy.html">RUO Agreement</a> and <a href="/commercial-terms.html">Terms</a>.</p></div></div>';
  const track=root.querySelector('[data-nlc-cart-totals]');
  const redraw=async()=>{
   const id=++seq;
   try{
    const settings=await methods();
    if(!root.isConnected||id!==seq)return;
    const method=settings.methods?.find(m=>m.kind!=='bank_transfer')||settings.methods?.[0];
    const wallet=settings.nmi?.ready===true&&settings.methods?.some(m=>m.id===settings.nmi.method_id&&m.native_provider==='nmi')?settings.nmi:null;
    if(wallet){
     root.querySelectorAll('[data-nlc-wallets] button').forEach((b,i)=>{
      const authorized=i===0?wallet.wallets?.apple===true:wallet.wallets?.google===true;
      b.disabled=!authorized;if(authorized)b.onclick=()=>window.AltaCartNmi?.open?.();
     });
    }
    const country=localStorage.getItem('ap-shipping-country')||'US';
    const protection=(settings.delivery_options||[]).find(x=>x.id==='protection'&&x.enabled===true);
    if(protection&&country==='US')selected.add('protection');else selected.delete('protection');
    sessionStorage.setItem(cartKey(items),JSON.stringify([...selected]));
    const request=await fetch('/api/customer-config?checkout=cart',{method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({items:(window.AltaStore.cart||[]).map(({id,size,qty})=>({id,size,qty})),
       method_id:method?.id||null,coupon:localStorage.getItem('ap-checkout-coupon')||'',
       country,delivery:{shipping:'standard',extras:[...selected].sort()}})});
    const data=await request.json();
    if(!request.ok||id!==seq||!root.isConnected)return;
    // An explicit server line entitlement is required before showing a BOGO badge.
    const quotedLines=Array.isArray(data.pricing?.lines)?data.pricing.lines:[];
    root.querySelectorAll('[data-nlc-bogo-line]').forEach((node,index)=>{
     const item=items[index],confirmed=quotedLines.find(line=>line.id===item.id&&line.size===item.size&&line.qty===item.qty);
     const n=confirmed?.bogo_free_units;
     const free=Number.isSafeInteger(n)&&n>0&&n<=item.qty&&['bogo','bogo+coupon_bogo'].includes(confirmed?.discount_reason)?n:0;
     node.hidden=!free;node.textContent=free?'+'+free+' FREE':'';
    });
    const shipping=data.pricing?.delivery?.shipping_cents||0;
    const features=data.pricing?.delivery?.extras||[];
    const nodes=[['Subtotal',data.subtotal_cents]];
    if(data.discount_cents)nodes.push(['Discounts',-data.discount_cents]);
    nodes.push(['Shipping',shipping]);
    for(const f of features.filter(x=>x.id!=='protection'))nodes.push([f.label,f.amount_cents]);
    const includedProtection=features.find(x=>x.id==='protection');
    const bankSavings=Math.floor(Math.max(0,data.subtotal_cents-data.discount_cents)*0.05);
    track.innerHTML=nodes.map(([label,price],i)=>'<div class="'+(i===0?'nlc-first-subtotal':'')+'"><span>'+html(label)+'</span><strong>'+(i===0?money(price):price<0?'−'+money(-price):'+'+money(price))+'</strong></div>').join('')
     +(includedProtection?'<div class="nlc-protection-static"><span>Shipping Protection</span><strong>+'+money(includedProtection.amount_cents)+'</strong></div>':'')
     +'<div class="nlc-bank-discount"><span>Same-Day Bank Payment discount (5%)</span><strong>−'+money(bankSavings)+'</strong></div>';
    const unlockText=root.querySelector('[data-nlc-unlock-copy]');
    if(unlockText){const remaining=Math.max(0,25000-(data.subtotal_cents-data.discount_cents));unlockText.innerHTML=remaining?'Add <strong>'+money(remaining)+'</strong> more to unlock <strong>Free Priority Shipping</strong>':'<strong>Free Priority Shipping unlocked!</strong>';}
    const bar=root.querySelector('.nlc-progress-fill');if(bar)bar.style.width=Math.min(100,100*(data.subtotal_cents-data.discount_cents)/29900)+'%';
    const proceed=root.querySelector('.nlc-proceed');if(proceed)proceed.textContent='Proceed to Checkout ('+money(data.total_cents)+')';
    const instant=root.querySelector('[data-nlc-instant-amount]');if(instant)instant.textContent=money(data.total_cents);
   }catch(error){if(root.isConnected&&id===seq)track.textContent='Final prices will be shown at checkout. '+(error?.message||'');}
  };

  const dateLabel=offset=>{const date=new Date();date.setDate(date.getDate()+offset);return new Intl.DateTimeFormat('en-US',{weekday:'short',month:'short',day:'numeric'}).format(date);};
  const estimate=root.querySelector('[data-nlc-estimate]');
  if(estimate)estimate.textContent=dateLabel(7)+' – '+dateLabel(13);
  root.querySelector('[data-nlc-apply]').addEventListener('click',()=>{
   localStorage.setItem('ap-checkout-coupon',root.querySelector('[name=nlc_coupon]').value.trim().toUpperCase());redraw();
  });
  await redraw();
 }
 window.AltaCartNmi=Object.assign(window.AltaCartNmi||{},{offer});
})();
