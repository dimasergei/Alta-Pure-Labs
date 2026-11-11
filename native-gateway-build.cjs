'use strict';
const fs=require('node:fs');
function patch(file,old,next){let s=fs.readFileSync(file,'utf8');if(s.includes(next))return;if(!s.includes(old))throw Error('Native gateway build integration missing: '+file);fs.writeFileSync(file,s.replace(old,next));}
// Native collection follows the existing final-invoice pricing and owner review.
patch('lib/multi-payment-commerce.js',"if(m.kind==='hosted_link'&&body.provider_amount_confirmed!==true)","if(m.native_provider){const native=require('./gateway-config').assertReady(m.native_provider,env);if(!native.currencies.includes(m.currency))throw error(409,'Gateway currency is not approved.');body={...body,provider_amount_confirmed:true,payment_url:'https://altapurelabs.com/pay.html?invoice='+body.id};}if(m.kind==='hosted_link'&&body.provider_amount_confirmed!==true)");
let admin=fs.readFileSync('admin-payments.html','utf8');if(!admin.includes('href="/admin-gateways.html"'))admin=admin.replace('</nav>','<a href="/admin-gateways.html">NMI & PayerURL native gateways</a></nav>');admin=admin.replace('NMI & PayerURL native gateways','Payment gateways');fs.writeFileSync('admin-payments.html',admin);
patch('lib/multi-payment-commerce.js',"provider_key,display_order,sale_scope,active';","provider_key,display_order,sale_scope,active,native_provider';");
patch('lib/multi-payment-commerce.js',"{invoice_requests:true,payment_methods:options.publicMethods(methods),payment_options:options.publicOptions(methods),native_card_processor_connected:false,card_processor_connected:false,collection_mode:'reviewed_invoice_manual_reconciliation',terms}","{...require('./gateway-public').describe(methods,env),terms}");
patch('native-pay.js',"methods.push('googlepay')","methods.push('google-pay')");
patch('native-pay.js',"methods.push('applepay')","methods.push('apple-pay')");
patch('payment-options-public.js',"opt.mode==='hosted_invoice'?'Secure provider-hosted invoice. AltaPure verifies the payment before fulfillment.'", "opt.mode==='native_checkout'?'Secure gateway checkout from your accepted invoice. Authenticated provider confirmation updates payment status.':opt.mode==='hosted_invoice'?'Secure provider-hosted invoice. AltaPure verifies the payment before fulfillment.'");
console.log('Native NMI / PayerURL checkout installed. Provider activation still requires real configuration.');
