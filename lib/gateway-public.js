'use strict';
const policy=require('./pure-payment-policy');
function describe(methods){
 const available=methods.filter(method=>method.active&&policy.kind(method)&&Array.isArray(method.countries));
 return {invoice_requests:true,card_to_crypto_connected:available.some(method=>policy.kind(method)==='card'),
  payment_methods:available.map(policy.publicMethod),
  payment_options:policy.choices(available).map((choice,index)=>{const routes=available.filter(method=>policy.kind(method)===choice.key);return {...choice,mode:choice.mode||'native_checkout',display_order:index+1,
   currencies:[...new Set(routes.map(method=>method.currency))],methods:routes.map(policy.publicMethod)};}),
  native_card_processor_connected:false,card_processor_connected:false,
  collection_mode:'verified_card_crypto_or_interac'};
}
module.exports={describe};
