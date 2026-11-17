'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
for(const params of ['?plan=vip','?plan=vip&period=annual','?plan=elite&period=monthly','?period=monthly'])test('retired checkout request '+params+' redirects before any quote or payment',async()=>{
 const redirects=[],requests=[];
 const context={window:{},document:{},Intl,URLSearchParams,location:{search:params,replace:url=>redirects.push(url)},fetch:async(...args)=>{requests.push(args);throw Error('No request expected');}};
 vm.createContext(context);
 vm.runInContext(fs.readFileSync('direct-checkout-client.js','utf8'),context);
 const original=context.window.DirectCheckout.checkout;
 await original({}, {}, {});
 assert.deepEqual(redirects,['/checkout']);assert.equal(requests.length,0);
 redirects.length=0;
 vm.runInContext(fs.readFileSync('checkout-reference.js','utf8'),context);
 await context.window.DirectCheckout.checkout({}, {}, {});
 assert.deepEqual(redirects,['/checkout']);assert.equal(requests.length,0);
});
test('retired Research Builder checkout redirects without network or form creation',()=>{
 const redirects=[],context={window:{},location:{replace:url=>redirects.push(url)}};vm.createContext(context);vm.runInContext(fs.readFileSync('research-checkout-client.js','utf8'),context);context.window.ResearchCheckout.render();assert.deepEqual(redirects,['/shop']);
});
