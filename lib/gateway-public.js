'use strict';
const config=require('./gateway-config'),options=require('./payment-provider-options');
function describe(methods,env){
 const usable=methods.map(m=>m.native_provider&&!config.configuration(m.native_provider,env).ready?{...m,active:false}:m);
 const native=['nmi','payerurl'].map(key=>{const own=usable.filter(m=>m.native_provider===key),active=options.publicMethods(own);return{key,name:key==='nmi'?'Credit / debit card — NMI':'Crypto — PayerURL',description:key==='nmi'?'Tokenized on-site card payment for accepted, reviewed invoices. Wallet availability depends on the merchant account.':'Server-created crypto checkout with authenticated payment confirmation. Exact token/network options depend on the configured provider account.',mode:'native_checkout',status:active.length?'available':own.length?'disabled':'not_configured',display_order:key==='nmi'?1:8,currencies:[...new Set(active.map(m=>m.currency))],methods:active};});
 return{invoice_requests:true,payment_methods:options.publicMethods(usable),payment_options:[...native,...options.publicOptions(usable.filter(m=>!m.native_provider))].sort((a,b)=>Number(b.status==='available')-Number(a.status==='available')||a.display_order-b.display_order),native_card_processor_connected:native[0].status==='available',card_processor_connected:native[0].status==='available',collection_mode:'reviewed_invoice_with_enabled_native_or_manual_payment'};
}
module.exports={describe};
