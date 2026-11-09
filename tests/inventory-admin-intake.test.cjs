'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const { catalogSkuKeys }=require('../lib/catalog-sku-keys');
const { inventoryIntake }=require('../lib/inventory-admin-intake');
const supplier='10000000-0000-4000-8000-000000000001';
const row={supplier_id:supplier,sku_key:'bpc-157-10mg',lot_number:'VERIFIED-LOT-01',
 fulfillment_site:'supplier-warehouse',on_hand:10,supplier_evidence_reference:'supplier-document-001',
 composition_confirmed:true,strength_confirmed:true};
function mockDb({duplicate=false}={}){
 const state={writes:[],reads:0};
 const db={from(table){
  if(table==='suppliers')return{select(){return{eq(){return{limit:async()=>{state.reads++;return{data:[{id:supplier}],error:null};}};}};}};
  if(table==='enterprise_inventory_lots')return{insert(payload){
   state.writes.push(payload);
   return{select(){return{single:async()=>duplicate?
    {data:null,error:{code:'23505'}}:
    {data:{id:'fixture-lot',sku_key:payload.sku_key,lot_number:payload.lot_number,status:payload.status},error:null}};}};}};
  throw Error('Unexpected table '+table);
 }};
 return{db,state};
}
test('real catalog yields 84 unique server-side keys',()=>{
 const keys=catalogSkuKeys();
 assert.equal(keys.length,84);
 assert.equal(new Set(keys).size,84);
 assert.ok(keys.includes('bpc-157-10mg'));
});
test('preview never writes; actual import only writes quarantine status',async()=>{
 const {db,state}=mockDb();
 const preview=await inventoryIntake(db,[row],false);
 assert.equal(preview.valid,true);assert.equal(preview.saved,false);
 assert.equal(state.writes.length,0);
 const saved=await inventoryIntake(db,[row],true);
 assert.equal(saved.saved,true);
 assert.equal(saved.can_sell,false);
 assert.equal(state.writes.length,1);
 assert.equal(state.writes[0].status,'quarantine');
 assert.equal(state.writes[0].reviewed_by,null);
 assert.equal(state.writes[0].reserved,0);
});
test('invalid SKU and duplicate lot fail without claiming success',async()=>{
 const {db,state}=mockDb();
 const invalid=await inventoryIntake(db,[{...row,sku_key:'unlisted-sku'}],true);
 assert.equal(invalid.saved,false);assert.equal(state.writes.length,0);
 const dupe=await inventoryIntake(mockDb({duplicate:true}).db,[row],true);
 assert.equal(dupe.saved,false);assert.equal(dupe.error,'DUPLICATE_LOT');
});
test('multi-lot submissions are rejected before database reads or writes',async()=>{
 const {db,state}=mockDb();
 const result=await inventoryIntake(db,[row,row],true);
 assert.equal(result.valid,false);assert.equal(state.reads,0);
 assert.equal(state.writes.length,0);
});
