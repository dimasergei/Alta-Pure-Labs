'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM}=require('jsdom');
const root=path.join(__dirname,'..');
const script=fs.readFileSync(path.join(root,'admin-experience.js'),'utf8');
const css=fs.readFileSync(path.join(root,'admin-experience.css'),'utf8');
function render(filename){
  const source=fs.readFileSync(path.join(root,filename),'utf8');
  const dom=new JSDOM(source,{runScripts:'outside-only',url:'https://altapurelabs.com/'+filename});
  dom.window.eval(script);
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded',{bubbles:true}));
  return dom;
}
test('admin routes load complete structural experience after all older styles',()=>{
  for(const f of ['admin-orders.html','admin-marketing.html']){
    const html=fs.readFileSync(path.join(root,f),'utf8');
    assert.match(html,/admin-experience\.css\?v=1/);
    assert.match(html,/admin-experience\.js\?v=1/);
    assert.ok(html.lastIndexOf('/admin-experience.css')>html.lastIndexOf('/admin-ui-polish.css'));
  }
});
test('Orders has two-section navigation, sidebar, main workbench and intact operational controls',()=>{
  const dom=render('admin-orders.html'),d=dom.window.document;
  assert.ok(d.querySelector('#login-view.ap-auth-layout'));
  assert.ok(d.querySelector('.ap-auth-visual .ap-auth-hero-title'));
  assert.ok(d.getElementById('login-form'));
  const root=d.querySelector('#orders-view.ap-workspace');
  assert.ok(root);
  assert.ok(root.querySelector(':scope > .ap-workspace-sidebar'));
  assert.ok(root.querySelector(':scope > .ap-workspace-body'));
  const links=[...root.querySelectorAll('.ap-primary-nav .admin-nav-link')].map(e=>e.textContent.trim());
  assert.deepEqual(links,['Orders','Marketing']);
  assert.ok(d.querySelector('#admin-orders-section .ap-orders-console #fulfillment-hub'));
  for(const id of ['refresh-button','logout-button','admin-batches-section','admin-notifications-section','admin-lotus-section']){
    assert.ok(d.getElementById(id),id+' must be preserved');
  }
  assert.equal(d.querySelector('#admin-batches-section').hidden,true);
  dom.window.close();
});
test('Marketing has a real 2-level workbench and retained interactive prospect and Instagram controls',()=>{
  const dom=render('admin-marketing.html'),d=dom.window.document;
  assert.ok(d.querySelector('#mk-login.ap-auth-layout'));
  const app=d.querySelector('#mk-app.ap-workspace');
  assert.ok(app);
  assert.ok(app.querySelector('.ap-workspace-sidebar .ap-primary-nav'));
  assert.ok(app.querySelector('.ap-workspace-body .ap-workspace-topbar'));
  assert.ok(app.querySelector('.ap-marketing-workarea > .ap-marketing-sections'));
  const panels=[...app.querySelectorAll('.ap-marketing-panel-container > .mk-panel')].map(e=>e.id);
  assert.deepEqual(panels,['mk-panel-pipeline','mk-panel-conversations','mk-panel-instagram','mk-panel-insights','mk-panel-settings']);
  assert.ok(d.querySelector('#mk-panel-pipeline .ap-content-heading h2'));
  assert.equal(d.querySelector('#mk-panel-instagram').hidden,true);
  for(const id of ['mk-lead-form','mk-import-button','mk-add-button','mk-ig-connect','mk-ig-send','mk-draft-dialog']){
    assert.ok(d.getElementById(id),id+' must be preserved');
  }
  dom.window.close();
});
test('new stylesheet replaces dark order console, keeps light form controls, supports mobile and reduced motion',()=>{
  for(const selector of ['.uc-order-row','.uc-dialog','.uc-input-field input','.ap-marketing-workarea','.ap-auth-layout','.ap-workspace-sidebar'])assert.ok(css.includes(selector),selector);
  assert.match(css,/background:#fff!important/);
  assert.match(css,/@media\(max-width:840px\)/);
  assert.match(css,/@media\(max-width:600px\)/);
  assert.match(css,/prefers-reduced-motion/);
  assert.ok(!/setInterval\s*\(/.test(script));
});
