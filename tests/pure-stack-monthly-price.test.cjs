'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const checkout=require('../lib/direct-checkout');
const card={kind:'hosted_link',id:'00000000-0000-4000-8000-000000000001',version:1,currency:'USD',native_provider:'rampex',rampex_provider:'hosted',sale_scope:'both'};
const crypto={...card,id:'00000000-0000-4000-8000-000000000002',native_provider:'polygon_usdc',rampex_provider:null};
const bank={...card,id:'00000000-0000-4000-8000-000000000003',kind:'bank_transfer',native_provider:null};
const products=[10001,20002,30003,40004].map((unit,index)=>({id:'compound-'+index,name:'Compound '+index,size:'5 mg',qty:1,unit_price_usd_cents:unit}));
function record(overrides={}){
 return {kind:'goods',request:{address:{country:'US'},bulk_order:false,items:products.map(x=>({...x})),
   checkout:{coupon:'',points:0,credit_cents:0,delivery:{shipping:'express',extras:[]}},...overrides}};
}
test('a paid month is priced from four exact SKU cents, with 40 percent per-item savings and no extra crypto discount',()=>{
 const q=checkout.price(record(),card,null,{points:0,credit_cents:0}),qc=checkout.price(record(),crypto,null,{points:0,credit_cents:0});
 const subtotal=products.reduce((sum,item)=>sum+item.unit_price_usd_cents,0);
 const discounts=products.map(item=>Math.floor(item.unit_price_usd_cents*4000/10000));
 assert.equal(q.subtotal_cents,subtotal);
 assert.equal(q.discount_cents,discounts.reduce((a,b)=>a+b,0));
 assert.equal(q.total_cents,subtotal-q.discount_cents);
 assert.equal(q.total_cents,qc.total_cents,'crypto cannot stack another percentage on the stack discount');
 assert.equal(q.shipping_cents,0);assert.equal(q.points_redeemed,0);assert.equal(q.credit_redeemed_cents,0);assert.equal(q.earned_points,0);
 assert.equal(q.pricing.billing_mode,'invoice_per_cycle');
 assert.equal(q.pricing.automatic_renewal,false);
 assert.equal(q.pricing.discount_source,'research_monthly');
 assert.deepEqual(q.pricing.lines.map(l=>l.discount_cents),discounts);
 assert.ok(q.pricing.lines.every(l=>l.discount_bps===4000&&l.discount_reason==='research_monthly'));
 assert.deepEqual(q.pricing.bundled_items,[{id:'gift-bac-3',name:'BAC Water',size:'3 mL',qty:1,unit_price_cents:0,line_total_cents:0}]);
 assert.equal(q.pricing.delivery.shipping_cents,0);
});
test('monthly invoice rejects a disallowed country, shipping, extras, discounts, items, and non-card non-crypto methods',()=>{
 for(const r of [
  record({address:{country:'CA'}}),
  record({checkout:{coupon:'BLACKFRIDAY15',points:0,credit_cents:0,delivery:{shipping:'express',extras:[]}}}),
  record({checkout:{coupon:'',points:100,credit_cents:0,delivery:{shipping:'express',extras:[]}}}),
  record({checkout:{coupon:'',points:0,credit_cents:100,delivery:{shipping:'express',extras:[]}}}),
  record({checkout:{coupon:'',points:0,credit_cents:0,delivery:{shipping:'standard',extras:[]}}}),
  record({checkout:{coupon:'',points:0,credit_cents:0,delivery:{shipping:'express',extras:['protection']}}}),
  record({items:[...products.slice(0,3),products[0]]}),
  record({items:products.map((x,i)=>i===0?{...x,qty:2}:x)}),
  record({bulk_order:true})
 ])assert.throws(()=>checkout.price(r,card,null,{points:0,credit_cents:0}),{name:'Error'});
 assert.throws(()=>checkout.price(record(),bank,null,{points:0,credit_cents:0}),{name:'Error'});
});
