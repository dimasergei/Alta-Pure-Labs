'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const js=fs.readFileSync('checkout-reference.js','utf8');
test('hosted checkout does not advertise unverified native wallet or bank brands',()=>{
 for(const name of ['nlx-apple-symbol','nlx-google-symbol','chase-reference.png','bofa-reference.png','wf-reference.png','No Fees!'])assert.equal(js.includes(name),false);
 assert.match(js,/Cards|cards/);assert.match(js,/digital wallets depend on your country, device and provider eligibility/);
});
test('new checkout offers two concise payment choices and does not collect raw card data',()=>{
 assert.match(js,/\['card','crypto'\]/);assert.doesNotMatch(js,/Card number|Card code|CVC|Link a new bank account|ByteNFT/);
 assert.match(js,/openHostedPayment/);assert.match(js,/SETUP PENDING/);
});
