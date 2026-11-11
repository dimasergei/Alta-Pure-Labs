(() => {
 'use strict';const root=document.getElementById('payment-options-live');if(!root)return;
 const make=(tag,text)=>{const e=document.createElement(tag);e.textContent=text;return e;};
 (async()=>{try{const r=await fetch('/api/customer-config?checkout=public',{cache:'no-store'});const d=await r.json();if(!r.ok)throw Error('Payment availability could not be checked.');root.replaceChildren();
  root.append(make('p','Choose an available payment method at checkout. Your exact total is shown before you place the order.'));
  for(const m of d.methods){const c=make('article','');c.className='ap-panel';c.append(make('h2',m.label),make('p',m.kind==='bank_transfer'?'Save 5% on merchandise after member or volume discounts. Transfer the exact amount using the secure order instructions; payment is confirmed before fulfillment.':'Secure provider checkout. The provider displays the supported card, wallet or crypto options for your account and device.'));const a=make('a','Continue to checkout');a.href=m.sale_scope==='membership'?'/memberships':'/checkout?method='+encodeURIComponent(m.id);a.className='ap-button';c.append(a);root.append(c);}
  if(!d.methods.length)root.append(make('p','No payment route is available right now. Contact the team before sending funds.'));
  const stamp=document.getElementById('payment-options-updated');if(stamp)stamp.textContent='Availability checked '+new Date().toLocaleString();
 }catch(e){root.replaceChildren(make('p',e.message));}})();
})();
