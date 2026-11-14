'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const checkout=fs.readFileSync('checkout-reference.js','utf8');
const css=fs.readFileSync('checkout-reference.css','utf8');
test('shipping protection is preselected at initial US checkout but remains user-toggleable',()=>{
 assert.match(checkout,/isActive\('protection'\)&&\(supported\.includes\(saved\.country\)\?saved\.country:'US'\)==='US'\?\['protection'\]:\[\]/);
 assert.match(checkout,/x\.checked\?state\.extras\.add\('protection'\):state\.extras\.delete\('protection'\)/);
 assert.match(checkout,/data-nlx-extra="protection"/);
});
test('the requested ByteNFT and future-bank-link text appears verbatim in the inactive or preview sections',()=>{
 assert.ok(checkout.includes('Bank/Card Statement Information: This transaction will appear as from *ByteNFT.'));
 assert.ok(checkout.includes('Pay with your bank account through our secured gateway. You’ll be redirected to your bank to sign in and approve the payment. Your credentials remain with your bank.'));
 assert.ok(checkout.includes('Link a new bank account'));
 assert.ok(checkout.includes('aria-checked="true"'));
 assert.ok(checkout.includes('non-operational preview'));
});
test('bank artwork comes from user screenshot assets rather than icon approximations',()=>{
 for(const name of ['chase','bofa','wf']){
  assert.ok(checkout.includes('/assets/payment-brands/'+name+'-reference.png'));
 }
 assert.match(css,/\.nlx-bank-link-dot::after/);
});
test('only an active bank transfer choice enables order submission; cards and wallets remain disabled',()=>{
 assert.match(checkout,/nlx-wallet-unavailable" disabled/);
 assert.match(checkout,/Card number \*<input disabled/);
 assert.match(checkout,/selected==='bank'&&bank/);
 assert.match(checkout,/method_id:bank\.id/);
});
test('black express pay buttons render fully opaque while remaining disabled',()=>{
 assert.match(css,/\.nlx-wallets \.nlx-wallet-unavailable:disabled/);
 assert.match(css,/opacity:1!important/);
 assert.match(checkout,/nlx-google-symbol/);
 assert.match(checkout,/nlx-apple-symbol/);
});
