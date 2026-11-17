'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
test('account navigation and checkout generators expose no membership or subscription offers',()=>{
 const account=fs.readFileSync('account.js','utf8'),nav=account.slice(account.indexOf('function accountNav'),account.indexOf('async function overview'));
 assert.doesNotMatch(nav,/membership|subscription|research.builder/i);
 for(const name of ['account-experience.js','conversion-ui.js','readiness-ui.js'])assert.doesNotMatch(fs.readFileSync(name,'utf8'),/href=["']\/memberships|\/checkout\?plan|Choose your membership|Choose a plan|5 points per \$1/i);
 const build=fs.readFileSync('account-experience-build.cjs','utf8');assert.doesNotMatch(build,/research-checkout-client\.js|AccountExperience\.membership/);
});
test('old account membership and subscription routes are redirected before account section rendering',()=>{
 const account=fs.readFileSync('account.js','utf8');assert.match(account,/\['\/account\/membership','\/account\/subscriptions'\]\.includes\(p\)\)return go\('\/account'\)/);
 const redirect=account.indexOf("includes(p))return go('/account')");assert.ok(redirect>=0&&redirect<account.indexOf("if(p==='/account/reset-password'"));
});
