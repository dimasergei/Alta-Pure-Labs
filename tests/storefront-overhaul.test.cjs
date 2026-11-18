'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const vm=require('node:vm');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
test('new storefront scripts parse without errors',()=>{for(const file of ['storefront-v2.js','workspace-v2.js','site-build.cjs'])assert.doesNotThrow(()=>new vm.Script(read(file)),file);});
test('public routes restore PURE programs and preserve the shared storefront and account routes',()=>{const conf=JSON.parse(read('vercel.json'));for(const route of ['/shop','/bulk-orders','/coas','/contact','/about','/partner-program','/my-account','/product/:slug','/research-builder','/memberships','/research-checkout'])assert.ok(conf.rewrites.some(r=>r.source===route),route);assert.ok(!conf.rewrites.some(r=>r.source==='/offers'),'The old offers page remains retired.');assert.equal(conf.git.deploymentEnabled,false);});
test('production build creates the actual unified site and account integration without changing catalog prices',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'altapure-overhaul-'));
 try{
  for(const file of ['site-build.cjs','products.js','account.html','account.js'])fs.copyFileSync(path.join(root,file),path.join(temp,file));
  fs.mkdirSync(path.join(temp,'config'),{recursive:true});
  fs.copyFileSync(path.join(root,'config','display-currencies.json'),path.join(temp,'config','display-currencies.json'));
  const source=fs.readFileSync(path.join(temp,'products.js'),'utf8');
  let run=spawnSync(process.execPath,['site-build.cjs'],{cwd:temp,encoding:'utf8'});assert.equal(run.status,0,run.stderr);
  const html=fs.readFileSync(path.join(temp,'index.html'),'utf8');
  for(const marker of ['ap-header','ap-more-menu','ap-search-dialog','ap-cart-dialog','ap-age-dialog','storefront-v2.js','workspace-v2.js','/bulk-orders','/coas','href="/research-builder"','href="/memberships"','href="/account/membership"','href="/account/subscriptions"'])assert.ok(html.includes(marker),marker);assert.doesNotMatch(html,/href="\/offers(?:["?#/])|\bBOGO\b/);
  assert.ok(fs.existsSync(path.join(temp,'storefront-v2.html')));
  const account=fs.readFileSync(path.join(temp,'account.html'),'utf8');assert.match(account,/storefront-v2\.css/);assert.match(account,/workspace-v2\.js/);
  assert.match(account,/<link rel="stylesheet" href="\/cart-reference\.css">/);
  assert.match(account,/<script src="\/cart-reference\.js"><\/script>/);
  assert.ok(account.indexOf('src="/cart-reference.js"')<account.indexOf('src="/account.js"'),'Shared cart loads before account and checkout routes render');
  const accountJs=fs.readFileSync(path.join(temp,'account.js'),'utf8');assert.match(accountJs,/AltaWorkspace.renderAccountPanel/);assert.doesNotMatch(accountJs,/No membership, subscription, points, store-credit, or partner actions are enabled in this phase/);assert.match(accountJs,/'\/account\/membership':'Membership'/);assert.match(accountJs,/'\/account\/subscriptions':'AUTO-STACK™'/);assert.doesNotMatch(accountJs,/\['\/account\/membership','\/account\/subscriptions'\]\.includes\(p\)\)return go\('\/account'\)/);
  assert.equal(fs.readFileSync(path.join(temp,'products.js'),'utf8'),source);
  run=spawnSync(process.execPath,['site-build.cjs'],{cwd:temp,encoding:'utf8'});assert.equal(run.status,0,run.stderr);
  assert.equal((fs.readFileSync(path.join(temp,'account.html'),'utf8').match(/id="ap-search-dialog"/g)||[]).length,1);
  const repeatedAccount=fs.readFileSync(path.join(temp,'account.html'),'utf8');
  assert.equal((repeatedAccount.match(/src="\/cart-reference\.js"/g)||[]).length,1);
  assert.equal((repeatedAccount.match(/href="\/cart-reference\.css"/g)||[]).length,1);
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
test('current configuration enables prepaid PURE tiers without fabricated offers, recurring billing or COA records',()=>{
 const config=JSON.parse(read('config/conversion.json')),checkout=JSON.parse(read('config/checkout.json')),legacy=JSON.parse(read('data/storefront-programs.json'));
 assert.equal(config.memberships_enabled,true);assert.equal(config.billing_mode,'prepaid');assert.equal(config.automatic_renewal,false);assert.equal(config.recurring_available,false);
 assert.deepEqual([config.plans.vip.name,config.plans.vip.monthly_cents,config.plans.vip.annual_cents],['PURE WHITE',1999,19190]);
 assert.deepEqual([config.plans.elite.name,config.plans.elite.monthly_cents,config.plans.elite.annual_cents],['PURE BLACK',9999,95990]);
 assert.equal(config.plans.vip.points_per_dollar,5);assert.equal(config.plans.elite.points_per_dollar,10);
 assert.equal(checkout.promotions.bogo,false);assert.equal(checkout.promotions.coupon,'BLACKFRIDAY15');assert.equal(checkout.promotions.coupon_discount_bps,1500);
 assert.equal(legacy.subscription_billing_enabled,false);assert.equal(legacy.partner_payouts_enabled,false);assert.deepEqual(legacy.active_offers,[]);assert.equal(legacy.cart_incentive,null);assert.deepEqual(JSON.parse(read('data/verified-coas.json')),[]);
});
test('new cart reconstructs product names/prices from catalog and has no payment/session initiation',()=>{const client=read('storefront-v2.js');assert.match(client,/function normalizeLines/);assert.match(client,/name:p.name,size:v.size,price:v.price/);assert.match(client,/Number.isSafeInteger\(x.qty\)/);assert.doesNotMatch(client,/fetch\(['"]\/api\/checkout['"]/);assert.match(client,/window\.AltaCartNmi\?\.offer\(root\)/);});
test('program panels are server-backed and financial records are not trusted from user metadata',()=>{for(const file of ['workspace-v2.js','conversion-ui.js','research-builder-client.js'])assert.doesNotMatch(read(file),/user_metadata\?\.(points|store_credit|rewards|membership)/,file);const conversion=read('conversion-build.cjs');assert.match(conversion,/ConversionUI\.mountMembership\(root,auth\)/);assert.match(conversion,/ConversionUI\.subscriptions\(root,auth\)/);assert.match(read('conversion-ui.js'),/request\('research_builder=1&scope=mine',null,auth\)/);assert.match(read('research-builder-client.js'),/action:'quote',items:quoteLines\(\),mode/);});
