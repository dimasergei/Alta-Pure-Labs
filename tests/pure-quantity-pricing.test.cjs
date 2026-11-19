'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const tiers=require('../quantity-pricing'),membership=require('../lib/membership-benefits');
const payment=require('../lib/pure-payment-policy'),manual=require('../lib/manual-commerce');
const line=(qty,id='fixture')=>({id,name:'Fixture product',size:'5mg',qty,unit_price_usd_cents:5000});
const quote=(lines,coupon='',member=null)=>membership.apply(manual.priceLines(lines),member,coupon);

test('regular product quantities 1, 2, 5, 10 and 50 never receive automatic quantity discounts',()=>{
 for(const qty of [1,2,5,10,15,50,100]){
  assert.equal(tiers.basisPoints(qty),0);
  assert.equal(tiers.discountCents(5000,qty),0);
  assert.equal(tiers.totalCents(5000,qty),5000*qty);
  const p=quote([line(qty)]);
  assert.equal(p.lines[0].qty,qty);assert.equal(p.lines[0].unit_price_cents,5000);
  assert.equal(p.discount_cents,0);assert.equal(p.total_cents,undefined);
  assert.equal(p.quantity_discount_version,undefined);
 }
});

test('only total BULK unit count unlocks 20% at ten and 50% at fifty',()=>{
 for(const [units,rate] of [[0,0],[1,0],[9,0],[10,2000],[12,2000],[49,2000],[50,5000],[60,5000],[100,5000]]){
  assert.equal(tiers.bulkRate(units),rate);
  assert.equal(tiers.bulkDiscountCents(20001,units),Math.round(20001*rate/10000));
 }
 assert.equal(tiers.VERSION,'pure-bulk-2026-11-v1');
 assert.throws(()=>tiers.bulkRate(-1),/Invalid/);
});
test('normal coupon and membership savings still apply, without quantity tiers',()=>{
 const c=quote([line(2,'a'),line(5,'b'),line(10,'c')],'BLACKFRIDAY15');
 assert.equal(c.discount_cents,Math.round(17*5000*.15));
 assert.ok(c.lines.every(x=>x.discount_reason==='coupon_blackfriday15'));
 const black=quote([line(2,'a'),line(5,'b'),line(10,'c')],'',{plan:'elite'});
 assert.equal(black.discount_cents,17*500);
 assert.ok(black.lines.every(x=>x.discount_reason==='membership_elite'));
});
test('Crypto incentive remains applicable on ordinary merchandise but can be excluded on volume-qualified bulk',()=>{
 const normal=payment.applyDiscount(quote([line(10)]),{native_provider:'polygon_usdc',kind:'hosted_link'});
 assert.equal(normal.crypto_discount_cents,2500);
 const bulk=payment.applyDiscount(quote([line(10)]),{native_provider:'polygon_usdc',kind:'hosted_link'},{excludeBulk:true});
 assert.equal(bulk.crypto_discount_cents,0);assert.equal(bulk.crypto_discount_eligible,false);
});
