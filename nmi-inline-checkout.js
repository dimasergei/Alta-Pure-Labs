(()=>{
 'use strict';
 const SOURCE='https://cdn.jsdelivr.net/npm/@nmipayments/nmi-pay@1.1.1/dist/nmi-payments-cdn.iife.js';
 const INTEGRITY='sha384-qp9Er1mVythwqCixKu2kKWEUOFRdWQjXovOGr0O+TuhQOFmd8zihM9I0yC9VavFe';
 let pending;
 function sdk(){
  if(typeof window.mountNmiPayments==='function')return Promise.resolve();
  if(!pending)pending=new Promise((resolve,reject)=>{
   const s=document.createElement('script');s.src=SOURCE;s.integrity=INTEGRITY;s.crossOrigin='anonymous';s.async=true;
   s.onload=()=>typeof window.mountNmiPayments==='function'?resolve():reject(Error('Secure payment component is unavailable.'));
   s.onerror=()=>reject(Error('Secure payment component could not load; no charge was attempted.'));
   document.head.append(s);
  }).catch(e=>{pending=null;throw e});
  return pending;
 }
 const available=(c,id)=>!!(c?.ready===true&&c.method_id===id&&typeof c.tokenization_key==='string'&&c.tokenization_key.length>10);
 function billing(form){
  const name=String(form.elements.name?.value||'').trim().split(/\s+/);
  return{first_name:name.shift()||'',last_name:name.join(' ')||'-',
   address1:form.elements.line1?.value||'',city:form.elements.city?.value||'',state:form.elements.region?.value||'',
   zip:form.elements.postal_code?.value||'',country:form.elements.country?.value||'US'};
 }
 function threeDS(token,conf,bill,amount,currency,host){
  if(!conf.three_ds)return Promise.resolve(null);
  if(typeof window.mountNmiThreeDSecure!=='function')return Promise.reject(Error('Issuer authentication is unavailable.'));
  return new Promise((resolve,reject)=>{
   let done=false,three;
   const finish=(err,result)=>{if(done)return;done=true;try{three?.destroy()}catch{};err?reject(err):resolve(result)};
   const div=document.createElement('div');div.className='nmi-3ds-container';host.append(div);
   try{
    three=window.mountNmiThreeDSecure('#'+host.id+' .nmi-3ds-container',{
     tokenizationKey:conf.tokenization_key,modal:true,
     onComplete:e=>!['verified','attempted'].includes(e.cardHolderAuth)
       ?finish(Error('Cardholder authentication is incomplete.'))
       :finish(null,{status:e.cardHolderAuth,cavv:e.cavv,xid:e.xid,three_ds_version:e.threeDsVersion,directory_server_id:e.directoryServerId}),
     onFailure:()=>finish(Error('Cardholder authentication failed.'))
    });
    three.startThreeDSecure({paymentToken:token,amount:(amount/100).toFixed(2),currency,
     firstName:bill.first_name,lastName:bill.last_name,address1:bill.address1,city:bill.city,
     state:bill.state,postalCode:bill.zip,country:bill.country});
   }catch(e){finish(e)}
  });
 }
 async function mount({host,config,methodId,amount,currency,form,onPayment,onError}){
  if(!available(config,methodId))throw Error('This merchant has not activated embedded card payments.');
  if(!Number.isSafeInteger(amount)||amount<1||amount>100000000||currency!=='USD')throw Error('Invalid final order total.');
  if(!host||!form||typeof onPayment!=='function')throw Error('Secure payment form is unavailable.');
  await sdk();
  host.replaceChildren();host.id='nmi-inline-'+crypto.randomUUID().replace(/-/g,'');
  const fields=document.createElement('div');fields.className='nmi-fields';host.append(fields);
  const methods=['card',...(config.wallets?.apple?['apple-pay']:[]),...(config.wallets?.google?['google-pay']:[])];
  let busy=false,widget;
  const pay=async event=>{
   if(busy)return 'Payment already being confirmed.';
   busy=true;
   try{
    if(typeof event?.token!=='string'||event.token.length<12)throw Error('Payment token not available.');
    const bill=billing(form);
    const auth=await threeDS(event.token,config,bill,amount,currency,host);
    const result=await onPayment({token:event.token,billing:bill,cardholder_auth:auth});
    if(result?.retry){busy=false;return result.message||'Review your payment details and try again.'}
    return result?.paid===true?true:result?.pending===true?'Payment verification pending. Do not retry.':String(result?.message||'Payment requires review.');
   }catch(err){busy=false;if(typeof onError==='function')onError(err);return err.message||'Secure payment unavailable.'}
  };
  widget=window.mountNmiPayments('#'+host.id+' .nmi-fields',{
   tokenizationKey:config.tokenization_key,paymentMethods:methods,
   payButtonText:'Pay '+new Intl.NumberFormat('en-US',{style:'currency',currency}).format(amount/100),
   expressCheckoutConfig:{amount:(amount/100).toFixed(2),currency,countryCode:form.elements.country?.value||'US',
    emailRequired:true,billingRequired:true,applePay:{totalLabel:'AltaPure Labs'},
    googlePay:{totalPriceStatus:'FINAL',buttonType:'pay'}},
   onPay:pay,onExpressCheckout:pay
  });
  return{destroy(){busy=true;try{widget?.destroy?.()}catch{};host.replaceChildren()},methods};
 }
 window.AltaNmiInline={available,mount,billing};
})();
