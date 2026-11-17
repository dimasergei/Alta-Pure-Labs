'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const handler = require('../lib/research-builder-handler');

const lines = ['retatrutide','tirzepatide','semaglutide','tb-500'].map(id=>({id,size:id==='tb-500'?'5mg':'10mg',qty:1}));

test('retired checkout redirects both saved-draft and empty visitors without quotes, enrollment or cart changes',async()=>{
 const vm=require('node:vm');
 for(const saved of [null,JSON.stringify({lines})]){
  const redirects=[],storage=new Map([['pp-cart','existing-regular-cart'],['ap-research-builder-v2',saved]]);
  const context={window:{},location:{replace:url=>redirects.push(url)},localStorage:{getItem:key=>storage.get(key)},fetch:()=>{throw Error('No quote or enrollment request expected');}};
  vm.createContext(context);vm.runInContext(fs.readFileSync('research-checkout-client.js','utf8'),context);
  await context.window.ResearchCheckout.render();assert.deepEqual(redirects,['/shop']);assert.equal(storage.get('pp-cart'),'existing-regular-cart');assert.equal(storage.get('ap-research-builder-v2'),saved);
 }
});

test('subscription account records require an authenticated verified user',async()=>{
  const response={code:0,setHeader(){},status(code){this.code=code;return this;},json(payload){this.payload=payload;return this;}};
  await handler({method:'GET',query:{scope:'mine'},headers:{}},response);
  assert.equal(response.code,401);
});
