'use strict';
const fs=require('node:fs'),path=require('node:path');
const out='public-build';
function patch(file,fn){const p=path.join(out,file);fs.writeFileSync(p,fn(fs.readFileSync(p,'utf8')));}
patch('account.html',s=>s.replace('<script src="/account.js">','<script src="/nmi-inline-checkout.js"></script><script src="/direct-checkout-client.js"></script><script src="/account.js">'));
patch('account.js',s=>{
 const continuation=`function safeCheckoutReturn(value){if(typeof value!=='string'||/[\\\\\\r\\n]/.test(value)||!value.startsWith('/')||value.startsWith('//'))return null;try{const u=new URL(value,location.origin);if(u.origin!==location.origin||!/^\\/(?:checkout|pay\\.html|account\\/(?:purchases|membership|points|store-credit|orders(?:\\/[A-Za-z0-9_-]+)?))$/.test(u.pathname))return null;return u.pathname+u.search;}catch{return null;}}\nfunction consumeCheckoutReturn(value){const next=safeCheckoutReturn(value)||safeCheckoutReturn(sessionStorage.getItem('ap-account-return'));sessionStorage.removeItem('ap-account-return');return next;}\n`;
 s=s.replace('function route(){',continuation+'function route(){');
 s=s.replace("go(ret&&ret.startsWith('/')&&!ret.startsWith('//')?ret:'/account/orders');","go(consumeCheckoutReturn(ret)||'/account');")
 .replace("if(data.session)return go('/account/orders');","if(data.session)return go(consumeCheckoutReturn()||'/account');");
 const anchor="if(p==='/account/invoices')";
 if(!s.includes(anchor))throw Error('Account checkout integration point missing');
 const route=`if(p==='/checkout'){if(!user)return go('/account/login?returnTo='+encodeURIComponent(location.pathname+location.search));root.innerHTML=accountNav(p)+'<section id="direct-checkout-root"></section>';document.getElementById('logout').onclick=logout;window.DirectCheckout.checkout(document.getElementById('direct-checkout-root'),auth,user);return;}if(p==='/account/invoices'){const q=new URLSearchParams(location.search),fresh=q.get('new');return go(fresh?'/checkout'+(fresh==='goods'?'':'?plan='+encodeURIComponent(fresh)):'/account/purchases'+location.search);}if(p==='/account/purchases'){if(!user)return go('/account/login?returnTo='+encodeURIComponent(location.pathname+location.search));root.innerHTML=head('Orders')+accountNav(p)+'<section id="direct-orders-root"></section>';document.getElementById('logout').onclick=logout;window.DirectCheckout.orders(document.getElementById('direct-orders-root'),auth,user);return;}if(p==='/account/points'||p==='/account/store-credit'){if(!user)return go('/account/login?returnTo='+encodeURIComponent(p));root.innerHTML=head(p.endsWith('points')?'Points':'Store credit')+accountNav(p)+'<section id="direct-balance-root"></section>';document.getElementById('logout').onclick=logout;window.DirectCheckout.balance(document.getElementById('direct-balance-root'),auth,p);return;}`;
 const resume=`if(['/account/login','/account/signup'].includes(p)){const next=safeCheckoutReturn(new URLSearchParams(location.search).get('returnTo'));if(next)sessionStorage.setItem('ap-account-return',next);}if(p==='/account'&&user){const next=consumeCheckoutReturn();if(next)return go(next);}`;
 return s.replace(anchor,resume+route+anchor).replace("['Invoices','/account/invoices'],['Orders','/account/orders']","['Orders','/account/purchases'],['Historical orders','/account/orders']")
 .replace('if(user)return overview();',`if(user){root.innerHTML=head('Overview')+accountNav('/account')+'<section id="direct-overview-root"></section>';document.getElementById('logout').onclick=logout;window.DirectCheckout.overview(document.getElementById('direct-overview-root'),auth,user);return;}`)
 .replace('async function tracking(){',`async function tracking(){await legacyTracking();const recent=document.createElement('section');recent.className='ap-panel';root.append(recent);await window.DirectCheckout.orders(recent,auth,user);}\nasync function legacyTracking(){`);
});
patch('storefront-v2.js',s=>s
 .replaceAll('/account/invoices?new=goods','/checkout').replaceAll('/account/invoices?new=','/checkout?plan=')
 .replaceAll('Request reviewed payment invoice ↗','Continue to checkout ↗').replaceAll('Request pass invoice','Buy annual pass')
 .replaceAll('Order history and invoice tracking','Order history and tracking').replaceAll('on reviewed invoices','at checkout')
 .replaceAll('Instant card checkout is not connected. Reviewed invoices are available.','Checkout is available for US delivery.')
 .replaceAll('Request an invoice for manual fulfillment. Pay only after the final amount and business receiving method are confirmed.','Review your final total and choose an available payment method at checkout.')
 .replaceAll('Instant card checkout is not connected. You can request a reviewed invoice, accept its final amount, and use the confirmed business payment instructions. Orders are fulfilled manually after receipt is verified.','Choose your products, review the final total, and pay using an available method. Bank transfers include 5% merchandise savings. Fulfillment begins after payment is confirmed.')
 .replaceAll('Le paiement instantané par carte est indisponible. Demandez une facture.','Passez au paiement pour les livraisons aux États-Unis.')
 .replaceAll('El pago instantáneo con tarjeta no está conectado. Solicite una factura.','Finalice su compra para entregas en Estados Unidos.')
 .replaceAll('Préparez et enregistrez votre panier. Aucun paiement ne sera effectué.','Vérifiez le total et choisissez un moyen de paiement disponible.')
 .replaceAll('Puede preparar y guardar su carrito. No se realizará ningún pago.','Revise el total y elija un método de pago disponible.')
 .replaceAll('Shipment eligibility, rates, and timing are confirmed separately.','Standard US delivery is US$25 per order; view the estimated timing at checkout.')
 .replaceAll('Shipping, taxes, and unapproved discounts are not included.','Final discounts and delivery are calculated at checkout.'));
