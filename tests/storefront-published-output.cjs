"use strict";
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const out='public-build';
const retired=['offers.html','data/storefront-programs.json'];
for(const file of retired)assert.equal(fs.existsSync(path.join(out,file)),false,'Retired artifact: '+file);
for(const file of ['memberships.html','research-builder.html','membership-terms.html','membership-experience.js','membership-checkout.js','research-builder-client.js'])assert.ok(fs.existsSync(path.join(out,file)),'Restored program artifact: '+file);
const config=JSON.parse(fs.readFileSync('vercel.json','utf8'));
assert.ok(config.rewrites.some(r=>r.source==='/memberships'));assert.ok(!config.redirects.some(r=>r.source==='/memberships'));
for(const route of ['/research-builder','/research-checkout'])assert.equal(config.redirects.find(r=>r.source===route)?.destination,'/memberships','Retired standalone enrollment: '+route);
assert.ok(config.redirects.some(r=>r.source==='/offers'&&r.destination==='/shop'));
const forbiddenCopy=/\bBOGO\b|buy\s+more.{0,15}get\s+more|shop\s+the\s+(?:BOGO\s+)?sale|Alta Gold|Alta Platinum|PURE GOLD|PURE PLATINUM/i;
let pages=0;
for(const file of fs.readdirSync(out,{recursive:true}).filter(f=>f.endsWith('.html'))){
 const html=fs.readFileSync(path.join(out,file),'utf8'),dom=new JSDOM(html),doc=dom.window.document;
 assert.equal(doc.querySelectorAll('link[href^="/pure-brand.css"]').length,1,'Shared typography: '+file);
 assert.equal(doc.querySelectorAll('link[rel="preload"][href="/assets/fonts/archivo-latin-variable.woff"]').length,1,'One local font preload: '+file);
 if(!path.basename(file).startsWith('admin-')){
  doc.querySelectorAll('script,style').forEach(n=>n.remove());
  assert.doesNotMatch(doc.body.textContent,forbiddenCopy,'Retired visible copy: '+file);
  for(const a of doc.querySelectorAll('a[href]'))assert.doesNotMatch(a.getAttribute('href'),/^\/offers(?:[/.?#]|$)/,'Retired link: '+file);
 }
 dom.window.close();pages++;
}
assert.ok(fs.statSync(path.join(out,'assets/fonts/archivo-latin-variable.woff')).size>10000);
assert.ok(fs.existsSync(path.join(out,'assets/fonts/OFL.txt')));
assert.match(fs.readFileSync(path.join(out,'pure-brand.css'),'utf8'),/font-family: 'Archivo'/);
const sitemap=fs.readFileSync(path.join(out,'sitemap.xml'),'utf8');assert.match(sitemap,/memberships/);assert.doesNotMatch(sitemap,/research-builder|research-checkout/);assert.doesNotMatch(sitemap,/\/offers/);
console.log('Verified '+pages+' published pages, local typography, and restored PURE program routes and retirement of old promotions.');
