'use strict';
const fs=require('node:fs');
let account=fs.readFileSync('account.js','utf8');
if(!account.includes('ManualCommerce.render')){const anchor="if(p==='/account/reset-password'";if(!account.includes(anchor))throw Error('Invoice route integration point missing.');account=account.replace(anchor,"if(p==='/account/invoices'){if(!user)return go('/account/login?returnTo='+encodeURIComponent(location.pathname+location.search));root.innerHTML=head('Invoices & manual orders')+accountNav(p)+'<section id=\"manual-invoices-root\"></section>';document.getElementById('logout').onclick=logout;window.ManualCommerce.render(document.getElementById('manual-invoices-root'),auth,user);return;}"+anchor);account=account.replace("['Orders','/account/orders']","['Invoices','/account/invoices'],['Orders','/account/orders']");fs.writeFileSync('account.js',account);}
let html=fs.readFileSync('account.html','utf8');if(!html.includes('manual-commerce-client.js'))html=html.replace('<script src="/account.js">','<script src="/manual-commerce-client.js"></script><script src="/account.js">');fs.writeFileSync('account.html',html);
let app=fs.readFileSync('storefront-v2.js','utf8');
app=app.replace('<button class="ap-button" disabled>Checkout unavailable</button>','<a class="ap-button" href="/account/invoices?new=goods">Request reviewed payment invoice ↗</a>');
app=app.replace("checkoutPaused:'Online checkout is currently paused.'","checkoutPaused:'Instant card checkout is not connected. Reviewed invoices are available.'");
app=app.replace("checkoutNote:'You can build and save your cart. No payment will be taken.'","checkoutNote:'Request an invoice for manual fulfillment. Pay only after the final amount and business receiving method are confirmed.'");
app=app.replace("checkoutPaused:'Les commandes en ligne sont suspendues.'","checkoutPaused:'Le paiement instantané par carte est indisponible. Demandez une facture.'");
app=app.replace("checkoutPaused:'Los pedidos en línea están suspendidos.'","checkoutPaused:'El pago instantáneo con tarjeta no está conectado. Solicite una factura.'");
app=app.replace('Online checkout is paused while payment options are updated. Catalog browsing, research lists, cart planning, account access, and inquiries remain available.','Instant card checkout is not connected. You can request a reviewed invoice, accept its final amount, and use the confirmed business payment instructions. Orders are fulfilled manually after receipt is verified.');
fs.writeFileSync('storefront-v2.js',app);
for(const file of ['admin-operations.html','admin-operations-overview.html']){let h=fs.readFileSync(file,'utf8');if(!h.includes('/admin-payments.html'))h=h.replace('</main>','<p><a href="/admin-payments.html">Payments & manual orders →</a></p></main>');fs.writeFileSync(file,h);}
console.log('Manual invoices and payment desk integrated. No processor or receiving method activated by build.');
