'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {validLot,available,transition,reserve,releaseReservation,reconcile}=require('../lib/inventory-ledger');
const lot={id:'lot-001',sku_key:'bpc-157-10mg',supplier_id:'99-purity',fulfillment_site:'site-1',
 lot_number:'LOT-001',status:'quarantine',on_hand:20,reserved:0,damaged:0,evidence_reference:''};
test('unverified and quarantined lots never show available inventory',()=>{
 assert.equal(validLot(lot),true);
 assert.equal(available(lot),0);
 assert.deepEqual(reconcile([lot],lot.sku_key),{valid:true,sku_key:lot.sku_key,available_units:0,can_sell:false});
 assert.equal(reserve(lot,1).ok,false);
});
test('reviewed release is an internal simulation, not sales authorization',()=>{
 assert.equal(transition(lot,'released',{}).ok,false);
 const released=transition(lot,'released',{reviewer:'quality-lead',evidence_reference:'document-reviewed'});
 assert.equal(released.ok,true);
 assert.equal(available(released.lot),20);
 assert.equal(reconcile([released.lot],lot.sku_key).can_sell,false);
});
test('reservations cannot exceed stock and can be reversed',()=>{
 const released={...lot,status:'released',evidence_reference:'review-1',damaged:2};
 assert.equal(available(released),18);
 assert.equal(reserve(released,19).ok,false);
 const reserved=reserve(released,10);
 assert.equal(reserved.ok,true);
 assert.equal(available(reserved.lot),8);
 assert.equal(releaseReservation(reserved.lot,11).ok,false);
 assert.equal(releaseReservation(reserved.lot,10).lot.reserved,0);
});
test('recalls are terminal and recalled stock is unavailable',()=>{
 const released={...lot,status:'released',evidence_reference:'review-1'};
 const recalled=transition(released,'recalled',{reviewer:'quality-lead',evidence_reference:'recall-1'});
 assert.equal(recalled.ok,true);
 assert.equal(available(recalled.lot),0);
 assert.equal(transition(recalled.lot,'released',{reviewer:'quality-lead',evidence_reference:'recheck'}).ok,false);
});
test('invalid and duplicate lots fail closed',()=>{
 assert.equal(validLot({...lot,reserved:21}),false);
 assert.equal(reconcile([lot,lot],lot.sku_key).valid,false);
 assert.equal(reconcile([{...lot,on_hand:-1}],lot.sku_key).valid,false);
});
