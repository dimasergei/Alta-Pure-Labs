'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {applyPromotions}=require('../lib/checkout-promotions'),base=require('../lib/manual-commerce');
const line=qty=>({id:'sample',name:'Sample',size:'5mg',qty,unit_price_usd_cents:4800});
test('one, two and four purchased units retain exact fulfillment quantity at regular prices',()=>{
 for(const qty of [1,2,4]){const quote=applyPromotions(base.priceLines([line(qty)]),'goods','');assert.equal(quote.lines[0].qty,qty);assert.equal(quote.lines[0].bogo_free_units,0);assert.equal(quote.lines[0].line_total_cents,qty*4800);assert.equal(quote.discount_cents,0);}
});
test('explicit BLACKFRIDAY15 changes price by 15%, never purchased or fulfillment quantity',()=>{
 for(const qty of [1,2,4]){const quote=applyPromotions(base.priceLines([line(qty)]),'goods','BLACKFRIDAY15');assert.equal(quote.lines[0].qty,qty);assert.equal(quote.lines[0].bogo_free_units,0);assert.equal(quote.lines[0].line_total_cents,qty*4800-Math.floor(qty*4800*.15));assert.equal(quote.coupon_code,'BLACKFRIDAY15');}
});
test('active cart and checkout never expand purchased quantity or manufacture free-unit badges',()=>{
 for(const name of ['cart-reference.js','checkout-reference.js','direct-checkout-client.js']){const source=fs.readFileSync(name,'utf8');assert.doesNotMatch(source,/qty\s*\*\s*2|promoActive|quotedFreeUnits|bogo-free|additional free/);assert.match(source,/\{id,size,qty\}/);}
 assert.doesNotMatch(fs.readFileSync('conversion-build.cjs','utf8'),/renderCart=|membershipCards=/,'Later build stage must not override the regular cart');
});
