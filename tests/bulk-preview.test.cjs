'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
test('bulk preview has no checkout, supplier order or payment endpoint',()=>{
 const js=fs.readFileSync(path.join(root,'bulk-preview.js'),'utf8');
 const html=fs.readFileSync(path.join(root,'bulk-orders.html'),'utf8');
 assert.match(html,/No orders can be placed here/);
 assert.match(html,/No bulk discounts, taxes, shipping, duties or payment fees/);
 assert.match(html,/href="\/styles\.css"/);
 assert.match(js,/Number\.isSafeInteger/);
 assert.match(js,/worksheet\.set/);
 assert.doesNotMatch(js,/\bfetch\s*\(/);
 assert.doesNotMatch(js,/location\.assign|window\.open|innerHTML\s*=/);
 assert.doesNotMatch(html,/action="\/api\/checkout"|checkout\.stripe\.com/);
});
test('existing storefront includes bulk worksheet link without changing cart',()=>{
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 assert.match(html,/href="\/bulk-orders\.html"/);
 assert.match(html,/id="cart-dialog"/);
});
