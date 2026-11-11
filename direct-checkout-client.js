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
 function link(label,url){const a=node('a',label);a.href=url;a.className='ap-button ap-button-secondary';return a;}
 function summary(q){const box=node('section');box.className='ap-panel';box.append(node('h2','Order summary'));
  for(const x of q.pricing.lines)box.append(node('p',x.name+' · '+x.size+' × '+x.qty+' — '+money(x.line_total_cents)));
  for(const [label,value] of [['Subtotal',q.subtotal_cents],['Discounts',-q.discount_cents],['Delivery',q.shipping_cents],['Tax',q.tax_cents],['Points redeemed',-q.points_redeemed],['Store credit',-q.credit_redeemed_cents]])box.append(node('p',label+': '+money(value)));
  box.append(node('h3','Due now: '+money(q.total_cents)),node('p','Earn '+q.earned_points+' points when payment is confirmed.'));
  if(q.pricing.shipping_note)box.append(node('p',q.pricing.shipping_note));return box;
 }
 async function checkout(root,auth,user){
  try{
   const data=await api(auth),plan=new URLSearchParams(location.search).get('plan'),goods=!['vip','elite'].includes(plan),cart=window.AltaStore?.cart||[];
   root.replaceChildren(node('h1','Checkout'));
   if(goods&&!cart.length){root.append(node('p','Your cart is empty.'),link('Shop products','/shop'));return;}
   if(!goods&&data.membership){root.append(node('p','You already have an active '+data.membership.plan.toUpperCase()+' pass.'),link('View membership','/account/membership'));return;}
   const methods=data.methods.filter(m=>m.sale_scope==='both'||m.sale_scope===(goods?'goods':'membership'));
   if(!methods.length){root.append(node('p','No payment method is currently available for this purchase. Please contact the team.'),link('Contact','/contact'));return;}
   if(!goods)root.append(node('h2',data.terms.memberships[plan].name+' · '+money(data.terms.memberships[plan].price_cents)+' for 365 days'),node('p',data.terms.memberships[plan].discount_bps/100+'% merchandise savings. Starts after confirmed payment; no automatic renewal.'));
   const form=node('form');form.className='ap-form';
   form.innerHTML=`<label>Name<input name="name" autocomplete="name" maxlength="120" required value="${esc(user.user_metadata?.full_name||'')}"></label><label>Laboratory / organization<input name="organization" maxlength="180"></label>${goods?'<label>Street address<input name="line1" autocomplete="shipping address-line1" required minlength="3" maxlength="180"></label><label>Address line 2<input name="line2" autocomplete="shipping address-line2" maxlength="180"></label><div class="ap-form-row"><label>City<input name="city" required minlength="2" maxlength="80" autocomplete="shipping address-level2"></label><label>State<input name="region" required maxlength="80" autocomplete="shipping address-level1"></label></div><label>ZIP code<input name="postal_code" required minlength="2" maxlength="20" autocomplete="shipping postal-code"></label><p>Delivery: United States · US$25 standard delivery. <a href="/shipping-policy.html">Delivery details</a></p><label class="ap-checkbox-label"><input name="research_use" type="checkbox" required> I am 21 or older. Products are for controlled laboratory research only, not human or animal use.</label>':''}<label>Payment method<select name="method_id">${methods.map(m=>'<option value="'+esc(m.id)+'">'+esc(m.label)+(m.kind==='bank_transfer'&&goods?' · 5% merchandise savings':'')+'</option>').join('')}</select></label>${goods?'<div class="ap-panel"><p>Available: '+Math.max(0,data.balances.points)+' points · '+money(data.balances.credit_cents)+' store credit.</p><label>Points to use (100 minimum)<input name="points" type="number" min="0" step="1" max="'+Math.max(0,data.balances.points)+'" value="0"></label><label>Store credit to use (US$)<input name="credit" type="number" min="0" step="0.01" max="'+(data.balances.credit_cents/100).toFixed(2)+'" value="0"></label><p>100 points = US$1. Points apply to merchandise; credit can also cover delivery. <a href="/rewards">Rewards details</a></p></div>':''}<label>Order note<textarea name="note" rows="3" maxlength="1000"></textarea></label><label class="ap-checkbox-label"><input name="consent" type="checkbox" required> I accept the <a href="/commercial-terms.html" target="_blank" rel="noopener">checkout terms</a>, <a href="/shipping-policy.html" target="_blank" rel="noopener">shipping policy</a> and <a href="/refund-policy.html" target="_blank" rel="noopener">refund policy</a>.</label><button type="submit" class="ap-button">Review order total</button>`;
   const preferred=new URLSearchParams(location.search).get('method');if(methods.some(m=>m.id===preferred))form.elements.method_id.value=preferred;
   const review=node('div'),status=node('p');status.setAttribute('role','status');root.append(form,review,status);
   let busy=false,body,lastFingerprint=sessionStorage.getItem('ap-checkout-fingerprint')||'',requestId=sessionStorage.getItem('ap-checkout-id')||crypto.randomUUID();sessionStorage.setItem('ap-checkout-id',requestId);
   form.addEventListener('input',()=>{if(!busy)review.replaceChildren();});
   form.onsubmit=async e=>{e.preventDefault();if(busy)return;busy=true;const button=form.querySelector('button');button.disabled=true;status.textContent='Calculating your total…';
    try{
     const d=Object.fromEntries(new FormData(form));const request={kind:goods?'goods':'membership',...(goods?{items:cart.map(({id,size,qty})=>({id,size,qty})),address:{line1:d.line1,line2:d.line2,city:d.city,region:d.region,postal_code:d.postal_code,country:'US'},research_use:d.research_use==='on'}:{plan}),name:d.name,organization:d.organization,note:d.note,consent:d.consent==='on',method_id:d.method_id,points:Number(d.points||0),credit_cents:Math.round(Number(d.credit||0)*100),checkout_version:data.config.version};
     const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(request))))).map(x=>x.toString(16).padStart(2,'0')).join('');if(lastFingerprint&&lastFingerprint!==fingerprint){requestId=crypto.randomUUID();sessionStorage.setItem('ap-checkout-id',requestId);}lastFingerprint=fingerprint;sessionStorage.setItem('ap-checkout-fingerprint',fingerprint);
     body={...request,id:requestId,action:'quote'};const q=await api(auth,body);review.replaceChildren(summary(q));status.textContent='Review the final total, then place your order.';
     const place=node('button',q.total_cents===0?'Place order using account balance':'Place order and continue to payment');place.type='button';place.className='ap-button';review.append(place);
     place.onclick=async()=>{if(busy)return;busy=true;place.disabled=true;button.disabled=true;for(const x of form.elements)x.disabled=true;status.textContent='Saving your order. Please wait…';
      try{const result=await api(auth,{...body,action:'place',quote:q.quote});sessionStorage.removeItem('ap-checkout-id');sessionStorage.removeItem('ap-checkout-fingerprint');if(goods){const current=window.AltaStore?.cart||[];if(JSON.stringify(current.map(({id,size,qty})=>({id,size,qty})))===JSON.stringify(body.items))localStorage.removeItem('pp-cart');}location.assign('/account/purchases?id='+encodeURIComponent(result.id));}
      catch(err){status.textContent=err.message+' Your checkout reference is '+requestId+'.';busy=false;place.disabled=false;button.disabled=false;for(const x of form.elements)x.disabled=false;}
     };
    }catch(err){status.textContent=err.message;}finally{busy=false;button.disabled=false;}
   };
  }catch(e){root.replaceChildren(node('p',e.message));}
 }
 async function orders(root,auth,user){
  root.replaceChildren(node('p','Loading orders…'));
  try{const data=await api(auth,null,'orders',new URLSearchParams(location.search).get('id'));root.replaceChildren(link('Continue shopping','/shop'),link('Historical orders','/account/orders'));
   if(!data.invoices.length)root.append(node('p','No checkout orders yet.'));
   for(const r of data.invoices){const card=node('article');card.className='ap-panel';card.style.marginTop='20px';const ref=(r.checkout_version?'ORD-':'INV-')+r.id.toUpperCase();
    card.append(node('h2',ref),node('p','Status: '+(r.status==='accepted'?'Awaiting payment':r.status)),node('small',new Date(r.created_at).toLocaleString()));
    for(const x of r.pricing?.lines||r.request_data.items||[])card.append(node('p',x.name+' · '+x.size+' × '+x.qty));
    if(r.total_cents!==null){card.append(node('p','Subtotal '+money(r.subtotal_cents,r.currency)+' · Discounts −'+money(r.discount_cents,r.currency)+' · Delivery '+money(r.shipping_cents,r.currency)+' · Tax '+money(r.tax_cents,r.currency)));
     if(r.points_redeemed||r.credit_redeemed_cents)card.append(node('p','Redeemed: '+r.points_redeemed+' points and '+money(r.credit_redeemed_cents,r.currency)+' store credit.'));
     card.append(node('h3',(r.status==='accepted'?'Amount due: ':'Payment amount: ')+money(r.total_cents,r.currency)));}
    if(r.status==='accepted'&&r.payable&&r.payment_snapshot){const m=r.payment_snapshot;if(m.payment_url)card.append(link('Pay securely',m.payment_url));else{card.append(node('h3',m.label),node('p','Beneficiary: '+m.payee));const instructions=node('pre',m.instructions);instructions.style.whiteSpace='pre-wrap';card.append(instructions,node('p','Payment reference: '+ref),node('p','Send the exact amount above. We confirm receipt before fulfillment. Placing an order does not mark it paid.'));}}
    else if(['accepted','issued'].includes(r.status)&&!r.payable)card.append(node('p','The payment window expired or the method is unavailable. Contact us if you already sent payment; otherwise cancel and check out again.'));
    else if(r.status==='requested'||r.status==='issued')card.append(node('p','This earlier order needs support review. Contact altapurelabs@protonmail.com with the reference above.'));
    if(r.checkout_version&&r.status==='accepted'){const label=node('label'),c=node('input');c.type='checkbox';label.append(c,document.createTextNode(' I have not sent payment and want to cancel this unpaid order.'));const cancel=node('button','Cancel unpaid order'),out=node('p');cancel.type='button';cancel.className='ap-button ap-button-secondary';out.setAttribute('role','status');cancel.onclick=async()=>{if(!c.checked){out.textContent='Confirm no payment has been sent first.';return;}cancel.disabled=true;try{await api(auth,{action:'cancel',id:r.id,no_payment_sent:true});await orders(root,auth,user);}catch(e){out.textContent=e.message;cancel.disabled=false;}};card.append(label,cancel,out);}
    if(r.tracking_number)card.append(node('p','Tracking: '+r.tracking_carrier+' · '+r.tracking_number));root.append(card);
   }
  }catch(e){root.replaceChildren(node('p',e.message));}
 }
 async function balance(root,auth,path){
  try{const d=await api(auth),points=path.endsWith('points');root.replaceChildren(node('h2',points?d.balances.points+' points':money(d.balances.credit_cents)),node('p',points?'Earn 1 point per US$1 of paid merchandise after discounts and redemptions. Redeem 100 points for US$1; minimum 100 points. Shipping, taxes and memberships do not earn points.':'Issued USD store credit can be used for products and delivery. It is not cash and is not a gift-card balance.'),node('p','Redemptions are reserved when an order is placed. Cancelling an unpaid order or completing a full refund restores them. Refunds reverse earned points; a points debt is repaid by later earnings. No automatic expiry.'),link('Shop','/shop'),link('Pending orders','/account/purchases'),node('h3','Activity'));
   const events=d.events.filter(e=>e.asset===(points?'points':'credit'));if(!events.length)root.append(node('p','No activity yet.'));for(const e of events)root.append(node('p',new Date(e.created_at).toLocaleDateString()+' · '+e.reason+' · '+(e.delta>0?'+':'')+(points?e.delta:money(e.delta))));
  }catch(e){root.replaceChildren(node('p',e.message));}
 }
 async function overview(root,auth,user){
  try{const [d,o]=await Promise.all([api(auth),api(auth,null,'orders')]);root.replaceChildren(node('h2','Welcome'+(user.user_metadata?.full_name?', '+user.user_metadata.full_name:'')),node('p',user.email),node('p',(d.membership?'Alta '+d.membership.plan.toUpperCase()+' · active until '+new Date(d.membership.expires_at).toLocaleDateString():'Free member account')),node('p',d.balances.points+' points · '+money(d.balances.credit_cents)+' store credit'),link('Points','/account/points'),link('Store credit','/account/store-credit'),link('Membership','/account/membership'),node('h3','Recent checkout orders'));
   if(!o.invoices.length)root.append(node('p','No checkout orders yet.'));for(const r of o.invoices.slice(0,5))root.append(link((r.checkout_version?'ORD-':'INV-')+r.id.slice(0,8).toUpperCase()+' · '+(r.status==='accepted'?'Awaiting payment':r.status),'/account/purchases?id='+r.id));
   root.append(link('All checkout orders','/account/purchases'),link('Historical orders','/account/orders'));
  }catch(e){root.replaceChildren(node('p',e.message));}
 }
 window.DirectCheckout={checkout,orders,balance,overview};
})();
