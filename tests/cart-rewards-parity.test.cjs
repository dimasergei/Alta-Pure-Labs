'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const js=fs.readFileSync('cart-reference.js','utf8');
test('cart shows the server-confirmed free standard shipping threshold without gift milestones',()=>{assert.match(js,/free_shipping_threshold_cents/);assert.match(js,/free_shipping_remaining_cents/);assert.match(js,/Free standard shipping/);assert.doesNotMatch(js,/25000|29900|Free BAC|Free Priority/);});
test('cart shows coupon savings only after a verified BLACKFRIDAY15 quote',()=>{assert.match(js,/data\.pricing\?\.coupon_code==='BLACKFRIDAY15'/);assert.match(js,/BLACKFRIDAY15 \(15%\)/);assert.doesNotMatch(js,/bankSavings|Bank Payment discount|<s>/);});
test('cart retains protection line, exact payment marks and quantity controls',()=>{assert.match(js,/nlc-protection-static/);assert.match(js,/google-g-clean\.svg/);assert.match(js,/nlc-quantity-row/);assert.doesNotMatch(js,/name="nlc_protection"/);});
