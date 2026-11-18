'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('operational frontend and build scripts parse',()=>{
 for(const file of ['admin-operations.js','operations-client.js','operations-build.cjs'])assert.doesNotThrow(()=>new vm.Script(read(file)),file);
});
test('DB-only backend access does not initialize or require Stripe credentials',()=>{
 const keys=['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','STRIPE_SECRET_KEY','LIVE_CHECKOUT_ENABLED'];
 const prev=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 try{
  process.env.SUPABASE_URL='https://fixture.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='fixture-only-key';
  delete process.env.STRIPE_SECRET_KEY;delete process.env.LIVE_CHECKOUT_ENABLED;
  const {clients}=require('../lib/backend');assert.ok(clients().db);assert.throws(()=>clients().stripe,/TEST keys/);
  process.env.LIVE_CHECKOUT_ENABLED='true';assert.throws(()=>clients().stripe,/live secret key/);
 }finally{for(const k of keys)if(prev[k]===undefined)delete process.env[k];else process.env[k]=prev[k];}
});
test('readiness keeps unavailable counts distinct from zero and reports the current requirements without credentials',async()=>{
 const {loadReadiness}=require('../lib/launch-readiness');
 const db={from(){return{select(){const q={eq(){return q;},then(resolve){return Promise.resolve({error:{code:'42P01'}}).then(resolve);}};return q;}};}};
 const out=await loadReadiness(db,{RESEND_API_KEY:'must-not-be-exposed'});
 const manifest=JSON.parse(read('config/operational-requirements.json'));
 assert.equal(out.fully_operational,false);assert.equal(out.observations.requests.available,false);
 assert.equal(out.observations.requests.count,undefined);assert.equal(JSON.stringify(out).includes('must-not-be-exposed'),false);
 assert.deepEqual(out.requirements.map(x=>x.id),manifest.requirements.map(x=>x.id));
 assert.ok(out.requirements.length>0);assert.equal(new Set(out.requirements.map(x=>x.id)).size,out.requirements.length);
 const conversion=JSON.parse(read('config/conversion.json'));assert.equal(conversion.memberships_enabled,true);assert.equal(conversion.recurring_available,false);
});
test('repeatable public build publishes restored program routes and assets while excluding old offers and private source',()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'pure-operations-'));
 const retiredPages=['offers.html'];
 const programPages=['research-builder.html','memberships.html','research-checkout.html'];
 const programAssets=['membership-experience.js','membership-experience.css','membership-checkout.js','membership-checkout.css','research-builder-client.js','research-builder-parity.css','research-checkout-client.js','research-checkout.css'];
 const retiredArtwork=['assets/products/legacy.webp','assets/brand-label.webp','assets/research-vials.webp','assets/hero-lab.webp','assets/capsules.webp'];
 try{
  for(const name of fs.readdirSync(root)){const src=path.join(root,name);if(fs.statSync(src).isFile()&&/\.(js|cjs|html|css|json)$/.test(name))fs.copyFileSync(src,path.join(tmp,name));}
  fs.mkdirSync(path.join(tmp,'data'),{recursive:true});
  for(const name of ['verified-coas.json','storefront-programs.json','coa-demo-samples.json'])if(fs.existsSync(path.join(root,'data',name)))fs.copyFileSync(path.join(root,'data',name),path.join(tmp,'data',name));
  fs.cpSync(path.join(root,'assets','fonts'),path.join(tmp,'assets','fonts'),{recursive:true});
  fs.copyFileSync(path.join(root,'assets','pure-wordmark.svg'),path.join(tmp,'assets','pure-wordmark.svg'));
  // Seed retired files so exclusion is tested even after their source files are removed.
  for(const name of [...retiredPages,...retiredArtwork]){fs.mkdirSync(path.dirname(path.join(tmp,name)),{recursive:true});fs.writeFileSync(path.join(tmp,name),'retired-fixture');}
  for(let run=0;run<2;run++)for(const script of ['install-store.cjs','site-build.cjs','operations-build.cjs']){
   const result=spawnSync(process.execPath,[script],{cwd:tmp,encoding:'utf8'});assert.equal(result.status,0,script+': '+result.stderr);
  }
  const output=path.join(tmp,'public-build');
  assert.ok(fs.existsSync(path.join(output,'admin-operations.html')));
  const productHtml=fs.readFileSync(path.join(output,'product','bpc-157.html'),'utf8');
  assert.match(productHtml,/<title>BPC-157 \| PURE<\/title>/);
  assert.match(productHtml,/rel="canonical" href="https:\/\/getpurelabs.com\/product\/bpc-157"/);
  assert.match(productHtml,/application\/ld\+json/);assert.doesNotMatch(productHtml,/AggregateRating/);
  for(const dir of ['lib','api','supabase','tests','config','docs','.github','node_modules'])assert.equal(fs.existsSync(path.join(output,dir)),false,dir+' must not be public');
  for(const name of [...retiredPages,...retiredArtwork,'data/storefront-programs.json'])assert.equal(fs.existsSync(path.join(output,name)),false,name+' must not be public');
  for(const name of programPages)assert.ok(fs.existsSync(path.join(output,name)),name+' is published');
  for(const name of programAssets)assert.deepEqual(fs.readFileSync(path.join(output,name)),fs.readFileSync(path.join(root,name)),name+' is copied intact');
  for(const name of ['assets/fonts/archivo-latin-variable.woff','assets/fonts/OFL.txt','assets/pure-wordmark.svg'])assert.deepEqual(fs.readFileSync(path.join(output,name)),fs.readFileSync(path.join(root,name)),name+' is copied intact');
  const catalog=JSON.parse(fs.readFileSync(path.join(tmp,'lib','catalog.json'),'utf8'));
  const retained=['/','/shop','/bulk-orders','/rewards','/coas','/about','/contact','/partner-program','/track-order','/memberships','/research-builder'];
  const expected=[...retained,...catalog.map(p=>'/product/'+p.id)].map(url=>'https://getpurelabs.com'+url).sort();
  const sitemap=fs.readFileSync(path.join(output,'sitemap.xml'),'utf8');
  const actual=[...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map(m=>m[1]);
  assert.deepEqual(actual.sort(),expected);assert.equal(new Set(actual).size,actual.length);
  assert.ok(!actual.includes('https://getpurelabs.com/research-checkout'),'The transactional research review is excluded from the sitemap.');
  for(const route of retained)assert.ok(fs.existsSync(path.join(output,route==='/'?'index.html':route.slice(1)+'.html')),route+' is published');
  const account=fs.readFileSync(path.join(output,'account.js'),'utf8');
  assert.match(account,/AltaOperationsUI.renderRequests/);assert.equal((account.match(/\['Requests','\/account\/requests'\]/g)||[]).length,1);
  const accountHtml=fs.readFileSync(path.join(output,'account.html'),'utf8');
  assert.equal((accountHtml.match(/src="\/operations-client.js"/g)||[]).length,1);
  for(const href of ['/research-builder','/memberships','/account/membership','/account/subscriptions'])assert.ok(accountHtml.includes('href="'+href+'"'),href+' is present in shared account navigation');
  assert.doesNotMatch(accountHtml,/href="\/offers(?:["?#/])|\bBOGO\b/);
 }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});
