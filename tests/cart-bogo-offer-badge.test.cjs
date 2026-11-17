'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
test('cart has no free-unit badges or quantity expansion',()=>{const cart=fs.readFileSync('cart-reference.js','utf8');assert.doesNotMatch(cart,/bogo-free|displayFree|offerActive|qty\s*\*\s*2/);assert.match(cart,/data\.total_cents/);assert.match(cart,/BLACKFRIDAY15/);});
