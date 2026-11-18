'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const dom=new JSDOM(read('public-build/index.html'),{url:'https://altapurelabs.test/',runScripts:'outside-only'}),w=dom.window,d=w.document;
w.matchMedia=()=>({matches:true});w.eval(read('storefront-navigation.js'));
const nav=d.querySelector('#ap-nav'),more=d.querySelector('#ap-more-menu'),trigger=d.querySelector('[aria-controls="ap-more-menu"]'),group=trigger.parentElement;
// Validate navigation destinations independent of optional NEW promotional badges.
assert.deepEqual([...nav.children].map(n=>(n.matches('a')?n.textContent:n.querySelector('button').textContent.trim().replace('⌄','')).replace(/\s*NEW\s*$/,'').trim()),['Products','Auto-Stack™','Memberships','Bulk Orders','COAS','Contact Us','More']);
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
for(const file of ['account.html','shop.html','coas.html','contact.html','partner-program.html','track-order.html','memberships.html','research-builder.html','membership-terms.html']){const page=new JSDOM(read('public-build/'+file));const header=page.window.document.querySelector('header');assert.ok(header?.querySelector('#ap-more-menu'),file);assert.equal(header.querySelector('a[href="/about"]'),null,file);assert.equal(header.querySelectorAll('#ap-nav').length,1,file);assert.ok(page.window.document.querySelector('script[src="/storefront-navigation.js?v=2"]'),file);const scripts=[...page.window.document.scripts].map(s=>s.getAttribute('src'));assert.ok(scripts.indexOf('/storefront-navigation.js?v=2')<scripts.findIndex(src=>src?.startsWith('/storefront-v2.js')),file+' handles submenu Escape before mobile navigation');page.window.close();}
assert.match(read('public-build/storefront-v2.js'),/coas:'COAS'/);
assert.doesNotMatch(read('public-build/storefront-v2.js'),/FIND YOUR FOCUS/);
dom.window.close();

// Exercise the disclosure and storefront listeners together, in their published
// order. A closed disclosure must not swallow the next Escape from its trigger.
(async()=>{
 for(const [file,checkout] of [['research-use-policy.html',false],['account.html',true]]){
  const page=new JSDOM(read('public-build/'+file),{url:'https://pure.example/'+(checkout?'account':'research-use-policy.html'),runScripts:'outside-only'}),window=page.window,document=window.document;
  try{
   if(checkout)document.body.classList.add('ap-checkout-page');
   window.matchMedia=()=>({matches:false});
   window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
   window.HTMLDialogElement.prototype.close=function(){this.open=false;};
   window.fetch=async()=>({ok:true,json:async()=>[]});
   window.eval(read('storefront-navigation.js'));
   window.eval(read('public-build/products.js')+'\n'+read('public-build/product-images.js')+'\n'+read('public-build/storefront-v2.js'));
   await new Promise(resolve=>setTimeout(resolve,0));
   const mobileNav=document.getElementById('ap-nav'),toggle=document.querySelector('[data-action="menu"]'),moreTrigger=document.querySelector('[aria-controls="ap-more-menu"]'),panel=document.getElementById('ap-more-menu');
   toggle.click();assert.ok(mobileNav.classList.contains('ap-open'));assert.equal(toggle.getAttribute('aria-expanded'),'true');
   moreTrigger.focus();moreTrigger.dispatchEvent(new window.KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true,cancelable:true}));
   assert.equal(document.activeElement,[...panel.querySelectorAll('a')].at(-1));assert.equal(panel.hidden,false);
   const first=new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true});document.activeElement.dispatchEvent(first);
   assert.equal(panel.hidden,true,file+': first Escape closes the submenu');
   assert.equal(document.activeElement,moreTrigger,file+': first Escape returns to More');
   assert.ok(mobileNav.classList.contains('ap-open'),file+': first Escape preserves the parent menu');
   const second=new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true});document.activeElement.dispatchEvent(second);
   assert.equal(mobileNav.classList.contains('ap-open'),false,file+': second Escape closes the parent menu');
   assert.equal(toggle.getAttribute('aria-expanded'),'false');
   assert.equal(document.activeElement,toggle,file+': second Escape returns to the mobile toggle');
   assert.equal(panel.hidden,true);
   const third=new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true});toggle.dispatchEvent(third);
   assert.equal(third.defaultPrevented,false,file+': a closed menu does not consume Escape');
   toggle.click();mobileNav.querySelector('a').focus();
   document.activeElement.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
   assert.equal(mobileNav.classList.contains('ap-open'),false,file+': Escape closes a menu without an open submenu');
   assert.equal(document.activeElement,toggle);
   toggle.click();
   const handled=new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true});handled.preventDefault();toggle.dispatchEvent(handled);
   assert.ok(mobileNav.classList.contains('ap-open'),file+': an already handled Escape leaves the menu alone');
   const dialog=document.getElementById('ap-search-dialog'),search=document.getElementById('ap-global-search');
   dialog.showModal();search.focus();
   const modalEscape=new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true});search.dispatchEvent(modalEscape);
   assert.equal(modalEscape.defaultPrevented,false,file+': native dialog dismissal is not blocked');
   assert.equal(document.activeElement,search,file+': Escape does not move focus behind an open dialog');
   dialog.close();
  }finally{page.window.close();}
 }
 console.log('PASS: shared navigation, hover, keyboard, layered Escape with focus return, outside click, touch toggle, account menu and all customer-page shells.');
})().catch(error=>{console.error(error);process.exitCode=1;});
