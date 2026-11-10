'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
test('operational frontend and build scripts parse',()=>{for(const p of ['admin-operations.js','operations-client.js','operations-build.cjs'])assert.doesNotThrow(()=>new vm.Script(fs.readFileSync(path.join(root,p),'utf8')),p);});
test('DB-only backend access does not initialize or require Stripe credentials',()=>{const keys=['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','STRIPE_SECRET_KEY','LIVE_CHECKOUT_ENABLED'];const prev=Object.fromEntries(keys.map(k=>[k,process.env[k]]));try{process.env.SUPABASE_URL='https://fixture.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='fixture-only-key';delete process.env.STRIPE_SECRET_KEY;delete process.env.LIVE_CHECKOUT_ENABLED;const {clients}=require('../lib/backend');const c=clients();assert.ok(c.db);assert.throws(()=>c.stripe,/TEST keys/);process.env.LIVE_CHECKOUT_ENABLED='true';assert.throws(()=>clients().stripe,/live secret key/);}finally{for(const k of keys)if(prev[k]===undefined)delete process.env[k];else process.env[k]=prev[k];}});
test('readiness does not disguise unavailable counts as zero or expose credentials',async()=>{const {loadReadiness}=require('../lib/launch-readiness');const db={from(){return{select(){const q={eq(){return q;},then(resolve){return Promise.resolve({error:{code:'42P01'}}).then(resolve);}};return q;}};}};const out=await loadReadiness(db,{RESEND_API_KEY:'must-not-be-exposed'});assert.equal(out.fully_operational,false);assert.equal(out.observations.requests.available,false);assert.equal(out.observations.requests.count,undefined);assert.equal(JSON.stringify(out).includes('must-not-be-exposed'),false);assert.equal(out.requirements.length,18);});
test('full build generates crawlable products and excludes internal source from static output',()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'alta-operations-'));
 try{
  for(const f of fs.readdirSync(root)){const src=path.join(root,f);if(fs.statSync(src).isFile()&&/\.(js|cjs|html|css|json)$/.test(f))fs.copyFileSync(src,path.join(tmp,f));}
  fs.mkdirSync(path.join(tmp,'data'),{recursive:true});for(const f of ['verified-coas.json','storefront-programs.json','coa-demo-samples.json'])fs.copyFileSync(path.join(root,'data',f),path.join(tmp,'data',f));
  for(let run=0;run<2;run++)for(const script of ['install-store.cjs','site-build.cjs','operations-build.cjs']){const r=spawnSync(process.execPath,[script],{cwd:tmp,encoding:'utf8'});assert.equal(r.status,0,script+': '+r.stderr);}
  const output=path.join(tmp,'public-build');assert.ok(fs.existsSync(path.join(output,'admin-operations.html')));assert.ok(fs.existsSync(path.join(output,'product','bpc-157.html')));
  const html=fs.readFileSync(path.join(output,'product','bpc-157.html'),'utf8');assert.match(html,/<title>BPC-157 \| AltaPure Labs<\/title>/);assert.match(html,/rel="canonical" href="https:\/\/altapurelabs.com\/product\/bpc-157"/);assert.match(html,/application\/ld\+json/);assert.doesNotMatch(html,/AggregateRating/);
  for(const dir of ['lib','api','supabase','tests','config','docs','.github','node_modules'])assert.equal(fs.existsSync(path.join(output,dir)),false,dir+' must not be publicly copied');
  const map=fs.readFileSync(path.join(output,'sitemap.xml'),'utf8');assert.equal((map.match(/<loc>/g)||[]).length,58);
  const account=fs.readFileSync(path.join(output,'account.js'),'utf8');assert.match(account,/AltaOperationsUI.renderRequests/);assert.equal((account.match(/\['Requests','\/account\/requests'\]/g)||[]).length,1);
  const accountHtml=fs.readFileSync(path.join(output,'account.html'),'utf8');assert.equal((accountHtml.match(/src="\/operations-client.js"/g)||[]).length,1);
 }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});
