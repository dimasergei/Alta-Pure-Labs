'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {spawnSync}=require('node:child_process');
const {JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'..'),read=file=>fs.readFileSync(path.join(root,file),'utf8');
test('generated account navigation includes membership and research plans with the current route selected',()=>{
 const build=read('account-experience-build.cjs'),match=build.match(/`(function accountNav\(active\)\{[\s\S]*?\n)`\+s\.slice\(end\)/);
 assert.ok(match,'Account build exposes the generated navigation function.');
 for(const route of ['/account/membership','/account/subscriptions']){
  const context={};vm.createContext(context);vm.runInContext(match[1]+'\nglobalThis.output=accountNav('+JSON.stringify(route)+');',context);
  const dom=new JSDOM(context.output),d=dom.window.document;
  assert.equal(d.querySelectorAll('a[href="/account/membership"]').length,1);
  assert.equal(d.querySelectorAll('a[href="/account/subscriptions"]').length,1);
  assert.equal(d.querySelector('a[aria-current="page"]').getAttribute('href'),route);
  assert.equal(d.querySelectorAll('#logout').length,1);
  dom.window.close();
 }
 const conversion=read('conversion-build.cjs');
 assert.match(conversion,/path==='\/account\/membership'\)return window\.ConversionUI\.mountMembership\(root,auth\)/);
 assert.match(conversion,/path==='\/account\/subscriptions'\)return window\.ConversionUI\.subscriptions\(root,auth\)/);
 for(const name of ['membership-experience.js','membership-checkout.js','research-builder-client.js','research-checkout-client.js'])assert.ok(conversion.includes(name),name+' is published');
});
test('site generation removes retired account redirects and restores authenticated program panels',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'pure-membership-routing-'));
 try{
  for(const file of ['site-build.cjs','products.js','account.html','account.js'])fs.copyFileSync(path.join(root,file),path.join(temp,file));
  const run=spawnSync(process.execPath,['site-build.cjs'],{cwd:temp,encoding:'utf8'});assert.equal(run.status,0,run.stderr);
  const account=fs.readFileSync(path.join(temp,'account.js'),'utf8');
  assert.doesNotMatch(account,/\['\/account\/membership','\/account\/subscriptions'\]\.includes\(p\)\)return go\('\/account'\)/);
  assert.doesNotMatch(account,/p==='\/research-builder'[^;]*return go\('\/shop'\)/);
  assert.match(account,/\['\/account\/points','\/account\/store-credit','\/account\/partner','\/account\/membership','\/account\/subscriptions'\]\.includes\(p\)\)\{if\(!user\)return go\('\/account\/login\?returnTo='\+encodeURIComponent\(p\+location\.search\)\);return placeholder\(p\)/);
  assert.match(account,/window\.AltaWorkspace\.renderAccountPanel\(path,document\.getElementById\('ap-account-panel'\),auth,user\)/);
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
test('restored paid tiers are prepaid and monthly builder billing remains explicitly unavailable',()=>{
 const config=JSON.parse(read('config/conversion.json')),checkout=JSON.parse(read('config/checkout.json'));
 assert.equal(config.memberships_enabled,true);assert.equal(config.billing_mode,'prepaid');assert.equal(config.automatic_renewal,false);assert.equal(config.recurring_available,false);
 assert.equal(config.plans.vip.name,'PURE WHITE');assert.equal(config.plans.elite.name,'PURE BLACK');
 assert.equal(checkout.promotions.bogo,false);
 const pricing=require('../lib/research-builder-pricing');assert.equal(pricing.terms.one_time_available,true);assert.equal(pricing.terms.subscription_available,false);
 assert.match(read('conversion-ui.js'),/request\('checkout=account',null,auth\)/);
 assert.match(read('conversion-ui.js'),/request\('research_builder=1&scope=mine',null,auth\)/);
 assert.doesNotMatch(read('conversion-ui.js'),/user_metadata\?\.(points|store_credit|rewards|membership)/);
});
