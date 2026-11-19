'use strict';
const fs=require('node:fs');
for(const [file,note] of [
 ['shipping-policy.html','<strong>U.S. and Canadian standard shipping:</strong> Free for eligible merchandise of $150 or more after discounts, before points or store credit. Under the threshold, standard shipping is $14.95 in the United States and $39.95 in Canada. CAD Interac displays the corresponding converted amount. Express and other international rates are displayed at checkout. Fulfillment is arranged after confirmed payment.'],
 ['refund-policy.html','<strong>Product orders:</strong> Refund requests and payment reconciliation follow the published checkout and product-return terms. Applicable statutory rights are not limited.']
]){
 let html=fs.readFileSync(file,'utf8');
 html=html.replace(/<section id="manual-invoice-policy-note"[\s\S]*?<\/section>/,'');
 html=html.replace('</h1>','</h1><section id="manual-invoice-policy-note" style="margin:24px 0;padding:18px;border:1px solid #d6d6d6;border-radius:10px"><p>'+note+'</p><p><a href="/commercial-terms.html">Read the checkout terms →</a></p></section>');
 fs.writeFileSync(file,html);
}

// Public estimates are clearly separate from the order-specific shipping quote.
const supplierProfiles=JSON.parse(fs.readFileSync('data/supplier-references.json','utf8')).suppliers;
const escapeHtml=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const timing=range=>range?range.min+'–'+range.max+' business days':'Confirmed with supplier';
const supplierSection='<section id="supplier-delivery-estimates" style="margin:24px 0;padding:18px;border:1px solid #d6d6d6;border-radius:10px"><h2>Supplier delivery estimates</h2><p>Our selected suppliers dispatch from the United States. The estimates below help plan an order; the order receives its actual carrier and tracking after dispatch. Availability, order cutoff and customs can affect timing.</p>'+supplierProfiles.map(s=>'<article><h3>'+escapeHtml(s.name)+'</h3><p>'+escapeHtml(s.handling_note)+'</p><p>US transit: '+timing(s.domestic_transit)+'. International transit: '+timing(s.international_transit)+'.</p><p>'+escapeHtml(s.service_note)+'</p><p><a href="'+escapeHtml(s.shipping_source)+'" target="_blank" rel="noopener noreferrer">Supplier shipping information ↗</a></p></article>').join('')+'<p>Reviewed November 10, 2026. A supplier handling fee is not necessarily a shipping charge. Tracking is provided after manual fulfillment and carrier assignment. <a href="/contact">Ask about your destination</a>.</p></section>';
let shippingPolicy=fs.readFileSync('shipping-policy.html','utf8');
shippingPolicy=shippingPolicy.replace(/<section id="supplier-delivery-estimates"[\s\S]*?<\/section>/,'');
shippingPolicy=shippingPolicy.replace('</main>',supplierSection+'</main>');
fs.writeFileSync('shipping-policy.html',shippingPolicy);
