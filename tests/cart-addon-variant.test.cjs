'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const cart=fs.readFileSync('cart-reference.js','utf8');
const store=fs.readFileSync('storefront-v2.js','utf8');
test('recommended ADD MORE passes both valid catalog product and variant size to storefront',()=>{
 assert.match(cart,/data-action="add" data-id="'\+html\(p\.id\)\+'" data-size="'\+html\(v\.size\)\+'/);
 assert.match(store,/addItems\(\[\{id,size:button\.dataset\.size,qty\}\]\)/);
 assert.match(cart,/const v=p\.variants\[0\]/);
});
