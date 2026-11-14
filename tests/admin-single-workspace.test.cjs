'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
const read=path=>fs.readFileSync(path,'utf8');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('only Orders and Marketing occupy one administration route; legacy URL is retired',()=>{
 const html=read('admin-marketing.html'),config=JSON.parse(read('vercel.json'));
 const nav=html.match(/<nav class="admin-nav"[\s\S]*?<\/nav>/)?.[0]||'';
 assert.deepEqual([...nav.matchAll(/data-ap-workspace="([^"]+)"/g)].map(x=>x[1]),['orders','marketing']);
 assert.doesNotMatch(nav,/\/admin-orders\.html|Batches|Notifications|Lotus/);
 assert.match(html,/id="ap-orders-panel"/);
 assert.match(html,/id="mk-panel-pipeline"/);
 assert.match(html,/\/admin-workspace-orders\.js/);
 assert.ok(config.redirects.some(x=>x.source==='/admin-orders.html'&&x.destination.includes('admin-marketing.html')));
});
test('same-page navigation preserves marketing panels and opens only the requested Manage Order',async()=>{
 const dom=new JSDOM(read('admin-marketing.html'),{url:'https://altapurelabs.com/admin-marketing.html',runScripts:'outside-only'});
 const w=dom.window,d=w.document;
 d.getElementById('mk-login').hidden=true;
 d.getElementById('mk-app').hidden=false;
 w.eval(read('admin-experience.js'));
 d.dispatchEvent(new w.Event('DOMContentLoaded',{bubbles:true}));
 w.eval(read('admin-workspace-orders.js'));
 const id='00000000-0000-4000-8000-000000000001';
 let opened=null,header=null;
 w.AltaFulfillment={bind(fn){header=fn},manage:async received=>{opened=received},clear(){}};
 w.fetch=async(url,options)=>{
  assert.match(url,/\/api\/admin-workspace-orders\?/);
  assert.equal(options.headers['x-admin-password'],'a'.repeat(48));
  return {ok:true,json:async()=>({orders:[{
   id,source:'commerce',order_number:'ORD-TEST',customer_name:'Fixture Customer',
   customer_email:'fixture@example.test',created_at:'2026-11-14T20:00:00Z',
   currency:'USD',total_cents:3500,payment_status:'paid',fulfillment_status:'unfulfilled'
  }],pagination:{total:1,has_next:false}})};
 };
 w.AltaOrdersWorkspace.authenticate('a'.repeat(48));
 assert.equal(typeof header,'function');
 const marketing=d.querySelector('[data-ap-workspace="marketing"]'),orders=d.querySelector('[data-ap-workspace="orders"]');
 orders.click();await flush();await flush();
 assert.equal(d.getElementById('ap-orders-panel').hidden,false);
 assert.equal(marketing.classList.contains('is-active'),false);
 assert.equal(orders.classList.contains('is-active'),true);
 assert.match(d.getElementById('ap-orders-rows').textContent,/ORD-TEST/);
 assert.equal(d.querySelectorAll('#ap-orders-rows button').length,1);
 d.querySelector('#ap-orders-rows button').click();await flush();
 assert.equal(opened,id);
 marketing.click();
 assert.equal(d.getElementById('ap-orders-panel').hidden,true);
 assert.equal(d.querySelector('.ap-marketing-workarea').hidden,false);
 assert.ok(d.getElementById('mk-leads'));
 assert.ok(d.getElementById('mk-ig-thread'));
 w.AltaOrdersWorkspace.clear();dom.window.close();
});
test('browser-side order code uses one authenticated feed and parses',()=>{
 assert.doesNotThrow(()=>new Function(read('admin-workspace-orders.js')));
 assert.doesNotThrow(()=>new Function(read('admin-fulfillment.js')));
 assert.match(read('admin-workspace-orders.js'),/api\/admin-workspace-orders/);
 assert.doesNotMatch(read('admin-marketing.html'),/<a[^>]*href="\/admin-orders\.html"/);
});
