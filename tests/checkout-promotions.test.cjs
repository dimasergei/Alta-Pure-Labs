'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const base=require('../lib/manual-commerce');
const {normalizeCoupon,applyPromotions}=require('../lib/checkout-promotions');
const {applyBankDiscount}=require('../lib/bank-transfer-discount');
const line=(qty=2,price=1999,size='5mg')=>({id:'sample',name:'Sample',size,qty,unit_price_usd_cents:price});
test('regular catalog quantity is charged without automatic discounts or free units',()=>{
 for(const plan of ['member','vip','elite'])for(const qty of [1,2,4,10,25,50,100]){
  const p=applyPromotions(base.priceLines([line(qty)],plan),'goods');
  assert.equal(p.subtotal_cents,qty*1999);assert.equal(p.discount_cents,0);
  assert.equal(p.lines[0].qty,qty);assert.equal(p.lines[0].line_total_cents,qty*1999);assert.equal(p.bogo_free_units,0);
 }
});
test('BLACKFRIDAY15 discounts each purchased line by 15 percent with exact order rounding and deterministic line allocation',()=>{
 const p=applyPromotions(base.priceLines([line(2),line(1,3001,'10mg')]),'goods','blackfriday15');
 assert.equal(p.subtotal_cents,6999);assert.equal(p.discount_cents,1050);
 assert.deepEqual(p.lines.map(x=>x.coupon_discount_cents),[600,450]);
 assert.deepEqual(p.lines.map(x=>x.qty),[2,1]);assert.equal(p.coupon_code,'BLACKFRIDAY15');
 assert.equal(p.bogo_free_units,0);assert.ok(p.lines.every(x=>x.discount_bps===1500&&x.discount_reason==='coupon_blackfriday15'));
 const before=structuredClone(p);applyBankDiscount(p,{kind:'bank_transfer',active:true},'goods');assert.deepEqual(p,before);
});
test('removing a coupon restores regular catalog prices',()=>{
 const p=applyPromotions(base.priceLines([line(3)]),'goods','BLACKFRIDAY15');
 assert.equal(p.discount_cents,900);applyPromotions(p,'goods','');
 assert.equal(p.discount_cents,0);assert.equal(p.coupon_discount_cents,0);assert.equal(p.coupon_code,'');
 assert.equal(p.lines[0].line_total_cents,5997);assert.equal(p.lines[0].discount_reason,'none');
});
test('all permitted quantities have exact nonnegative totals without fulfillment inflation',()=>{
 for(let qty=1;qty<=100;qty++){
  const p=applyPromotions(base.priceLines([line(qty)],'elite'),'goods','BLACKFRIDAY15');
  assert.equal(p.discount_cents,Math.round(qty*1999*1500/10000));assert.equal(p.lines[0].qty,qty);
  assert.equal(p.lines[0].bogo_free_units,0);assert.equal(p.lines[0].line_total_cents,p.subtotal_cents-p.discount_cents);
 }
});
test('only BLACKFRIDAY15 is redeemable and membership purchases are unavailable',()=>{
 assert.equal(normalizeCoupon(' BlackFriday15 '),'BLACKFRIDAY15');assert.equal(normalizeCoupon(undefined),'');
 assert.equal(normalizeCoupon('  '),'');
 for(const value of ['BOGO','FREE','AP-ABCDEFGH2345','BLACKFRIDAY10',{},true,15,'x'.repeat(41)])assert.throws(()=>normalizeCoupon(value),e=>e.status===400);
 assert.throws(()=>applyPromotions(base.priceLines([line()]),'membership','BLACKFRIDAY15'),e=>e.status===409);
});
