'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {SUPPLIERS,validOffer,totalCost,compareOffers}=require('../lib/supplier-offers');
const offer={
 supplier_id:'99-purity',supplier_sku:'BPC10',catalog_sku_key:'bpc-157-10mg',
 state:'verified',currency:'USD',unit_cost_cents:2000,handling_cents:300,
 shipping_cents:1200,minimum_quantity:1,composition_confirmed:true,
 strength_confirmed:true,evidence_reference:'supplier-contract-2026'
};
test('all three established suppliers have stable IDs',()=>assert.deepEqual(SUPPLIERS,['99-purity','your-peptide-brand','peptidedropship']));
test('validated exact offers compare by total known cost, not membership-only or vial-only price',()=>{
 const other={...offer,supplier_id:'peptidedropship',supplier_sku:'BPC10-P',unit_cost_cents:1500,handling_cents:1500,shipping_cents:1200};
 const ranked=compareOffers([other,offer],{catalogSkuKey:'bpc-157-10mg',quantity:2});
 assert.equal(ranked.length,2);
 assert.equal(ranked[0].supplier_id,'99-purity');
 assert.equal(ranked[0].total_cost_cents,5500);
 assert.equal(ranked[1].total_cost_cents,5700);
});
test('missing/unknown pricing, incorrect SKU and unverified formulation never become routable',()=>{
 for(const change of [{state:'unverified'},{composition_confirmed:false},{strength_confirmed:false}]){
  const result=compareOffers([{...offer,...change}],{catalogSkuKey:'bpc-157-10mg'});
  assert.equal(result[0].eligibleForReview,false);
 }
 for(const change of [{shipping_cents:null},{unit_cost_cents:-1},{minimum_quantity:0},{currency:'EUR'}])assert.equal(validOffer({...offer,...change}),false);
 assert.deepEqual(compareOffers([offer],{catalogSkuKey:'retatrutide-10mg'}),[]);
});
test('minimum quantity and numeric bounds enforced without order creation',()=>{
 assert.equal(totalCost({...offer,minimum_quantity:10},1),null);
 assert.equal(totalCost({...offer,minimum_quantity:10},10),21500);
 assert.equal(totalCost(offer,0),null);
 assert.equal(totalCost(offer,100001),null);
});
