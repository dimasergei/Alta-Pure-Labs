'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {priceLines,itemsFromCatalog,validateMethod,hostedUrl,issueInvoice,handle,requestInvoice}=require('../lib/manual-commerce');
const id='10000000-0000-4000-8000-000000000001',uid='20000000-0000-4000-8000-000000000001';
const catalog=[{id:'sample',name:'Sample',variants:[{size:'10mg',price:60}]}];
const reviewFixture={confirmed:true,seller_name:'Fixture corporation',destination_country:'US',destination_region:'NY',tax_mode:'reviewed',tax_basis:'Fixture tax review only; no collection obligation.',components:[],jurisdictions_reviewed:true,delivery:{origin_country:'US',origin_region:'NY',carrier:'Fixture carrier',service:'Ground',quote_reference:'Fixture quote',quote_expires_at:'2099-01-01',handling_max_days:2,transit_min_days:2,transit_max_days:5,duties:'domestic',route_review:'Fixture route reviewed.'}};
const lines=n=>itemsFromCatalog([{id:'sample',size:'10mg',qty:n,price:.01}],catalog);
const method={id,kind:'bank_transfer',label:'Business bank',payee:'Fixture business',instructions:'Fixture receiving instructions only',currency:'USD',active:true};
function res(){return{code:200,body:null,setHeader(){},status(n){this.code=n;return this;},json(b){this.body=b;return this;}};}
function dbFor(invoice,m=method,membership=[]){const calls=[];return{calls,from(table){calls.push(table);const q={select(){return q;},eq(){return q;},is(){return q;},gt(){return q;},order(){return q;},limit(){return Promise.resolve({data:membership});},single:async()=>({data:table==='commerce_invoices'?invoice:m})};return q;}};}
test('public terms expose current prepaid PURE tiers while legacy manual terms remain internal',()=>{
 const t=require('../config/launch-commercial-terms.json');assert.equal(t.memberships_enabled,true);assert.deepEqual(t.volume_tiers,[]);assert.equal(t.rewards_earning_enabled,true);
 const publicTerms=require('../lib/storefront-terms')();assert.equal(publicTerms.memberships,undefined);assert.equal(publicTerms.renewal,undefined);
 assert.equal(publicTerms.memberships_enabled,true);assert.equal(publicTerms.rewards_earning_enabled,true);
 assert.equal(publicTerms.conversion.billing_mode,'prepaid');assert.equal(publicTerms.conversion.automatic_renewal,false);assert.equal(publicTerms.conversion.recurring_available,false);
 for(const [plan,name,monthly,annual] of [['vip','PURE WHITE',1999,19190],['elite','PURE BLACK',9999,95990]]){
  const tier=publicTerms.conversion.plans[plan];assert.equal(tier.name,name);assert.equal(tier.monthly_cents,monthly);assert.equal(tier.annual_cents,annual);
  assert.equal(t.memberships[plan].name,name);assert.equal(t.memberships[plan].price_cents,annual);
 }
 for(const file of ['manual-commerce-client.js','manual-commerce-build.cjs','admin-payments.js'])assert.doesNotThrow(()=>new vm.Script(fs.readFileSync(file,'utf8')),file);
});
test('server catalog ignores client prices and rejects duplicate/invalid variants',()=>{assert.equal(lines(1)[0].unit_price_usd_cents,6000);for(const qty of [0,-1,101,1.2,'1'])assert.throws(()=>lines(qty));assert.throws(()=>itemsFromCatalog([{id:'sample',size:'wrong',qty:1}],catalog));assert.throws(()=>itemsFromCatalog([{id:'sample',size:'10mg',qty:1},{id:'sample',size:'10mg',qty:1}],catalog));});
test('all quantities and memberships use regular catalog prices',()=>{for(const qty of [1,9,10,24,25,50,100])for(const plan of ['member','vip','elite']){const q=priceLines(lines(qty),plan);assert.equal(q.discount_cents,0);assert.equal(q.subtotal_cents,qty*6000);assert.equal(q.lines[0].line_total_cents,qty*6000);assert.equal(q.lines[0].discount_reason,'none');}});
test('fixed FX quote and integer rounding are deterministic',()=>{const r=priceLines(lines(1),'vip','CAD',1375000);assert.equal(r.subtotal_cents,8250);assert.equal(r.discount_cents,0);assert.throws(()=>priceLines(lines(1),'member','USD',1375000));assert.throws(()=>priceLines(lines(1),'member','CAD',NaN));});
test('receiving methods require real-use confirmations and reject private keys',()=>{const b={...method,version:0,business_confirmed:true,catalog_accepted:true,acceptance_reference:'Bank confirmation reference'};assert.equal(validateMethod(b).active,true);assert.throws(()=>validateMethod({...b,business_confirmed:false}));assert.throws(()=>validateMethod({...b,instructions:'PRIVATE KEY secret do not store'}));assert.throws(()=>validateMethod({...b,kind:'interac'}));assert.equal(validateMethod({...b,kind:'interac',currency:'CAD',instructions:'Send to receiving@example.test, payee Fixture Business'}).currency,'CAD');assert.throws(()=>validateMethod({...b,kind:'hosted_link',allowed_host:'https://payments.example.test'}));});
test('hosted URLs must match one approved exact hostname',()=>{const m={kind:'hosted_link',allowed_host:'pay.example.test'};assert.equal(hostedUrl('https://pay.example.test/invoice/123',m),'https://pay.example.test/invoice/123');for(const u of ['http://pay.example.test/a','https://pay.example.test.evil.test/a','https://pay.example.test:8443/a','https://user@pay.example.test/a','javascript:alert(1)'])assert.throws(()=>hostedUrl(u,m));});
test('preview calculates final amount without requiring a hosted link or creating records',async()=>{const invoice={id,customer_id:uid,kind:'goods',status:'requested',version:1,request_data:{address:{country:'US',region:'NY'},items:lines(10)}};const db=dbFor(invoice,{...method,kind:'hosted_link',allowed_host:'pay.example.test'});const r=await issueInvoice(db,{id,action:'preview',version:1,method_id:id,shipping_cents:2500,tax_cents:0,delivery_tax:reviewFixture,fulfillment_confirmed:true,review_note:'Fixture confirms route, cost and tax treatment.'});assert.equal(r.total_cents,62500);assert.equal(r.payment_url,null);assert.ok(Date.parse(r.expires_at)>Date.now());assert.ok(!db.calls.includes('commerce_memberships'));});
test('issue refuses stale totals and requires provider amount confirmation',async()=>{const invoice={id,customer_id:uid,kind:'goods',status:'requested',version:1,request_data:{address:{country:'US',region:'NY'},items:lines(1)}};const db=dbFor(invoice,{...method,kind:'hosted_link',allowed_host:'pay.example.test'});const input={id,action:'issue',version:1,method_id:id,shipping_cents:0,tax_cents:0,delivery_tax:reviewFixture,fulfillment_confirmed:true,review_note:'Checked exact supplier, destination and tax.',payment_url:'https://pay.example.test/1',expected_total_cents:6000};await assert.rejects(issueInvoice(db,{...input,expected_total_cents:1}),e=>e.status===409);await assert.rejects(issueInvoice(db,input),e=>e.status===400);assert.equal((await issueInvoice(db,{...input,provider_amount_confirmed:true})).total_cents,6000);});
test('new issuance of an old unpaid membership invoice is blocked',async()=>{const invoice={id,customer_id:uid,kind:'membership',status:'requested',version:1,request_data:{items:[{name:'VIP',id:'membership-vip',size:'365 days',qty:1,unit_price_usd_cents:4900}]}};const db=dbFor(invoice);await assert.rejects(issueInvoice(db,{id,action:'preview',version:1,method_id:id,shipping_cents:0}),e=>e.status===409);await assert.rejects(issueInvoice(db,{id,action:'issue',version:1,method_id:id,shipping_cents:0}),e=>e.status===409);});
test('unauthenticated admin cannot access payment receivers or execute writes',async()=>{let calls=0;const r=res();await handle({method:'GET',headers:{}},r,new URLSearchParams({commerce:'admin'}),{env:{ADMIN_ORDERS_PASSWORD:'x'.repeat(40)},db:{from(){calls++;}}});assert.equal(r.code,401);assert.equal(calls,0);});
test('invoice request ownership and regular catalog prices come from the server; legacy membership requests stay blocked',async()=>{
 let args,calls=0;const db={rpc:async(name,a)=>{calls++;args=a.p_data;return{data:{id,status:'requested'}};}};
 const b={id,customer_id:'forged',kind:'goods',items:[{id:'sample',size:'10mg',qty:1,price:.01}],address:{line1:'123 Test Street',city:'Test City',region:'NY',postal_code:'10001',country:'US'},research_use:true,consent:true,terms_version:'launch-2026-11-v1',name:'Owner'};
 await requestInvoice(db,{id:uid,email:'OWNER@example.test'},b,catalog);assert.equal(args.customer_id,uid);assert.equal(args.customer_email,'owner@example.test');assert.equal(args.request.items[0].unit_price_usd_cents,6000);assert.match(args.digest,/^[a-f0-9]{64}$/);
 for(const [unsupported,status] of [[{kind:'membership',plan:'vip'},409],[{kind:'membership',plan:'elite',billing_period:'annual'},409],
  [{research_builder:true},409],[{subscription:true},409],[{automatic_renewal:true},409],[{billing_period:'monthly'},400],[{plan:'vip'},400]])
  await assert.rejects(requestInvoice(db,{id:uid,email:'OWNER@example.test'},{...b,...unsupported},catalog),error=>error.status===status);
 assert.equal(calls,1,'Unsupported manual requests must fail before creating a record');
});
test('bank and card invoices share regular merchandise prices and tax basis',async()=>{
 const invoice={id,customer_id:uid,kind:'goods',status:'requested',version:1,request_data:{address:{country:'CA',region:'ON'},items:lines(1)}};
 const delivery_tax={...reviewFixture,destination_country:'CA',destination_region:'ON',tax_mode:'canada_taxable_goods',canada_supply_confirmed:true,gst_hst_number:'123456789RT0001',shipping_taxable:true,delivery:{...reviewFixture.delivery,origin_country:'CA',origin_region:'ON'}};
 const input={id,action:'preview',version:1,method_id:id,shipping_cents:1000,fx_ppm:1000000,delivery_tax,fulfillment_confirmed:true,review_note:'Fixture shipping and tax confirmed.'};
 const bank=await issueInvoice(dbFor(invoice,{...method,currency:'CAD'}),input);
 const card=await issueInvoice(dbFor(invoice,{...method,kind:'hosted_link',currency:'CAD'}),{...input,payment_discount:{amount_cents:99999}});
 assert.equal(bank.discount_cents,0);assert.equal(bank.pricing.payment_discount,undefined);assert.equal(bank.tax_cents,910);assert.equal(bank.total_cents,7910);assert.equal(card.total_cents,bank.total_cents);
 await assert.rejects(issueInvoice(dbFor(invoice,{...method,currency:'CAD'}),{...input,action:'issue',expected_total_cents:7571}),e=>e.status===409);
});
test('legacy bank helper cannot introduce discounts or mutate existing snapshots',()=>{
 const {applyBankDiscount}=require('../lib/bank-transfer-discount');
 for(const kind of ['goods','membership'])for(const rail of ['bank_transfer','interac','hosted_link']){
  const pricing={subtotal_cents:10001,discount_cents:1000};const original=structuredClone(pricing);assert.equal(applyBankDiscount(pricing,{...method,kind:rail},kind),pricing);assert.deepEqual(pricing,original);
 }
});
