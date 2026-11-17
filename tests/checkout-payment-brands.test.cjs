'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const js=fs.readFileSync('checkout-reference.js','utf8');
test('hosted checkout restores wallet artwork without inventing native wallet or bank collection',()=>{
 for(const asset of ['apple-mark-clean.svg','google-g-clean.svg'])assert.ok(js.includes(asset));
 for(const name of ['ApplePaySession','google.payments.api','chase-reference.png','bofa-reference.png','wf-reference.png','No Fees!'])assert.equal(js.includes(name),false);
 assert.match(js,/Cards|cards/);assert.match(js,/digital wallets depend on your country, device and provider eligibility/);
});
test('new checkout offers two concise payment choices and does not collect raw card data',()=>{
 assert.match(js,/\['card','crypto'\]/);assert.doesNotMatch(js,/Card number|Card code|CVC|Link a new bank account|ByteNFT/);
 assert.match(js,/openHostedPayment/);assert.match(js,/SETUP PENDING/);
});
