'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {replay}=require('../lib/rewards-ledger');
const base={account_id:'customer-1',currency:'POINTS',reference:'order-001',created_at:'2026-11-09T12:00:00Z'};
const earn={...base,id:'event-001',kind:'earn',units:100};
test('empty reward ledger starts at zero and never authorizes redemption',()=>{
 assert.deepEqual(replay([],'customer-1','POINTS'),{valid:true,account_id:'customer-1',currency:'POINTS',balance:0,spendable:false});
});
test('earn, redeem and reversal replay with unique ids',()=>{
 const redeem={...base,id:'event-002',kind:'redeem',units:40};
 const reverse={...base,id:'event-003',kind:'reverse',units:40,reverses_id:'event-002'};
 assert.equal(replay([earn,redeem],'customer-1','POINTS').balance,60);
 assert.equal(replay([earn,redeem,reverse],'customer-1','POINTS').balance,100);
 assert.equal(replay([earn,earn],'customer-1','POINTS').valid,false);
 assert.equal(replay([earn,redeem,reverse,{...reverse,id:'event-004'}],'customer-1','POINTS').valid,false);
});
test('no negative balances, unknown reversals or cross-account spending',()=>{
 assert.equal(replay([{...earn,id:'event-002',kind:'redeem'}],'customer-1','POINTS').valid,false);
 assert.equal(replay([{...earn,id:'event-002',kind:'reverse',reverses_id:'unknown'}],'customer-1','POINTS').valid,false);
 assert.equal(replay([earn],'customer-2','POINTS').balance,0);
});
test('store credit uses separate USD cents ledger, not reward points',()=>{
 const credit={...earn,currency:'USD_CENTS',units:500};
 assert.equal(replay([credit],'customer-1','USD_CENTS').balance,500);
 assert.equal(replay([credit],'customer-1','POINTS').balance,0);
});
