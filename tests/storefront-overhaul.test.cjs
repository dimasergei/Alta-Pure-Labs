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
test('new public routes share one storefront and preserve account routes',()=>{const conf=JSON.parse(read('vercel.json'));for(const route of ['/shop','/research-builder','/bulk-orders','/memberships','/coas','/contact','/about','/partner-program','/my-account','/product/:slug'])assert.ok(conf.rewrites.some(r=>r.source===route),route);assert.equal(conf.git.deploymentEnabled,false);});
test('production build creates the actual unified site and account integration without changing catalog prices',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'altapure-overhaul-'));
 try{
  for(const file of ['site-build.cjs','products.js','account.html','account.js'])fs.copyFileSync(path.join(root,file),path.join(temp,file));
  const source=fs.readFileSync(path.join(temp,'products.js'),'utf8');
  let run=spawnSync(process.execPath,['site-build.cjs'],{cwd:temp,encoding:'utf8'});assert.equal(run.status,0,run.stderr);
  const html=fs.readFileSync(path.join(temp,'index.html'),'utf8');
  for(const marker of ['ap-header','ap-mega-content','ap-search-dialog','ap-cart-dialog','ap-age-dialog','storefront-v2.js','workspace-v2.js','/research-builder','/bulk-orders','/memberships','/coas'])assert.ok(html.includes(marker),marker);
  assert.ok(fs.existsSync(path.join(temp,'storefront-v2.html')));
  const account=fs.readFileSync(path.join(temp,'account.html'),'utf8');assert.match(account,/storefront-v2\.css/);assert.match(account,/workspace-v2\.js/);
  const accountJs=fs.readFileSync(path.join(temp,'account.js'),'utf8');assert.match(accountJs,/AltaWorkspace.renderAccountPanel/);assert.doesNotMatch(accountJs,/No membership, subscription, points, store-credit, or partner actions are enabled in this phase/);
  assert.equal(fs.readFileSync(path.join(temp,'products.js'),'utf8'),source);
  run=spawnSync(process.execPath,['site-build.cjs'],{cwd:temp,encoding:'utf8'});assert.equal(run.status,0,run.stderr);
  assert.equal((fs.readFileSync(path.join(temp,'account.html'),'utf8').match(/id="ap-search-dialog"/g)||[]).length,1);
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
test('paid features and fabricated offers are not activated by the visual release',()=>{const config=JSON.parse(read('data/storefront-programs.json'));assert.equal(config.checkout_enabled,false);assert.equal(config.membership_billing_enabled,false);assert.equal(config.subscription_billing_enabled,false);assert.equal(config.partner_payouts_enabled,false);assert.deepEqual(config.active_offers,[]);assert.equal(config.cart_incentive,null);assert.deepEqual(JSON.parse(read('data/verified-coas.json')),[]);});
test('new cart reconstructs product names/prices from catalog and has no payment/session initiation',()=>{const client=read('storefront-v2.js');assert.match(client,/function normalizeLines/);assert.match(client,/name:p.name,size:v.size,price:v.price/);assert.match(client,/Number.isSafeInteger\(x.qty\)/);assert.doesNotMatch(client,/fetch\(['"]\/api\/checkout['"]/);assert.match(client,/Checkout unavailable/);});
test('planning metadata is separate from server-managed financial account records',()=>{const source=read('workspace-v2.js');assert.match(source,/user_metadata\?\.alta_research_lists/);assert.match(source,/app_metadata\?\.alta_commerce/);assert.doesNotMatch(source,/user_metadata\?\.(points|store_credit|rewards|membership)/);assert.match(source,/auth\.auth\.getUser/);});
