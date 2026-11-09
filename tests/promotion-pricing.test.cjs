'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {quoteCart,validCart}=require('../lib/promotion-pricing');
const now=new Date('2026-11-09T12:00:00Z');
const cart=[{sku_key:'bpc-157-10mg',quantity:3,unit_price_cents:5100}];
const base={id:'test-promo',approved:true,enabled:true,starts_at:'2026-11-01T00:00:00Z',ends_at:'2026-12-01T00:00:00Z'};
test('no configured promotions means no discount and no checkout activation',()=>{
 assert.deepEqual(quoteCart(cart,[],now),{valid:true,currency:'USD',subtotal_cents:15300,discount_cents:0,total_before_shipping_tax_cents:15300,applied_rule_id:null,checkout_allowed:false});
});
test('percent, fixed and BOGO calculate deterministically',()=>{
 const percent={...base,type:'percent',percent_bps:1000};
 const fixed={...base,id:'fixed',type:'fixed',amount_cents:2000};
 const bogo={...base,id:'bogo',type:'buy_x_get_y',sku_key:'bpc-157-10mg',buy_qty:1,free_qty:1};
 assert.equal(quoteCart(cart,[percent],now).discount_cents,1530);
 assert.equal(quoteCart(cart,[fixed],now).discount_cents,2000);
 assert.equal(quoteCart(cart,[bogo],now).discount_cents,5100);
 assert.equal(quoteCart(cart,[percent,fixed,bogo],now).applied_rule_id,'bogo');
});
test('unapproved, disabled and expired promotions never discount',()=>{
 const rule={...base,type:'percent',percent_bps:5000};
 for(const x of [{approved:false},{enabled:false},{ends_at:'2026-11-01T00:00:00Z'},{percent_bps:20000}]){
  assert.equal(quoteCart(cart,[{...rule,...x}],now).discount_cents,0);
 }
});
test('invalid lines, duplicate SKU and negative values are rejected',()=>{
 assert.equal(validCart([...cart,...cart]),false);
 assert.equal(quoteCart([{...cart[0],unit_price_cents:-1}],[],now).valid,false);
 assert.equal(quoteCart([{...cart[0],quantity:0}],[],now).valid,false);
});
