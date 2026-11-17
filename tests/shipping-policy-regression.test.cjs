"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const checkout=require('../config/checkout.json'),zones=require('../config/shipping-zones.json');
test('published shipping terms match current standard pricing and the after-coupon free-shipping threshold',()=>{
 const policy=fs.readFileSync('shipping-policy.html','utf8'),terms=fs.readFileSync('commercial-terms.html','utf8'),builder=fs.readFileSync('manual-policy-build.cjs','utf8');
 assert.equal(checkout.free_shipping_threshold_cents,15000);
 for(const [name,text]of Object.entries({policy,terms,builder})){
  assert.match(text,/US\$150/,name);assert.match(text,/after any coupon/,name);assert.match(text,/US\$14\.95/,name);
  assert.doesNotMatch(text,/US\$25|US\$250|US\$299|International checkout is unavailable|US delivery only|annual passes|membership/i,name);
 }
 assert.match(policy,/international services and rates/i);assert.match(policy,/Tracking is added to your order after dispatch/);
 assert.match(terms,/BLACKFRIDAY15/);assert.match(terms,/15% off the merchandise subtotal/);
});
