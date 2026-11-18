"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const checkout=require('../config/checkout.json'),plans=require('../config/conversion.json').plans;
test('published shipping terms match current standard pricing and the after-coupon free-shipping threshold',()=>{
 const policy=fs.readFileSync('shipping-policy.html','utf8'),terms=fs.readFileSync('commercial-terms.html','utf8'),builder=fs.readFileSync('manual-policy-build.cjs','utf8');
 assert.equal(checkout.free_shipping_threshold_cents,15000);
 for(const [name,text]of Object.entries({policy,terms,builder})){
  assert.match(text,/US\$150/,name);assert.match(text,/after any coupon/,name);assert.match(text,/US\$14\.95/,name);
  assert.doesNotMatch(text,/US\$25|US\$250|US\$299|International checkout is unavailable|US delivery only|annual passes/i,name);
 }
 assert.match(policy,/international services and rates/i);assert.match(policy,/Tracking is added to your order after dispatch/);
 assert.match(terms,/BLACKFRIDAY15/);assert.match(terms,/15% off the merchandise subtotal/);
 assert.match(terms,/PURE WHITE and PURE BLACK memberships include standard or express shipping to US addresses/);
 for(const key of ['vip','elite'])assert.ok(terms.includes(plans[key].name+' earns '+plans[key].points_per_dollar+' points per US$1'));
 assert.ok(terms.includes('PURE BLACK receives US$'+plans.elite.monthly_credit_cents/100+' store credit'));
 assert.match(terms,/at most once per UTC calendar month/);assert.match(terms,/USD points and store credit cannot be redeemed against a CAD payment or a membership fee/);
 assert.doesNotMatch(terms,/New orders do not earn points|Store credit is issued explicitly by staff/);
});
