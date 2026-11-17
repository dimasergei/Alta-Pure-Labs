"use strict";
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const out='public-build';
const retired=['research-builder.html','memberships.html','offers.html','research-checkout.html','membership-experience.js','membership-experience.css','research-builder-parity.css','research-checkout-client.js','data/storefront-programs.json'];
for(const file of retired)assert.equal(fs.existsSync(path.join(out,file)),false,'Retired artifact: '+file);
const config=JSON.parse(fs.readFileSync('vercel.json','utf8'));
for(const route of ['/research-builder','/research-builder.html','/memberships','/memberships.html','/research-checkout','/offers'])assert.ok(config.redirects.some(r=>r.source===route&&r.destination==='/shop'),'Retired route redirect: '+route);
const forbiddenCopy=/\bBOGO\b|research\s+builder|\bmemberships?\b|buy\s+more.{0,15}get\s+more|free\s+BAC\s+water|shop\s+the\s+(?:BOGO\s+)?sale/i;
let pages=0;
for(const file of fs.readdirSync(out,{recursive:true}).filter(f=>f.endsWith('.html'))){
 const html=fs.readFileSync(path.join(out,file),'utf8'),dom=new JSDOM(html),doc=dom.window.document;
 assert.equal(doc.querySelectorAll('link[href^="/pure-brand.css"]').length,1,'Shared typography: '+file);
 assert.equal(doc.querySelectorAll('link[rel="preload"][href="/assets/fonts/archivo-latin-variable.woff"]').length,1,'One local font preload: '+file);
 if(!path.basename(file).startsWith('admin-')){
  doc.querySelectorAll('script,style').forEach(n=>n.remove());
  assert.doesNotMatch(doc.body.textContent,forbiddenCopy,'Retired visible copy: '+file);
  for(const a of doc.querySelectorAll('a[href]'))assert.doesNotMatch(a.getAttribute('href'),/^\/(?:memberships?|research-builder|research-checkout|offers)(?:[/.?#]|$)/,'Retired link: '+file);
 }
 dom.window.close();pages++;
}
assert.ok(fs.statSync(path.join(out,'assets/fonts/archivo-latin-variable.woff')).size>10000);
assert.ok(fs.existsSync(path.join(out,'assets/fonts/OFL.txt')));
assert.match(fs.readFileSync(path.join(out,'pure-brand.css'),'utf8'),/font-family: 'Archivo'/);
assert.doesNotMatch(fs.readFileSync(path.join(out,'sitemap.xml'),'utf8'),/memberships|research-builder|\/offers/);
console.log('Verified '+pages+' published pages, local typography, and retirement of all old program artifacts/routes.');
