(() => {
 'use strict';const root=document.getElementById('payment-options-live');if(!root)return;
 const make=(tag,text)=>{const e=document.createElement(tag);e.textContent=text;return e;};
 (async()=>{try{const r=await fetch('/api/customer-config?checkout=public',{cache:'no-store'});const d=await r.json();if(!r.ok)throw Error('Payment availability could not be checked.');root.replaceChildren();
  const interac=(d.payment_options||[]).some(option=>option.key==='interac'&&option.status==='available');
  root.append(make('p',interac?'Choose Card or Crypto in USD, or pay by Interac e-Transfer in CAD with a Canadian shipping address. Your final total is shown before you place the order.':'Choose Card or Crypto at checkout. Your order total is verified before you continue to the payment provider.'));
  for(const option of d.payment_options||[]){const c=make('article','');c.className='ap-panel';c.append(make('h2',option.key==='interac'?'Interac e-Transfer (CAD)':option.name),make('p',option.description));
   if(option.discount_policy)c.append(make('p',option.discount_policy));
   if(option.status==='available'){const a=make('a','CONTINUE TO CHECKOUT');a.href='/checkout?method='+encodeURIComponent(option.method_id);a.className='ap-button';c.append(a);}
   else c.append(make('p','SETUP PENDING'));
   root.append(c);
  }
  const stamp=document.getElementById('payment-options-updated');if(stamp)stamp.textContent='Availability checked '+new Date().toLocaleString();
 }catch(e){root.replaceChildren(make('p',e.message));}})();
})();