patch('workspace-v2.js',s=>s
 .replaceAll('Paid passes activate after the reviewed invoice is paid and receipt is verified.','Paid passes activate after payment is confirmed.')
 .replaceAll('No automatic renewal, free-shipping promise, or rewards earning is included. See the launch commercial terms.','No automatic renewal or free shipping is included. Paid merchandise earns 1 point per US$1; 100 points are worth US$1 at checkout. See the checkout terms.')
 .replaceAll('Rewards redemption is not offered at launch. Annual passes are invoiced separately; no balance is created by browsing, purchasing a pass or saving a list.','Earn 1 point per US$1 of paid merchandise after discounts and redemptions. Redeem at least 100 points at US$0.01 each. Store credit is separate. No points on shipping, taxes or passes. Full refunds reverse earnings and restore redeemed value. No automatic expiry.')
 .replaceAll('Earning and redemption terms are shown when the program is active.','Earn 1 point per US$1 of paid merchandise; 100 points = US$1. Redeem at checkout.')
 .replaceAll('Redemption is not enabled while checkout is paused.','Use available balances at checkout.'));
patch('manual-commerce-client.js',s=>s.replaceAll('on reviewed invoices','at checkout'));
// Change customer-facing wording while retaining stable historical API names and links.
for(const file of ['native-pay.js','pay.html'])patch(file,s=>s
 .replaceAll('Secure Invoice Payment','Secure Payment').replaceAll('Loading your invoice','Loading your order')
 .replaceAll('Invoice payment','Order payment').replaceAll('My invoices','My orders')
 .replaceAll('your accepted invoice','your order').replaceAll('your invoice','your order')
 .replaceAll('Your invoice','Your order').replaceAll('the invoice','the order').replaceAll('this invoice','this order')
 .replaceAll('invoice history','order history').replaceAll('invoice ownership','order ownership')
 .replaceAll('final invoice amount','final order amount').replaceAll('marks an invoice paid','marks an order paid')
 .replaceAll('Current invoice status','Current order status').replaceAll('Refresh this invoice','Refresh this order')
 .replaceAll('/account/invoices','/account/purchases'));
// The payment-options widget only advertises routes that are actually enabled.
for(const file of ['payment-options-public.js','payment-options-ui.js'])patch(file,s=>s
 .replaceAll('reviewed invoice','order').replaceAll('accepted invoice','order').replaceAll('payment invoice','payment')
 .replaceAll('invoice requests','checkout').replaceAll('Request an invoice','Proceed to checkout').replaceAll('/account/invoices?new=goods','/checkout'));
for(const entry of fs.readdirSync(out,{withFileTypes:true}))if(entry.isFile()&&entry.name.endsWith('.html')&&!entry.name.startsWith('admin-'))patch(entry.name,s=>s.replaceAll('Online checkout is paused.','US checkout is available.').replaceAll('Online checkout is currently paused','US checkout is available').replaceAll('Invoice requests','Checkout').replaceAll('request an invoice','check out').replaceAll('/account/invoices?new=goods','/checkout'));
for(const file of fs.readdirSync(path.join(out,'product')))patch('product/'+file,s=>s.replaceAll('Online checkout is paused.','US checkout is available.'));
patch('robots.txt',s=>s+'Disallow: /checkout\nDisallow: /pay.html\n');
fs.copyFileSync('nmi-inline-checkout.js',path.join(out,'nmi-inline-checkout.js'));
fs.copyFileSync('cart-nmi-express.js',path.join(out,'cart-nmi-express.js'));
fs.copyFileSync('checkout-payment-options.js',path.join(out,'payment-options-public.js'));
patch('payment-options.html',s=>s.replace('See current availability for Interac, bank transfer, PayPal, Stripe, BTCPay Bitcoin and NOWPayments invoices.','See the payment methods currently available at checkout.')
 .replace('Choose a preferred enabled method when requesting an invoice. Review the exact final currency and amount before accepting. The presence of a provider here does not mean its account is connected or that every product is eligible.','Review the final total and choose an available payment method at checkout. Only enabled routes are shown below.')
 .replace(/requesting an invoice/gi,'checking out').replace(/reviewed invoices/gi,'orders'));
console.log('Direct checkout, real points and credit ledgers, and order account routes built.');
