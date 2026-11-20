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

test('US and Canada share the next-day rate while unsupported destinations remain unavailable',()=>{
 for(const country of ['US','CA']){
  const quote=delivery.price({shipping:'next_day',extras:['protection']},true,delivery.defaults,country);
  assert.equal(quote.shipping_cents,country==='US'?5995:6495);
  assert.equal(quote.extras_cents,500);
  assert.equal(quote.total_cents,country==='US'?6495:6995);
  assert.equal(quote.rate_version,'shipping-2026-11-v4');
  assert.deepEqual(quote.selection,{shipping:'next_day',extras:['protection']});
  assert.equal(delivery.price({shipping:'next_day',extras:[]},true,delivery.defaults,country).total_cents,country==='US'?5995:6495);
 }
 assert.throws(()=>delivery.price({shipping:'next_day',extras:[]},false,delivery.defaults,'GB'),/unavailable/);
});

test('protection is priced exactly as selected for US, Canadian and other supported deliveries',()=>{
 for(const country of ['US','CA','GB']){
  const base=delivery.price({shipping:'standard',extras:[]},false,delivery.defaults,country);
  const protectedQuote=delivery.price({shipping:'standard',extras:['protection']},false,delivery.defaults,country);
  assert.equal(protectedQuote.total_cents-base.total_cents,500);
  assert.equal(base.extras_cents,0,'An explicit opt-out may never be re-added by pricing');
 }
 const disabled=delivery.defaults.map(option=>option.id==='protection'?{...option,enabled:false}:option);
 assert.throws(()=>delivery.price({shipping:'standard',extras:['protection']},false,disabled,'CA'),/unavailable/);
});

test('US and Canada both qualify for free standard shipping at the same USD threshold',()=>{
 for(const country of ['US','CA']){
  assert.equal(delivery.price({shipping:'standard',extras:[]},true,delivery.defaults,country).shipping_cents,0);
  assert.equal(delivery.price({shipping:'standard',extras:[]},false,delivery.defaults,country).shipping_cents,country==='US'?1195:2495);
  assert.equal(delivery.price({shipping:'express',extras:[]},true,delivery.defaults,country).shipping_cents,country==='US'?2995:4995);
 }
 assert.equal(delivery.price({shipping:'standard',extras:[]},true,delivery.defaults,'GB').shipping_cents,4995);
});

test('Economy is the cheapest tracked shipping option in US and Canada',()=>{
 for(const [country,price] of [['US',795],['CA',1495]]){
  const basic=delivery.price({shipping:'economy',extras:[]},false,delivery.defaults,country);
  assert.equal(basic.shipping_cents,price);
  assert.ok(basic.shipping_cents<delivery.price({shipping:'standard',extras:[]},false,delivery.defaults,country).shipping_cents);
  assert.equal(delivery.price({shipping:'economy',extras:[]},true,delivery.defaults,country).shipping_cents,0);
 }
});
