'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {normalizeInventoryIntake}=require('../lib/inventory-intake');
const supplier='10000000-0000-4000-8000-000000000001';
const context={supplierIds:[supplier],catalogSkuKeys:['bpc-157-10mg']};
const row={
 supplier_id:supplier,sku_key:'bpc-157-10mg',lot_number:'LOT-001',
 fulfillment_site:'verified-warehouse',on_hand:10,
 supplier_evidence_reference:'supplier-confirmation-001',
 composition_confirmed:true,strength_confirmed:true
};
test('verified exact SKU intake defaults to quarantine and cannot authorize sale',()=>{
 const r=normalizeInventoryIntake([row],context);
 assert.equal(r.valid,true);
 assert.equal(r.accepted[0].status,'quarantine');
 assert.equal(r.accepted[0].reserved,0);
 assert.equal(r.accepted[0].reviewed_by,null);
 assert.equal(r.accepted[0].publication_approved,undefined);
});
test('reject unknown supplier, unknown SKU, unsupported formulation and missing evidence',()=>{
 for(const change of [
  {supplier_id:'20000000-0000-4000-8000-000000000001'},
  {sku_key:'retatrutide-10mg'},
  {composition_confirmed:false},{strength_confirmed:false},
  {supplier_evidence_reference:''},{lot_number:''},{on_hand:-1},{on_hand:1.5}
 ]){
  const r=normalizeInventoryIntake([{...row,...change}],context);
  assert.equal(r.valid,false,JSON.stringify(change));
  assert.equal(r.accepted.length,0);
 }
});
test('duplicate lots and invalid batch sizes are rejected',()=>{
 const r=normalizeInventoryIntake([row,row],context);
 assert.equal(r.valid,false);
 assert.equal(r.accepted.length,1);
 assert.equal(r.rejected[0].reason,'DUPLICATE_LOT');
 assert.equal(normalizeInventoryIntake([],context).valid,false);
 assert.equal(normalizeInventoryIntake(Array(501).fill(row),context).valid,false);
});
test('unexpected source fields cannot set quality release, price or customer-facing claims',()=>{
 const r=normalizeInventoryIntake([{...row,status:'released',reviewed_by:'attacker',
  unit_price_cents:0,publication_approved:true}],context);
 assert.equal(r.valid,true);
 assert.equal(r.accepted[0].status,'quarantine');
 assert.equal(r.accepted[0].reviewed_by,null);
 assert.equal(r.accepted[0].unit_price_cents,undefined);
});
