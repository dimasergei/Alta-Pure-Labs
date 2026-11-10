'use strict';
const definitions=require('../config/payment-provider-options.json');
const fail=message=>{const e=Error(message);e.status=400;throw e;};
const byKey=key=>definitions.find(p=>p.key===key);
function infer(method){return method.provider_key||(['interac','bank_transfer'].includes(method.kind)?method.kind:'custom');}
function cleanHost(raw){if(typeof raw!=='string')fail('Enter a public HTTPS hostname.');const h=raw.trim().toLowerCase();if(!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(h)||/\.(localhost|local|internal|test|invalid|example)$/.test(h)||h.endsWith('.onion')||h.length>253)fail('Use the exact public hostname, not a URL, local address or wildcard.');return h;}
function providerHost(key,raw){const h=cleanHost(raw);if(key==='paypal'&&!['www.paypal.com','paypal.com'].includes(h))fail('PayPal invoices must use paypal.com or www.paypal.com.');if(key==='stripe'&&!['invoice.stripe.com','pay.stripe.com'].includes(h))fail('Use Stripe hosted invoices on invoice.stripe.com or pay.stripe.com.');if(key==='nowpayments'&&h!=='nowpayments.io')fail('Use nowpayments.io for the NOWPayments hosted invoice.');return h;}
function methodExtra(validated,input){const key=input.provider_key||infer(validated),d=byKey(key);if(!d)fail('Unknown payment provider.');if(d.kind!==validated.kind&&!(key==='custom'&&validated.kind==='hosted_link'))fail('Provider and payment mechanism do not match.');if(!d.currencies.includes(validated.currency))fail('That provider entry does not support this invoice currency.');const priority=input.display_order===undefined?d.default_order:Number(input.display_order);if(!Number.isInteger(priority)||priority<0||priority>999)fail('Priority must be an integer from 0 to 999.');const scope=input.sale_scope||'both';if(!['goods','membership','both'].includes(scope))fail('Choose products, passes, or both.');const host=validated.kind==='hosted_link'?providerHost(key,validated.allowed_host):'';return {...validated,provider_key:key,display_order:priority,sale_scope:scope,allowed_host:host};}
function hostedUrl(raw,method){if(method.kind!=='hosted_link')return null;const key=infer(method),host=providerHost(key,method.allowed_host);let u;try{u=new URL(raw);}catch{fail('Paste the exact invoice payment URL.');}if(u.protocol!=='https:'||u.hostname!==host||u.username||u.password||u.port)fail('The invoice URL must match the configured HTTPS payment hostname.');if(/[\u0000-\u0020\\]/.test(raw)||/%(?:0[0-9a-f]|1[0-9a-f]|2f|5c)/i.test(u.pathname))fail('The payment URL contains invalid characters.');
 if(key==='paypal'){
  const modern=/^\/invoice\/(?:p|view)\/[A-Za-z0-9_-]{6,}\/?$/.test(u.pathname)&&!u.hash;
  const legacy=/^\/invoice\/p\/?$/.test(u.pathname)&&/^#[A-Za-z0-9_-]{6,}$/.test(u.hash);
  if(!modern&&!legacy)fail('Use a PayPal Business invoice URL, not a personal payment or PayPal.Me link.');
 }else{
  if(u.hash)fail('Unexpected fragment in payment URL.');
  if(key==='stripe'&&!((host==='invoice.stripe.com'&&/^\/i\/acct_[A-Za-z0-9]+\/live_[A-Za-z0-9_-]+$/.test(u.pathname))||(host==='pay.stripe.com'&&/^\/invoice\/acct_[A-Za-z0-9]+\/live_[A-Za-z0-9_-]+$/.test(u.pathname))))fail('Use a live Stripe hosted invoice for this exact order; test links and reusable payment links are not accepted.');
  if(key==='btcpay'&&!/^\/i\/[A-Za-z0-9_-]{6,}\/?$/.test(u.pathname))fail('Use the /i/ checkout URL for the exact BTCPay invoice.');
  if(key==='nowpayments'&&(!/^\/payment\/?$/.test(u.pathname)||u.searchParams.getAll('iid').length!==1||!/^\d{1,24}$/.test(u.searchParams.get('iid')||'')))fail('Use the NOWPayments payment URL with its invoice iid.');
  if(key==='custom'&&u.pathname==='/')fail('Paste a provider-issued invoice URL, not its homepage.');
 }
 for(const key of u.searchParams.keys())if(/^(redirect|redirect_uri|return|return_url|url|next)$/i.test(key))fail('Use the original invoice URL without redirect parameters.');
 return u.href;
}
function sorted(methods){return [...methods].sort((a,b)=>(a.display_order??byKey(infer(a))?.default_order??100)-(b.display_order??byKey(infer(b))?.default_order??100)||a.label.localeCompare(b.label)||a.id.localeCompare(b.id));}
function publicMethods(methods){return sorted(methods.filter(m=>m.active)).map(m=>({id:m.id,label:m.label,kind:m.kind,currency:m.currency,provider_key:infer(m),display_order:m.display_order??100,sale_scope:m.sale_scope||'both'}));}
function publicOptions(methods){return definitions.map(d=>{const own=methods.filter(m=>infer(m)===d.key),active=publicMethods(own);return {key:d.key,name:d.name,description:d.description,mode:d.kind==='hosted_link'?'hosted_invoice':'manual_transfer',status:active.length?'available':own.length?'disabled':'not_configured',display_order:active[0]?.display_order??d.default_order,currencies:[...new Set(active.map(m=>m.currency))],methods:active};}).sort((a,b)=>Number(b.status==='available')-Number(a.status==='available')||a.display_order-b.display_order);}
function allowedFor(method,kind){return (method.sale_scope||'both')==='both'||method.sale_scope===kind;}
module.exports={definitions,byKey,infer,cleanHost,methodExtra,hostedUrl,sorted,publicMethods,publicOptions,allowedFor};
