'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const account=fs.readFileSync(path.join(root,'account.js'),'utf8');
const storefront=fs.readFileSync(path.join(root,'index.html'),'utf8');

test('tracking route requires authentication and preserves return URL',()=>{
 assert.match(account,/if\(p==='\/account\/tracking'\)\{if\(!user\)return go\('\/account\/login\?returnTo=%2Faccount%2Ftracking'\);return tracking\(\);\}/);
 assert.match(account,/\['Tracking','\/account\/tracking'\]/);
});
test('tracking searches only existing authenticated customer API data',()=>{
 assert.match(account,/async function tracking\(\)/);
 assert.match(account,/const data=await api\(\)/);
 assert.match(account,/const matches=ordersList\.filter/);
 assert.match(account,/matches\.map\(card\)/);
 assert.doesNotMatch(account,/\/api\/tracking\?order|fetch\(.*tracking_number/);
});
test('public storefront links to account tracking without anonymous lookup',()=>{
 assert.match(storefront,/href="\/account\/tracking"/);
 assert.doesNotMatch(storefront,/href="\/track-order\?email=/);
});
