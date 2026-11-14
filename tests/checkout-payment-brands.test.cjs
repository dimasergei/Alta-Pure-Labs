'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const js=fs.readFileSync('checkout-reference.js','utf8');
const css=fs.readFileSync('checkout-reference.css','utf8');
test('Express wallets use transparent inline brand symbols without card logos',()=>{
 assert.match(js,/nlx-apple-symbol/);assert.match(js,/nlx-google-symbol/);
 const wallet=js.split("nlx-wallets\" data-nlx-wallets")[1]?.split("nlx-wallet-consent")[0]||'';
 assert.doesNotMatch(wallet,/nlx-wallet-card-logos/);
 assert.match(js,/fill="#4285F4"/);
});
test('Card and bank choices have distinct logos and phone and bank icons',()=>{
 for(const x of ['visa-blue.svg','amex-blue.svg','nlx-phone-symbol','nlx-bank-symbol','nlx-chase-mark','nlx-bofa-mark','nlx-wf-mark','Link a new bank account'])assert.ok(js.includes(x),x);
});
test('Payment UI remains nonfunctional for card and wallets',()=>{
 assert.match(js,/nlx-wallet-unavailable" disabled/);
 assert.match(js,/Card number \*<input disabled/);
 assert.match(js,/selected==='bank'&&bank/);
 assert.match(css,/nlx-wallet-symbol/);
});
