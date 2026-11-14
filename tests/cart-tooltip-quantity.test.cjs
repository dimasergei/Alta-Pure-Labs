'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const css=fs.readFileSync('cart-reference.css','utf8');
test('gift tooltip opens below the icon instead of clipping above cart header',()=>{
 assert.match(css,/\.nlc-gift-tip\{top:calc\(100% \+ 11px\)!important;bottom:auto!important/);
 assert.match(css,/\.nlc-gift-two \.nlc-gift-tip/);
 assert.match(css,/\.nlc-scrollable-items\{overflow-x:hidden/);
});
test('quantity control uses one capsule with connected pale buttons and white center',()=>{
 assert.match(css,/\.nlc-quantity-row \.ap-quantity\{display:grid!important/);
 assert.match(css,/grid-template-columns:49px 57px 49px!important/);
 assert.match(css,/border-radius:25px!important/);
 assert.match(css,/\.nlc-quantity-row \.ap-quantity input\{[^}]*background:#fff!important/s);
});
