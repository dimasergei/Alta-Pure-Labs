'use strict';
// Static all-page audit. Layout at actual viewport widths is verified separately in a browser.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const output=path.resolve('public-build'),vercel=JSON.parse(fs.readFileSync('vercel.json','utf8'));
const walk=directory=>fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(path.join(directory,entry.name)):[path.join(directory,entry.name)]);
const pages=walk(output).filter(filename=>filename.endsWith('.html')&&!path.basename(filename).startsWith('admin-'));
const issues=[],stats={pages:pages.length,shared_headers:0,local_resources:0,local_links:0};
function routePattern(source){return new RegExp('^'+source.split(/(:[A-Za-z0-9_]+\*?)/).map(part=>part.startsWith(':')?(part.endsWith('*')?'.*':'[^/]+'):part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('')+'$');}
const routes=[...(vercel.rewrites||[]),...(vercel.redirects||[])].filter(rule=>typeof rule.source==='string').map(rule=>routePattern(rule.source));
const exists=url=>fs.existsSync(path.join(output,decodeURIComponent(url.replace(/^\//,''))));
function localUrl(value,file){try{const url=new URL(value,'https://pure.example/'+path.relative(output,file));return ['pure.example','getpurelabs.com','www.getpurelabs.com'].includes(url.hostname)&&['http:','https:'].includes(url.protocol)?url:null;}catch{return null;}}
for(const filename of pages){
 const label=path.relative(output,filename),dom=new JSDOM(fs.readFileSync(filename,'utf8')),d=dom.window.document;
 const issue=message=>issues.push(label+': '+message);
 if(!d.documentElement.lang)issue('Missing page language.');
 if(!d.title.trim())issue('Missing page title.');
 if(!/width\s*=\s*device-width/i.test(d.querySelector('meta[name="viewport"]')?.content||''))issue('Missing responsive viewport.');
 const ids=new Set();for(const element of d.querySelectorAll('[id]')){if(ids.has(element.id))issue('Duplicate ID '+element.id);ids.add(element.id);}
 const header=d.querySelector('.ap-header');
 if(header){stats.shared_headers++;for(const href of ['/research-builder','/memberships'])if(header.querySelectorAll(`a[href="${href}"]`).length!==1)issue('Shared header is missing exactly one '+href+' destination.');}
 if(/\b(?:ALTA|PURE)\s+(?:GOLD|PLATINUM)\b/i.test(d.body?.textContent||''))issue('Retired paid tier name remains.');
 for(const element of d.querySelectorAll('script[src],link[rel="stylesheet"][href],img[src]')){
  const value=element.getAttribute(element.tagName==='LINK'?'href':'src'),url=localUrl(value,filename);if(!url)continue;
  stats.local_resources++;if(!exists(url.pathname))issue('Missing local resource '+url.pathname);
 }
 for(const anchor of d.querySelectorAll('a[href]')){
  const url=localUrl(anchor.getAttribute('href'),filename);if(!url)continue;stats.local_links++;
  const pathname=url.pathname;
  if(pathname==='/'||exists(pathname)||exists(pathname+'.html')||routes.some(route=>route.test(pathname)))continue;
  issue('Unresolved local destination '+pathname);
 }
 dom.window.close();
}
console.log(JSON.stringify({stats,issues},null,2));
assert.equal(issues.length,0,'Customer-page audit found unresolved issues.');
console.log('PASS: all customer HTML pages have responsive metadata, current tier naming, valid shared navigation and local resources/destinations.');
