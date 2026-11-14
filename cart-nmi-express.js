(()=>{
 'use strict';
 let config=null,pending=null,dialog=null;
 async function ready(){
  if(config!==null)return config;
  if(!pending)pending=fetch('/api/customer-config?checkout=public',{cache:'no-store'})
   .then(async r=>r.ok?r.json():null)
   .then(data=>(config=data?.nmi?.ready===true&&(data.capabilities?.apple_pay||data.capabilities?.google_pay)?data.nmi:false))
   .catch(()=>{pending=null;return false});
  return pending;
 }
 async function load(src){
  if(src.includes('supabase')&&window.supabase?.createClient)return;
  if(src.endsWith('readiness-ui.js')&&window.ReadinessUI)return;
  if(src.endsWith('nmi-inline-checkout.js')&&window.AltaNmiInline)return;
  if(src.endsWith('direct-checkout-client.js')&&window.DirectCheckout)return;
  await new Promise((resolve,reject)=>{
   const s=document.createElement('script');s.src=src;s.async=true;s.onload=resolve;s.onerror=()=>reject(Error('Checkout interface is unavailable.'));document.head.append(s);
  });
 }
 async function open(){
  const c=await ready();if(!c)return;
  if(dialog?.open){dialog.focus();return;}
  dialog=document.createElement('dialog');dialog.className='ap-dialog ap-nmi-express-dialog';dialog.setAttribute('aria-label','Secure express checkout');
  const header=document.createElement('div');header.className='ap-dialog-head';const title=document.createElement('h2');title.textContent='Express checkout';
  const close=document.createElement('button');close.type='button';close.textContent='×';close.setAttribute('aria-label','Close checkout');close.onclick=()=>dialog.close();
  header.append(title,close);dialog.append(header);
  const host=document.createElement('section');host.className='ap-nmi-modal-body';host.textContent='Loading secure checkout…';dialog.append(host);
  document.body.append(dialog);dialog.showModal();
  const prevTitle=document.title;dialog.addEventListener('close',()=>{dialog?.remove();dialog=null;document.title=prevTitle},{once:true});
  try{
   await load('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0/dist/umd/supabase.js');
   const r=await fetch('/api/customer-config',{cache:'no-store'});if(!r.ok)throw Error('Account connection unavailable.');
   const settings=await r.json();if(!settings?.supabaseUrl||!settings?.anonKey)throw Error('Account configuration unavailable.');
   const auth=window.supabase.createClient(settings.supabaseUrl,settings.anonKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,flowType:'pkce'}});
   const {data,error}=await auth.auth.getUser();
   if(error||!data?.user?.email_confirmed_at){
    host.replaceChildren();
    const p=document.createElement('p');p.textContent='Sign in to use your verified saved delivery address and express payment.';
    const a=document.createElement('a');a.href='/account/login?returnTo=%2Fcheckout';a.className='ap-button';a.textContent='Sign in to checkout';
    host.append(p,a);return;
   }
   await load('/readiness-ui.js');await load('/nmi-inline-checkout.js');await load('/direct-checkout-client.js');await load('/checkout-reference.js');
   if(!document.querySelector('link[href="/checkout-reference.css"]')){const style=document.createElement('link');style.rel='stylesheet';style.href='/checkout-reference.css';document.head.append(style);}
   if(!document.querySelector('link[href="/account-experience.css"]')){const style=document.createElement('link');style.rel='stylesheet';style.href='/account-experience.css';document.head.append(style);}
   host.replaceChildren();host.classList.add('account-card');
   await window.DirectCheckout.checkout(host,auth,data.user,{method:c.method_id});
  }catch(e){host.textContent=e.message||'Secure express checkout is unavailable.';}
 }
 async function offer(root){
  if(!root?.isConnected||!window.AltaStore?.cart?.length)return;
  const c=await ready();
  if(!c||!root.isConnected||root.querySelector('[data-nmi-express]'))return;
  const wrap=document.createElement('section');wrap.className='ap-cart-express';wrap.setAttribute('data-nmi-express','');
  const button=document.createElement('button');button.type='button';button.className='ap-button';button.textContent='Pay instantly';button.onclick=open;
  const note=document.createElement('p');note.className='ap-fine';
  note.textContent='Secure cards'+(c.wallets?.apple?' · Apple Pay':'')+(c.wallets?.google?' · Google Pay':'')+'. Shipping and discounts confirmed before payment.';
  wrap.append(button,note);
  const before=root.querySelector('.ap-cart-note');before?before.before(wrap):root.append(wrap);
 }
 window.AltaCartNmi={offer,open};
})();
