'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
test('membership preview makes no billing promises and has no payment forms',()=>{
 const html=fs.readFileSync(path.join(root,'memberships.html'),'utf8');
 assert.match(html,/not yet open for enrollment/);
 assert.match(html,/Enrollment unavailable/);
 assert.match(html,/No paid membership, recurring billing, rewards balance, store credit/);
 assert.match(html,/href="\/styles\.css"/);
 assert.doesNotMatch(html,/<form\b|stripe|subscription-checkout|\/api\/checkout/i);
});
test('membership preview linked from existing storefront footer',()=>{
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 assert.match(html,/href="\/memberships\.html"/);
});
