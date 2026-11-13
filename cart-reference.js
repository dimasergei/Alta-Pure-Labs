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
 function saveExtras(selected,items){sessionStorage.setItem(cartKey(items),JSON.stringify([...selected]));}
 const before=window.AltaCartNmi?.offer;
 async function offer(root){
  if(!root?.isConnected)return;
  const items=window.AltaStore?.cart||[];
  if(!items.length)return;
  const selected=new Set(extras(items)),catalog=window.AltaStore?.catalog||[];
  const picks=catalog.filter(p=>!items.some(x=>x.id===p.id)).slice(0,5);
  let subtotal=items.reduce((n,x)=>n+Math.round(x.price*100)*x.qty,0);
  root.innerHTML='<div class="nlc-scrollable-items cart__body" data-testid="cart-product-scroll"><section class="nlc-cart-lines">'+items.map(x=>
    '<div class="nlc-line"><img src="'+html(window.AltaStore.image(window.AltaStore.product(x.id),x.size))+'" alt="">'
    +'<div class="nlc-name"><strong>'+html(x.name)+'</strong><small>'+html(x.size)+'</small>'
    +'<span hidden data-testid="cart-bogo-free" data-nlc-bogo-line></span><div class="ap-quantity"><button type="button" data-action="cart-quantity" data-key="'+html(x.key)+'" data-step="-1" aria-label="Decrease '+html(x.name)+' quantity">−</button>'
    +'<input value="'+x.qty+'" readonly aria-label="Quantity"><button type="button" data-action="cart-quantity" data-key="'+html(x.key)+'" data-step="1" aria-label="Increase '+html(x.name)+' quantity">+</button></div>'
    +'</div><div class="nlc-price"><strong>'+money(Math.round(x.price*100)*x.qty)+'</strong><button type="button" data-action="cart-remove" data-key="'+html(x.key)+'" aria-label="Remove item">×</button></div></div>'
   ).join('')+'</section>'
   +(picks.length?'<div class="nlc-recs"><h3>RECOMMENDED ADD-ONS</h3><div class="nlc-rec-track">'+picks.map(p=>{
    const v=p.variants[0];
    return '<div class="nlc-rec"><img src="'+html(window.AltaStore.image(p,v.size))+'" alt=""><div><strong>'+html(p.name)+'</strong><span>'+money(Math.round(v.price*100))+'</span><button data-action="add" data-id="'+html(p.id)+'" type="button">ADD MORE</button></div></div>';
   }).join('')+'</div></div>':'')
   +'</div><div class="nlc-cart-checkout cart__checkout" data-testid="cart-fixed-footer"><details class="nlc-coupon"><summary>Coupon code</summary><div><input type="text" name="nlc_coupon" placeholder="Coupon code" maxlength="40" value="'+html(localStorage.getItem('ap-checkout-coupon')||'')+'"><button type="button" data-nlc-apply>APPLY</button></div></details>'
   +'<p class="nlc-delivery-est">Shipping and optional services are priced in your verified checkout quote.</p>'
   +'<div class="nlc-cart-totals" data-nlc-cart-totals><p role="status">Calculating your order total…</p></div>'
   +'<a class="nlc-proceed" href="/checkout">Proceed to Checkout</a>'
   +'<div class="nlc-wallet-area"><small>OR PAY INSTANTLY</small><div class="nlc-wallet-row" data-nlc-wallets>'
   +'<button type="button" disabled aria-label="Apple Pay pending activation">Apple Pay</button>'
   +'<span>or</span><button type="button" disabled aria-label="Google Pay pending activation">Google Pay</button></div>'
   +'<p>Wallet payments become available when the authorized processor is connected. <a href="/research-use-policy.html">Research-use terms</a> apply.</p></div></div>';
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
    if(!protection||country!=='US')selected.delete('protection');
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
     node.hidden=!free;node.textContent=free?'+'+free+' FREE · BOGO':'';
    });
    const shipping=data.pricing?.delivery?.shipping_cents||0;
    const features=data.pricing?.delivery?.extras||[];
    const nodes=[['Subtotal',data.subtotal_cents]];
    if(data.discount_cents)nodes.push(['Discounts',-data.discount_cents]);
    nodes.push(['Shipping',shipping]);
    for(const f of features.filter(x=>x.id!=='protection'))nodes.push([f.label,f.amount_cents]);
    track.innerHTML=nodes.map(([label,price])=>'<div><span>'+html(label)+'</span><strong>'+money(price)+'</strong></div>').join('')
     +(protection?'<label><input type="checkbox" name="nlc_protection" '+(selected.has('protection')?'checked':'')+'> Shipping Protection <strong>'+money(protection.price_cents)+'</strong></label>':'')
     +'<div class="nlc-subtotal"><span>Estimated total</span><strong>'+money(data.total_cents)+'</strong></div>';
    const check=track.querySelector('[name=nlc_protection]');
    if(check)check.onchange=()=>{check.checked?selected.add('protection'):selected.delete('protection');saveExtras(selected,items);redraw();};
    const proceed=root.querySelector('.nlc-proceed');if(proceed)proceed.textContent='Proceed to Checkout ('+money(data.total_cents)+')';
   }catch(error){if(root.isConnected&&id===seq)track.textContent='Final prices will be shown at checkout. '+(error?.message||'');}
  };

  root.querySelector('[data-nlc-apply]').addEventListener('click',()=>{
   localStorage.setItem('ap-checkout-coupon',root.querySelector('[name=nlc_coupon]').value.trim().toUpperCase());redraw();
  });
  await redraw();
 }
 window.AltaCartNmi=Object.assign(window.AltaCartNmi||{},{offer});
})();
