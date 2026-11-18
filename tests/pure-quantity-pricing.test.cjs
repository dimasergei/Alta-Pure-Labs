'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const tiers=require('../quantity-pricing');
const membership=require('../lib/membership-benefits');
const payment=require('../lib/pure-payment-policy');
const manual=require('../lib/manual-commerce');
const line=(qty,id='fixture')=>({id,name:'Fixture product',size:'5mg',qty,unit_price_usd_cents:5000});
const quote=(lines,coupon='',member=null)=>membership.apply(manual.priceLines(lines),member,coupon);
test('PURE 1 / 2 / 5 / 10 quantity pricing uses canonical USD cents, not a modified unit price',()=>{
 for(const [qty,bps,discount,total] of [[1,0,0,5000],[2,500,500,9500],[5,1000,2500,22500],[10,2000,10000,40000],[15,2000,15000,60000]]){
  assert.equal(tiers.basisPoints(qty),bps);
  assert.equal(tiers.discountCents(5000,qty),discount);
  assert.equal(tiers.totalCents(5000,qty),total);
  const p=quote([line(qty)]);
  assert.equal(p.lines[0].qty,qty);assert.equal(p.lines[0].unit_price_cents,5000);
  assert.equal(p.discount_cents,discount);assert.equal(p.subtotal_cents-p.discount_cents,total);
 }
});
test('coupon and membership compete per line with quantity tiers; only best merchandise offer wins',()=>{
 const mixed=quote([line(2,'a'),line(5,'b'),line(10,'c')],'BLACKFRIDAY15');
 assert.deepEqual(mixed.lines.map(x=>x.discount_reason),['coupon_blackfriday15','coupon_blackfriday15','quantity_10']);
 assert.equal(mixed.coupon_discount_cents,1500+3750);
 assert.equal(mixed.quantity_discount_cents,10000);
 assert.equal(mixed.discount_cents,15250);
 assert.equal(mixed.quantity_discount_version,tiers.VERSION);
 const black=quote([line(2,'a'),line(5,'b'),line(10,'c')],'',{plan:'elite'});
 assert.deepEqual(black.lines.map(x=>x.discount_reason),['membership_elite','membership_elite','quantity_10']);
 assert.equal(black.membership_discount_cents,1000+2500);
 assert.equal(black.quantity_discount_cents,10000);
});
test('Crypto incentive applies to the already discounted merchandise, not the gross price',()=>{
 const p=quote([line(10)]);
 const crypto=payment.applyDiscount(p,{native_provider:'polygon_usdc',kind:'hosted_link'},{suppressForBalance:false});
 assert.equal(crypto.quantity_discount_cents,10000);
 assert.equal(crypto.crypto_discount_cents,2000);
 assert.equal(crypto.discount_cents,12000);
 assert.equal(crypto.lines[0].line_total_cents,38000);
 assert.equal(crypto.discount_source,'quantity_crypto');
});
