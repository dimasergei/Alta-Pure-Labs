'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const delivery=require('../lib/delivery-options');

test('Cold Chain cannot be selected or charged at checkout',async()=>{
 assert.equal(delivery.defaults.some(option=>option.id==='cold_chain'),false);
 assert.throws(()=>delivery.selection({shipping:'standard',extras:['cold_chain']}),/Review the delivery options/);
 assert.throws(()=>delivery.price({shipping:'standard',extras:['cold_chain']},false),/Review the delivery options/);
 const database={from(){return{select:async()=>({data:[...delivery.defaults,{id:'cold_chain',enabled:true,price_cents:999}],error:null})}}};
 const available=await delivery.load(database);
 assert.equal(available.some(option=>option.id==='cold_chain'),false);
 assert.deepEqual(delivery.selection({shipping:'standard',extras:['priority','protection']}).extras,['priority','protection']);
});
