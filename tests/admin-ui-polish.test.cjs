'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const css=fs.readFileSync(path.join(root,'admin-ui-polish.css'),'utf8');
test('both admin pages load shared design system after legacy styles',()=>{
  for(const page of ['admin-orders.html','admin-marketing.html']){
    const html=fs.readFileSync(path.join(root,page),'utf8');
    const pos=html.indexOf('href="/admin-ui-polish.css"');
    assert.ok(pos>0,page+' must load polish stylesheet');
    assert.ok(pos>html.indexOf('href="/admin-dashboard.css"'));
    assert.ok(pos<html.indexOf('</head>'));
  }
});
test('admin design uses high contrast cobalt on white surfaces',()=>{
  for(const color of ['#18407e','#132b51','#ffffff','#f5f7fb','#53647a'])assert.ok(css.includes(color)||css.includes(color==='#ffffff'?'#fff':color),color);
  assert.match(css,/body \.admin-nav-link\.is-active/);
  assert.match(css,/body #login-view/);
  assert.match(css,/body #mk-login/);
  assert.match(css,/body \.mk-table/);
  assert.match(css,/body \.mk-dialog/);
});
test('admin remains functional on mobile and has visible keyboard focus',()=>{
  assert.match(css,/@media\(max-width:780px\)/);
  assert.match(css,/@media\(max-width:440px\)/);
  assert.match(css,/:focus-visible/);
  assert.match(css,/overflow-x:auto/);
});
