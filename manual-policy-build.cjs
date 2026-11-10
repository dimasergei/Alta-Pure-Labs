'use strict';
const fs=require('node:fs');
for(const [file,note] of [
 ['shipping-policy.html','<strong>Manual-invoice orders:</strong> The instant-checkout pause described below does not prevent an individually reviewed manual order. Its exact destination, available products, shipping charges, taxes and handling arrangements must be confirmed in the final invoice before payment. Supplier dispatch origin, carrier/service, handling and transit estimates, and import-charge responsibility are shown on the reviewed invoice. Shipping is quoted for the exact order; quotes may expire. No general worldwide-shipping or fixed-rate promise is made.'],
 ['refund-policy.html','<strong>Prepaid annual passes and manual invoices:</strong> The specific launch terms describe the 14-day unused-pass refund request policy and manual payment reconciliation. Product-return provisions below continue to apply to goods. Applicable statutory rights are not limited.']
]){
 let html=fs.readFileSync(file,'utf8');
 if(!html.includes('id="manual-invoice-policy-note"'))html=html.replace('</h1>','</h1><section id="manual-invoice-policy-note" style="margin:24px 0;padding:18px;border:1px solid #bbc8b1;border-radius:10px"><p>'+note+'</p><p><a href="/commercial-terms.html">Read the launch commercial terms →</a></p></section>');
 fs.writeFileSync(file,html);
}
