'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const dom=new JSDOM(read('public-build/index.html'),{url:'https://altapurelabs.test/',runScripts:'outside-only'}),w=dom.window,d=w.document;
w.matchMedia=()=>({matches:true});w.eval(read('storefront-navigation.js'));
const nav=d.querySelector('#ap-nav'),more=d.querySelector('#ap-more-menu'),trigger=d.querySelector('[aria-controls="ap-more-menu"]'),group=trigger.parentElement;
// Validate navigation destinations independent of optional NEW promotional badges.
assert.deepEqual([...nav.children].map(n=>(n.matches('a')?n.textContent:n.querySelector('button').textContent.trim().replace('⌄','')).replace(/\s*NEW\s*$/,'').trim()),['Products','Research Builder','Bulk Orders','Memberships','COAS','Contact Us','More']);
assert.equal(nav.querySelector('a[href="/about"]'),null);assert.equal(nav.querySelector('.ap-mega'),null);
assert.equal(more.hidden,true);
const enter=new w.Event('pointerenter');Object.defineProperty(enter,'pointerType',{value:'mouse'});group.dispatchEvent(enter);assert.equal(more.hidden,false);assert.equal(trigger.getAttribute('aria-expanded'),'true');
d.body.dispatchEvent(new w.Event('pointerdown',{bubbles:true}));assert.equal(more.hidden,true);
w.matchMedia=()=>({matches:false});group.dispatchEvent(enter);assert.equal(more.hidden,true,'compact navigation waits for a tap or keyboard focus');w.matchMedia=()=>({matches:true});
trigger.focus();trigger.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));assert.equal(d.activeElement,more.querySelector('a'));
d.activeElement.dispatchEvent(new w.KeyboardEvent('keydown',{key:'End',bubbles:true}));assert.equal(d.activeElement.textContent,'FAQ');
d.activeElement.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));assert.equal(more.hidden,true);assert.equal(d.activeElement,trigger);
// Touch/pointer taps toggle correctly even though the browser focuses before click.
trigger.dispatchEvent(new w.Event('pointerdown',{bubbles:true}));trigger.dispatchEvent(new w.MouseEvent('click',{bubbles:true,detail:1}));assert.equal(more.hidden,false);
trigger.dispatchEvent(new w.Event('pointerdown',{bubbles:true}));trigger.dispatchEvent(new w.MouseEvent('click',{bubbles:true,detail:1}));assert.equal(more.hidden,true);
const account=d.querySelector('[aria-controls="ap-account-menu"]');account.focus();assert.equal(d.querySelector('#ap-account-menu').hidden,false);assert.equal(more.hidden,true);
trigger.focus();assert.equal(d.querySelector('#ap-account-menu').hidden,true);assert.equal(more.hidden,false);
for(const file of ['account.html','shop.html','memberships.html','coas.html','contact.html','partner-program.html','track-order.html']){const page=new JSDOM(read('public-build/'+file));const header=page.window.document.querySelector('header');assert.ok(header?.querySelector('#ap-more-menu'),file);assert.equal(header.querySelector('a[href="/about"]'),null,file);assert.equal(header.querySelectorAll('#ap-nav').length,1,file);assert.ok(page.window.document.querySelector('script[src="/storefront-navigation.js?v=2"]'),file);const scripts=[...page.window.document.scripts].map(s=>s.getAttribute('src'));assert.ok(scripts.indexOf('/storefront-navigation.js?v=2')<scripts.indexOf('/storefront-v2.js?v=2'),file+' handles submenu Escape before mobile navigation');page.window.close();}
assert.match(read('public-build/storefront-v2.js'),/coas:'COAS'/);
assert.doesNotMatch(read('public-build/storefront-v2.js'),/FIND YOUR FOCUS/);
dom.window.close();console.log('PASS: shared navigation, hover, keyboard, Escape, outside click, touch toggle, account menu and all customer-page shells.');
