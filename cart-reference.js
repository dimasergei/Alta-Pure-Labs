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
 function extras(){const home=localStorage.getItem('ap-shipping-country')||'US';try{const v=JSON.parse(localStorage.getItem('ap-shipping-extras')||'null');return Array.isArray(v)?v:home==='US'?['protection']:[];}catch{return home==='US'?['protection']:[];}}
 function saveExtras(selected){localStorage.setItem('ap-shipping-extras',JSON.stringify([...selected]));}
 const before=window.AltaCartNmi?.offer;
 async function offer(root){
  if(!root?.isConnected)return;
  const items=window.AltaStore?.cart||[];
  if(!items.length)return;
  const selected=new Set(extras()),catalog=window.AltaStore?.catalog||[];
  const picks=catalog.filter(p=>!items.some(x=>x.id===p.id)).slice(0,5);
  let subtotal=items.reduce((n,x)=>n+Math.round(x.price*100)*x.qty,0);
  root.innerHTML='<section class="nlc-cart-lines">'+items.map(x=>
    '<div class="nlc-line"><img src="'+html(window.AltaStore.image(window.AltaStore.product(x.id),x.size))+'" alt="">'
    +'<div class="nlc-name"><strong>'+html(x.name)+'</strong><small>'+html(x.size)+'</small>'
    +'<div class="ap-quantity"><button type="button" data-action="cart-quantity" data-key="'+html(x.key)+'" data-step="-1" aria-label="Decrease '+html(x.name)+' quantity">−</button>'
    +'<input value="'+x.qty+'" readonly aria-label="Quantity"><button type="button" data-action="cart-quantity" data-key="'+html(x.key)+'" data-step="1" aria-label="Increase '+html(x.name)+' quantity">+</button></div>'
    +'</div><div class="nlc-price"><strong>'+money(Math.round(x.price*100)*x.qty)+'</strong><button type="button" data-action="cart-remove" data-key="'+html(x.key)+'" aria-label="Remove item">×</button></div></div>'
   ).join('')+'</section>'
   +(picks.length?'<div class="nlc-recs"><h3>RECOMMENDED ADD-ONS</h3><div class="nlc-rec-track">'+picks.map(p=>{
    const v=p.variants[0];
    return '<div class="nlc-rec"><img src="'+html(window.AltaStore.image(p,v.size))+'" alt=""><div><strong>'+html(p.name)+'</strong><span>'+money(Math.round(v.price*100))+'</span><button data-action="add" data-id="'+html(p.id)+'" type="button">ADD MORE</button></div></div>';
   }).join('')+'</div></div>':'')
   +'<div class="nlc-cart-checkout"><details class="nlc-coupon"><summary>Coupon code</summary><div><input type="text" name="nlc_coupon" placeholder="Coupon code" maxlength="40" value="'+html(localStorage.getItem('ap-checkout-coupon')||'')+'"><button type="button" data-nlc-apply>APPLY</button></div></details>'
   +'<p class="nlc-delivery-est">◇ Estimated delivery and final costs are calculated at checkout.</p>'
   +'<div class="nlc-cart-totals" data-nlc-cart-totals><div><span>Subtotal</span><strong>'+money(subtotal)+'</strong></div><div><span>Shipping estimate</span><strong>'+money(1495)+'</strong></div>'
   +'<label><input type="checkbox" name="nlc_protection" '+(selected.has('protection')?'checked':'')+'> Shipping Protection <strong>'+money(500)+'</strong></label>'
   +'<div class="nlc-subtotal"><span>Estimated total</span><strong>'+money(subtotal+1495+(selected.has('protection')?500:0))+'</strong></div></div>'
   +'<a class="nlc-proceed" href="/checkout">Proceed to Checkout</a>'
   +'<div class="nlc-wallet-area"><small>OR PAY INSTANTLY</small><div class="nlc-wallet-row" data-nlc-wallets>'
   +'<button type="button" disabled aria-label="Apple Pay awaiting merchant activation"> Pay</button>'
   +'<span>or</span><button type="button" disabled aria-label="Google Pay awaiting merchant activation"><b class="nlc-g">G</b> Pay</button></div>'
   +'<p>Wallet payments become available when the authorized processor is connected. <a href="/research-use-policy.html">Research-use terms</a> apply.</p></div></div>';
  const track=root.querySelector('[data-nlc-cart-totals]');
  const redraw=async()=>{
   const id=++seq;
   try{
    const settings=await methods();
    if(!root.isConnected||id!==seq)return;
    const method=settings.methods?.find(m=>m.kind!=='bank_transfer')||settings.methods?.[0];
    const wallet=settings.nmi?.ready===true?settings.nmi:null;
    if(wallet){
     root.querySelectorAll('[data-nlc-wallets] button').forEach(b=>{b.disabled=false;b.onclick=()=>window.AltaCartNmi?.open?.();});
    }
    const country=localStorage.getItem('ap-shipping-country')||'US';
    const request=await fetch('/api/customer-config?checkout=cart',{method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({items:(window.AltaStore.cart||[]).map(({id,size,qty})=>({id,size,qty})),
       method_id:method?.id||null,coupon:localStorage.getItem('ap-checkout-coupon')||'',
       country,delivery:{shipping:'standard',extras:[...selected].sort()}})});
    const data=await request.json();
    if(!request.ok||id!==seq||!root.isConnected)return;
    const shipping=data.pricing?.delivery?.shipping_cents||0;
    const features=data.pricing?.delivery?.extras||[];
    const nodes=[['Subtotal',data.subtotal_cents]];
    if(data.discount_cents)nodes.push(['Discounts',-data.discount_cents]);
    nodes.push(['Shipping',shipping]);
    for(const f of features)nodes.push([f.label,f.amount_cents]);
    nodes.push(['Estimated total',data.total_cents]);
    track.innerHTML=nodes.map(([label,price],n)=>'<div class="'+(n===nodes.length-1?'nlc-subtotal':'')+'"><span>'+html(label)+'</span><strong>'+money(price)+'</strong></div>').join('')
     +'<label><input type="checkbox" name="nlc_protection" '+(selected.has('protection')?'checked':'')+'> Shipping Protection · '+money(500)+'</label>';
    const check=track.querySelector('[name=nlc_protection]');
    if(check)check.onchange=()=>{check.checked?selected.add('protection'):selected.delete('protection');saveExtras(selected);redraw();};
    const proceed=root.querySelector('.nlc-proceed');if(proceed)proceed.textContent='Proceed to Checkout ('+money(data.total_cents)+')';
   }catch{}
  };
  const check=track.querySelector('[name=nlc_protection]');if(check)check.addEventListener('change',()=>{check.checked?selected.add('protection'):selected.delete('protection');saveExtras(selected);redraw();});
  root.querySelector('[data-nlc-apply]').addEventListener('click',()=>{
   localStorage.setItem('ap-checkout-coupon',root.querySelector('[name=nlc_coupon]').value.trim().toUpperCase());redraw();
  });
  await redraw();
 }
 window.AltaCartNmi=Object.assign(window.AltaCartNmi||{},{offer});
})();
