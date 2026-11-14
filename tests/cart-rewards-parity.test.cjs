'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const js=fs.readFileSync('cart-reference.js','utf8'),css=fs.readFileSync('cart-reference.css','utf8');
test('two shipping milestone tooltips and shimmer are present',()=>{
 assert.match(js,/Free Priority Shipping — \$250\.00/);
 assert.match(js,/Free BAC Water \+ Free Shipping — \$299\.00/);
 assert.match(css,/nlc-shimmer/);
});
test('cart price formatting, conditional bank preview, and no estimated total row',()=>{
 assert.match(js,/Same-Day Bank Payment discount \(5%\)/);
 assert.match(js,/bankSavings/);
 assert.doesNotMatch(js,/<span>Estimated total<\/span>/);
 assert.match(js,/nlc-first-subtotal/);
});
test('no shipping protection toggle, colored google SVG, and quantity spacing',()=>{
 assert.doesNotMatch(js,/name="nlc_protection"/);
 assert.match(js,/nlc-protection-static/);
 assert.match(js,/fill="#4285F4"/);
 assert.match(js,/nlc-quantity-row/);
});
