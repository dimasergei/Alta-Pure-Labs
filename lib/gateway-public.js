'use strict';
const policy=require('./pure-payment-policy');
function describe(methods){
 const available=methods.filter(method=>method.active&&policy.kind(method)&&Array.isArray(method.countries));
 return {invoice_requests:true,card_to_crypto_connected:available.some(method=>policy.kind(method)==='card'),
  payment_methods:available.map(policy.publicMethod),
  payment_options:policy.choices(available).map((choice,index)=>({...choice,mode:'native_checkout',display_order:index+1,
   currencies:choice.method_id?['USD']:[],methods:available.filter(method=>policy.kind(method)===choice.key).map(policy.publicMethod)})),
  native_card_processor_connected:false,card_processor_connected:false,
  collection_mode:'verified_hosted_card_or_crypto'};
}
module.exports={describe};
