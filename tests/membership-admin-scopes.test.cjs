'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom'),options=require('../lib/payment-provider-options');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const fixtureId='d1000000-0000-4000-8000-000000000001';

function page(file,script,data){
 const dom=new JSDOM(fs.readFileSync(file,'utf8'),{url:'https://getpurelabs.com/'+file,runScripts:'outside-only'});
 const window=dom.window,calls=[];
 window.HTMLElement.prototype.scrollIntoView=()=>{};
 window.crypto.randomUUID=()=>fixtureId;
 window.fetch=async(url,init={})=>{calls.push({url,body:init.body?JSON.parse(init.body):null});return{ok:true,json:async()=>init.body?{saved:true}:data};};
 window.eval(fs.readFileSync(script,'utf8'));
 return{dom,window,document:window.document,calls};
}

test('editing Interac preserves its approved sales and activation state; new routes stay products-only',async t=>{
 for(const scope of ['goods','both'])for(const active of [true,false]){
  const method={id:fixtureId,version:8,provider_key:'interac',kind:'interac',label:'Fixture Interac',currency:'CAD',
   display_order:30,sale_scope:scope,active,payee:'Fixture business',instructions:'Fixture business receiving@example.test',acceptance_reference:'Offline fixture approval'};
  const h=page('admin-payments.html','payment-options-ui.js',{provider_options:options.definitions,methods:[method]});
  t.after(()=>h.dom.window.close());
  const {document:d,window:w}=h,form=d.getElementById('pay-method-form');
  d.getElementById('pay-password').value='offline-admin-fixture';
  d.getElementById('pay-login').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await tick();
  const card=d.querySelector('.ops-card[data-provider="interac"]'),row=card.querySelector('.ops-provider-row');
  assert.match(row.textContent,scope==='both'?/Products and prepaid memberships/:/Products/);
  row.querySelector('button').click();
  assert.equal(form.elements.sale_scope.value,scope);assert.equal(form.elements.active.checked,active);
  const saved=new w.FormData(form);assert.equal(saved.get('sale_scope'),scope);assert.equal(saved.get('version'),'8');assert.equal(saved.get('id'),fixtureId);
  card.querySelector('button').click();
  assert.equal(form.elements.sale_scope.value,'goods');assert.equal(form.elements.active.checked,false);
  assert.deepEqual(Array.from(form.elements.sale_scope.options,option=>option.value),['goods','both']);
  const paypal=d.querySelector('.ops-card[data-provider="paypal"]');paypal.querySelector('button').click();
  assert.equal(form.elements.sale_scope.value,'goods');assert.equal(form.elements.active.checked,false);
  assert.deepEqual(Array.from(form.elements.sale_scope.options,option=>option.value),['goods']);
  assert.equal(h.calls.filter(call=>call.body).length,0,'Opening or editing a form must not save or activate a route');
 }
});

test('native gateway controls offer prepaid memberships only for Polygon and hosted Rampex',async t=>{
 const h=page('admin-gateways.html','admin-gateways.js',{configuration:[],methods:[],accounts:[],attempts:[],events:[]});
 t.after(()=>h.dom.window.close());
 const {document:d,window:w}=h,form=d.getElementById('ng-configure'),scope=form.elements.sale_scope;
 const both=scope.querySelector('option[value="both"]');
 const change=provider=>{form.elements.provider.value=provider;form.elements.provider.dispatchEvent(new w.Event('change'));};
 const rail=value=>{form.elements.rampex_provider.value=value;form.elements.rampex_provider.dispatchEvent(new w.Event('input'));};
 const complete=()=>{form.elements.label.value='Fixture payment';form.elements.payee.value='Fixture business';form.elements.approval_reference.value='Offline approved route fixture';form.elements.countries.value='US,CA';form.elements.confirmed.checked=true;};
 assert.equal(scope.value,'goods');assert.equal(form.elements.active.checked,false);assert.equal(both.disabled,true);
 change('polygon_usdc');assert.equal(form.elements.currency.value,'USD');assert.equal(both.disabled,false);assert.equal(scope.value,'goods');
 assert.match(d.getElementById('ng-polygon-note').textContent,/prepaid membership fees/);
 scope.value='both';complete();await form.onsubmit({preventDefault(){},target:form});
 const polygon=h.calls.find(call=>call.body)?.body;
 assert.equal(polygon.provider,'polygon_usdc');assert.equal(polygon.sale_scope,'both');assert.equal(polygon.currency,'USD');assert.equal(polygon.active,false);
 assert.equal(scope.value,'goods');assert.equal(form.elements.active.checked,false);
 change('rampex');rail('hosted');assert.equal(both.disabled,false);scope.value='both';
 rail('stripe');assert.equal(both.disabled,true);assert.equal(scope.value,'goods');
 rail(' hosted ');assert.equal(both.disabled,false);scope.value='both';complete();await form.onsubmit({preventDefault(){},target:form});
 const rampex=h.calls.filter(call=>call.body)[1].body;
 assert.equal(rampex.provider,'rampex');assert.equal(rampex.rampex_provider,'hosted');assert.equal(rampex.sale_scope,'both');assert.equal(rampex.active,false);
 change('nmi');assert.equal(both.disabled,true);assert.equal(scope.value,'goods');
 assert.equal(h.calls.filter(call=>call.body).length,2);
 assert.doesNotMatch(d.body.textContent,/USD product orders only|Rampex requires USD and Products only/);
});
