'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {applyPromotions}=require('../lib/checkout-promotions');
const base=require('../lib/manual-commerce');
const checkout=fs.readFileSync('checkout-reference.js','utf8');
const cart=fs.readFileSync('cart-reference.js','utf8');
const conversion=fs.readFileSync('conversion-build.cjs','utf8');
const line=qty=>({id:'sample',name:'Sample',size:'5mg',qty,unit_price_usd_cents:4800});
test('checkout quotes purchased units plus equal matching free units',()=>{
 assert.match(checkout,/qty:promoActive\(\)\?qty\*2:qty/);
 assert.equal((checkout.match(/items:checkoutItems\(\)/g)||[]).length,2);
 assert.match(checkout,/row\.qty===\(promoActive\(\)\?line\.qty\*2:line\.qty\)/);
 assert.match(cart,/settings\.config\.promotions\.bogo\?qty\*2:qty/);
});
test('buy 1 get 1, buy 2 get 2, and buy 4 get 4 persist real fulfillment quantities',()=>{
 for(const paidQty of [1,2,4]){
  const quote=applyPromotions(base.priceLines([line(paidQty*2)]),'goods','BOGO');
  assert.equal(quote.lines[0].qty,paidQty*2);
  assert.equal(quote.lines[0].bogo_free_units,paidQty);
  assert.equal(quote.lines[0].line_total_cents,Math.floor(paidQty*4800*.9));
 }
});
test('cart prices do not silently apply a second BOGO discount',()=>{
 assert.ok(conversion.includes('x.qty*x.price'));
 assert.ok(!conversion.includes('Math.ceil(x.qty/2)*x.price'));
 assert.match(checkout,/const includedGifts=/);
 assert.match(checkout,/subtotal-includedGifts/);
 assert.match(checkout,/const free=promoActive\(\)\?quotedFreeUnits\(x\):0/);
});
