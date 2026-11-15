'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {JSDOM} = require('jsdom');
const {quote,catalog} = require('../lib/research-builder-pricing');
const handler = require('../api/research-builder');

const lines = ['retatrutide','tirzepatide','semaglutide','tb-500'].map(id=>({id,size:id==='tb-500'?'5mg':'10mg',qty:1}));

test('dedicated checkout shows authoritative quote and cannot submit payment', async () => {
  const dom = new JSDOM('<main id="checkout"></main>',{url:'https://altapurelabs.com/research-checkout',runScripts:'outside-only'});
  dom.window.localStorage.setItem('ap-research-builder-v2',JSON.stringify({lines}));
  let request;
  dom.window.fetch = async (url, options) => {request={url,body:JSON.parse(options.body)};return {ok:true,json:async()=>quote(lines,catalog())};};
  dom.window.eval(fs.readFileSync('research-checkout-client.js','utf8'));
  await dom.window.ResearchCheckout.render(dom.window.document.getElementById('checkout'),{email:'researcher@example.test'});
  const page=dom.window.document.getElementById('checkout');
  assert.equal(request.url,'/api/research-builder');
  assert.deepEqual(JSON.parse(JSON.stringify(request.body.lines)),lines);
  assert.match(page.textContent,/Every month\$151\.20/);
  assert.match(page.textContent,/BAC Water 3ML/);
  assert.match(page.textContent,/Recurring checkout is being connected/);
  assert.equal(page.querySelector('.rc-pay').disabled,true);
  assert.equal(page.querySelectorAll('[action]').length,0);
  assert.equal(dom.window.localStorage.getItem('pp-cart'),null);
  dom.window.close();
});

test('no draft does not request a quote and blocks checkout',async()=>{
  const dom=new JSDOM('<main id="checkout"></main>',{url:'https://altapurelabs.com/research-checkout',runScripts:'outside-only'});
  dom.window.fetch=()=>{throw Error('unexpected quote');};
  dom.window.eval(fs.readFileSync('research-checkout-client.js','utf8'));
  await dom.window.ResearchCheckout.render(dom.window.document.getElementById('checkout'),{email:'researcher@example.test'});
  assert.match(dom.window.document.body.textContent,/Select four different compounds/);
  dom.window.close();
});

test('subscription account records require an authenticated verified user',async()=>{
  const response={code:0,setHeader(){},status(code){this.code=code;return this;},json(payload){this.payload=payload;return this;}};
  await handler({method:'GET',query:{scope:'mine'},headers:{}},response);
  assert.equal(response.code,401);
});
