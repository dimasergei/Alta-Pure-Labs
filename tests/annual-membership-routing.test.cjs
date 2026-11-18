'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {JSDOM}=require('jsdom'),conversion=require('../config/conversion.json');
const directSource=fs.readFileSync('direct-checkout-client.js','utf8'),referenceSource=fs.readFileSync('checkout-reference.js','utf8');
const experienceSource=fs.readFileSync('membership-experience.js','utf8'),membershipSource=fs.readFileSync('membership-checkout.js','utf8');

test('both checkout layouts dispatch every paid membership term before reading the product cart or requesting a goods quote',async()=>{
 for(const params of ['?plan=vip','?plan=vip&period=annual','?plan=elite&period=monthly','?plan=elite&period=annual','?plan=vip&period=annual&bulk=1']){
  const calls=[],root={},auth={},user={},result={membership:true};
  const window={PureMembershipCheckout:{checkout:async(...args)=>{calls.push(args);return result;}}};
  Object.defineProperty(window,'AltaStore',{get(){throw Error('Membership route must preserve the product cart');}});
  const context={window,document:{},Intl,URLSearchParams,location:{search:params,replace(){throw Error('No retirement redirect expected');}},fetch(){throw Error('No goods quote or payment request expected');}};
  vm.createContext(context);vm.runInContext(directSource,context);assert.equal(await window.DirectCheckout.checkout(root,auth,user),result);
  vm.runInContext(referenceSource,context);assert.equal(await window.DirectCheckout.checkout(root,auth,user),result);
  assert.equal(calls.length,2);for(const args of calls)assert.deepEqual(args,[root,auth,user]);
 }
});

test('restored membership routes render the selected PURE tier and monthly or annual fee without quoting or creating a payment',async()=>{
 for(const [query,name,period,cents] of [['?plan=vip','PURE WHITE','monthly',1999],['?plan=vip&period=annual','PURE WHITE','annual',19190],['?plan=elite&period=monthly','PURE BLACK','monthly',9999],['?plan=elite&period=annual','PURE BLACK','annual',95990]]){
  const dom=new JSDOM('<main id="root"></main>',{url:'https://pure.example/checkout'+query,runScripts:'outside-only'}),w=dom.window,root=w.document.querySelector('main'),calls=[];
  try{w.localStorage.setItem('pp-cart','saved-product-cart');w.eval(directSource);
   w.DirectCheckout.api=async(auth,body)=>{calls.push(body);if(body)throw Error('No fee quote before review');return{config:{version:'checkout-2026-11-v8',shipping_countries:['US','CA']},terms:{conversion},methods:[]};};
   w.eval(experienceSource);w.eval(membershipSource);w.eval(referenceSource);await w.DirectCheckout.checkout(root,{}, {email:'member@example.test',user_metadata:{}});
   assert.equal(w.document.title,name+' Checkout | PURE');assert.equal(root.querySelector('[name="period"]:checked').value,period);
   assert.match(root.querySelector('[data-pm-term-price]').textContent,new RegExp((cents/100).toFixed(2).replace('.','\\.')));
   assert.equal(calls.length,1);assert.equal(calls[0],undefined);assert.equal(root.querySelector('[data-pm-place]'),null);assert.equal(w.localStorage.getItem('pp-cart'),'saved-product-cart');
  }finally{dom.window.close();}
 }
});

test('invalid plan and period routes fail with a recovery link instead of falling through to product checkout',async()=>{
 for(const query of ['?period=monthly','?plan=gold','?plan=','?plan=vip&period=weekly']){
  const dom=new JSDOM('<main id="root"></main>',{url:'https://pure.example/checkout'+query,runScripts:'outside-only'}),w=dom.window,root=w.document.querySelector('main'),calls=[];
  try{w.eval(directSource);w.DirectCheckout.api=async(auth,body)=>{calls.push(body);return{terms:{conversion}};};w.eval(membershipSource);w.eval(referenceSource);await w.DirectCheckout.checkout(root,{},{});
   assert.match(root.querySelector('[role="alert"]').textContent,/Choose a current PURE membership plan/);assert.ok(root.querySelector('a[href="/memberships"]'));
   assert.equal(root.querySelector('form'),null);assert.deepEqual(calls,[undefined]);
  }finally{dom.window.close();}
 }
});

test('ordinary empty-cart checkout remains in the product flow without invoking a membership or research purchase',async()=>{
 const dom=new JSDOM('<main id="root"></main>',{url:'https://pure.example/checkout',runScripts:'outside-only'}),w=dom.window,root=w.document.querySelector('main');
 try{w.AltaStore={cart:[]};w.PureMembershipCheckout={checkout(){throw Error('No membership route selected');}};w.eval(directSource);w.eval(referenceSource);await w.DirectCheckout.checkout(root,{},{});
  assert.match(root.textContent,/Your cart is empty/);assert.equal(root.querySelector('form'),null);
 }finally{dom.window.close();}
});
