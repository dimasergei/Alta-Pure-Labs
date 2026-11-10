'use strict';
const fs=require('node:fs');
function patch(file,old,next){let s=fs.readFileSync(file,'utf8');if(s.includes(next))return;if(!s.includes(old))throw Error('Native gateway build integration missing: '+file);fs.writeFileSync(file,s.replace(old,next));}
// Reuse the existing owner-reviewed pricing/issuance workflow. Native invoices link
// to our owned authenticated payment page; staff need not create a provider link.
patch('lib/multi-payment-commerce.js',"if(m.kind==='hosted_link'&&body.provider_amount_confirmed!==true)","if(m.native_provider){const native=require('./gateway-config').assertReady(m.native_provider,env);if(!native.currencies.includes(m.currency))throw error(409,'Gateway currency is not approved.');body={...body,provider_amount_confirmed:true,payment_url:'https://altapurelabs.com/pay.html?invoice='+body.id};}if(m.kind==='hosted_link'&&body.provider_amount_confirmed!==true)");
patch('admin-payments.js',"const v=new FormData(f)","const v=new FormData(f)");
let admin=fs.readFileSync('admin-payments.html','utf8');if(!admin.includes('href="/admin-gateways.html"'))admin=admin.replace('</nav>','<a href="/admin-gateways.html">NMI & PayerURL native gateways</a></nav>');fs.writeFileSync('admin-payments.html',admin);
// Native gateway amount/currency confirmation is server-side and final-invoice based.
patch('admin-payments.js',"payment_url:v.get('payment_url'),provider_amount_confirmed:v.get('provider_amount_confirmed')==='on'","payment_url:v.get('payment_url'),provider_amount_confirmed:v.get('provider_amount_confirmed')==='on'");
// The customer follows the normal accepted-invoice link; no payment or credential
// is embedded into an invoice URL. Configuration remains private in the gateway desk.
console.log('Native NMI / PayerURL payment page installed; provider activation requires real configuration.');
