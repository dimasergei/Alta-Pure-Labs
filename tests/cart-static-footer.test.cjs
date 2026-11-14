'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const cart=fs.readFileSync('cart-reference.js','utf8');
const css=fs.readFileSync('cart-reference.css','utf8');
test('cart shipping protection is always included without a checkbox or toggle',()=>{
 assert.match(cart,/selected\.add\('protection'\)/);
 assert.match(cart,/nlc-protection-static/);
 assert.doesNotMatch(cart,/name="nlc_protection"/);
 assert.doesNotMatch(cart,/selected\.delete\('protection'\).*saveExtras/);
});
test('cart footer cannot scroll and product list can scroll',()=>{
 assert.match(css,/\.nlc-cart-checkout\{[^}]*overflow:visible/s);
 assert.doesNotMatch(css,/\.nlc-cart-checkout\{[^}]*overflow-y:auto/s);
 assert.match(css,/\.nlc-scrollable-items\{[^}]*overflow-y:auto/s);
});
test('wallet branding, payment amount and delivery estimate appear in cart',()=>{
 assert.match(cart,/nlc-google-mark/);
 assert.match(cart,/nlc-apple-mark/);
 assert.match(cart,/data-nlc-instant-amount/);
 assert.match(cart,/data-nlc-estimate/);
 assert.match(cart,/dateLabel\(7\).*dateLabel\(13\)/);
 assert.match(cart,/RUO Agreement/);
 assert.match(cart,/\+'\+displayFree\+' FREE'/);
 assert.doesNotMatch(cart,/FREE · BOGO/);
});
