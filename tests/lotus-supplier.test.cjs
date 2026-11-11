const test=require('node:test'),assert=require('node:assert/strict'),lotus=require('../lib/lotus-supplier');
test('supplier defaults off and never treats a label or shopper-paid status as shipment',()=>{
 assert.deepEqual(lotus.configuration({}),{configured:false,mode:null});
 assert.equal(lotus.shipment({status:'paid',tracking_number:'label-only'}),null);
 assert.equal(lotus.shipment({status:'shipped',tracking_number:'tracking'}),null);
 assert.equal(lotus.shipment({status:'shipped',tracking_number:'tracking',shipped_at:'2026-11-11',carrier:'USPS'}).carrier,'USPS');
});
test('supplier pack mapping never rounds down, guesses a SKU or ignores free BOGO units',()=>{
 const mapping={'fixture|5mg':{product:99,vials:2}};
 assert.deepEqual(lotus.linesFor([{id:'fixture',size:'5mg',qty:4}],mapping),[{product:99,vials:2,quantity:2}]);
 assert.throws(()=>lotus.linesFor([{id:'fixture',size:'5mg',qty:3}],mapping));
 assert.throws(()=>lotus.linesFor([{id:'fixture',size:'10mg',qty:2}],mapping));
});
test('supplier cannot create live obligations through the read/quote adapter',async()=>{
 let called=false;
 await assert.rejects(lotus.request('/orders',{}, {env:{LOTUS_PARTNER_API_KEY:'ptr_live_'+'A'.repeat(43)},fetchImpl:async()=>{called=true;}}),/Only catalog/);
 assert.equal(called,false);
});
