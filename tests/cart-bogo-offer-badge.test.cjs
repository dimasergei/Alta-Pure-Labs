'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const cart=fs.readFileSync('cart-reference.js','utf8');
const config=require('../config/checkout.json');
test('single-unit cart displays active +1 FREE offer without altering quote',()=>{
 assert.match(cart,/offerActive&&item\.qty===1\?1:0/);
 assert.match(cart,/node\.textContent=displayFree\?'\+'\+displayFree\+' FREE'/);
 assert.match(cart,/const free=Number\.isSafeInteger\(n\)/);
 assert.match(cart,/data\.total_cents/);
 assert.equal(config.promotions.ends_at,'2026-11-26T23:59:59-06:00');
});
