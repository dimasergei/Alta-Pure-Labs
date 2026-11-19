'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {JSDOM} = require('jsdom');
const config = require('../config/conversion.json');
const auth = {auth:{getSession:async()=>({data:{session:{access_token:'fixture_account_token_123456'}}})}};
function setup(payload,{ok=true}={}) {
  const dom = new JSDOM('<main id="root"></main>',{url:'https://pure.example/account/membership',runScripts:'outside-only'}),w=dom.window,calls=[];
  w.fetch=async(url,options)=>{calls.push({url,options});return {ok,json:async()=>payload};};
  w.eval(fs.readFileSync('membership-experience.js','utf8'));
  w.eval(fs.readFileSync('conversion-ui.js','utf8'));
  return {dom,w,root:w.document.getElementById('root'),calls};
}
test('active WHITE account shows the paid term and benefits without another purchase link',async()=>{
  const env=setup({membership:{plan:'vip',expires_at:'2099-12-31T00:00:00Z'},terms:{conversion:config}});
  await env.w.ConversionUI.mountMembership(env.root,auth);
  assert.match(env.root.querySelector('.cv-member-status h2').textContent,/PURE WHITE/);
  assert.match(env.root.querySelector('.cv-member-status').textContent,/5%/);
  assert.match(env.root.querySelector('.cv-member-status').textContent,/Current membership term/);
  assert.match(env.root.querySelector('.cv-program-note').textContent,/2099/);
  assert.equal(env.root.querySelectorAll('a[href^="/checkout?plan="]').length,0);
  assert.equal(env.calls[0].url,'/api/customer-config?checkout=account');
  assert.equal(env.calls[0].options.headers.Authorization,'Bearer fixture_account_token_123456');
  assert.equal(env.calls[0].options.cache,'no-store');
  assert.ok(env.root.querySelector('a[href="/membership-terms.html"]'));
  env.dom.window.close();
});
test('active BLACK account discloses credit qualification, BAC gift and priority',async()=>{
  const env=setup({membership:{plan:'elite',expires_at:'2099-12-31T00:00:00Z'},terms:{conversion:config}});
  await env.w.ConversionUI.mountMembership(env.root,auth);
  const card=env.root.querySelector('.cv-member-black');
  assert.match(card.textContent,/PURE BLACK/);
  assert.match(card.textContent,/10%/);
  assert.match(card.textContent,/US\$50 monthly credit after a qualifying US\$150\+ order/);
  assert.doesNotMatch(card.textContent,/Issued once per UTC calendar month|before points or store credit/);
  const creditTerms=card.querySelector('.mx-benefit-footnote');assert.ok(creditTerms);
  assert.equal(creditTerms.getAttribute('href'),'/membership-terms.html#pure-black-credit');
  assert.equal(creditTerms.getAttribute('aria-label'),'Read the PURE BLACK monthly credit terms');
  assert.equal(creditTerms.textContent,'†');
  assert.match(card.textContent,/BAC Water 3mL with each eligible product order/);
  assert.match(card.textContent,/Priority order fulfillment/);
  env.dom.window.close();
});
test('pending membership is awaiting payment, suppresses duplicate purchase links, and grants no paid benefits',async()=>{
  const id='11111111-1111-4111-8111-111111111111';
  const env=setup({membership:null,membership_pending:{invoice_id:id,plan:'elite',name:'PURE BLACK',billing_period:'annual',status:'awaiting_payment',currency:'CAD',total_cents:133426,expires_at:'2099-12-31T00:00:00Z'},terms:{conversion:config}});
  await env.w.ConversionUI.mountMembership(env.root,auth);
  const pending=env.root.querySelector('.cv-pending-membership');assert.ok(pending);
  assert.match(pending.textContent,/AWAITING PAYMENT/);assert.match(pending.textContent,/CAD\s*1,334\.26/);assert.match(pending.textContent,/One prepaid year/);
  assert.ok(pending.querySelector('a[href="/account/purchases?id='+id+'"]'));
  assert.equal(env.root.querySelector('.cv-member-status h2').textContent,'MEMBER');
  assert.equal(env.root.querySelector('.cv-member-status .cv-program-badge').textContent,'FREE ACCOUNT');
  assert.equal(env.root.querySelectorAll('a[href^="/checkout?plan="]').length,0);
  assert.doesNotMatch(env.root.querySelector('.cv-member-status').textContent,/10%|BAC Water|\$50 monthly credit/);
  env.dom.window.close();
});
test('expired or review-required pending membership stays blocked and directs the account to order review',async()=>{
 for(const flags of [{expired:true},{requires_review:true}]){
  const id='11111111-1111-4111-8111-111111111111',env=setup({membership:null,membership_pending:{invoice_id:id,plan:'vip',name:'PURE WHITE',billing_period:'monthly',currency:'USD',total_cents:1999,expires_at:'2099-12-31T00:00:00Z',...flags},terms:{conversion:config}});
  await env.w.ConversionUI.mountMembership(env.root,auth);
  const pending=env.root.querySelector('.cv-pending-membership');
  assert.match(pending.textContent,/Unpaid membership needs attention/);assert.match(pending.textContent,/If you sent payment, contact PURE/);
  assert.match(pending.querySelector('a[href="/account/purchases?id='+id+'"]').textContent,/Review membership order/);
  assert.doesNotMatch(pending.textContent,/Complete this payment before|Continue payment/);
  assert.equal(env.root.querySelectorAll('a[href^="/checkout?plan="]').length,0);
  assert.equal(env.root.querySelector('.cv-member-status h2').textContent,'MEMBER');
  env.dom.window.close();
 }
});
test('expired or revoked membership cannot appear as an active paid tier',async()=>{
  for (const membership of [{plan:'elite',expires_at:'2020-01-01T00:00:00Z'},{plan:'vip',expires_at:'2099-12-31T00:00:00Z',revoked_at:'2026-01-01T00:00:00Z'}]) {
    const env=setup({membership,terms:{conversion:config}});
    await env.w.ConversionUI.mountMembership(env.root,auth);
    assert.equal(env.root.querySelector('.cv-member-status h2').textContent,'MEMBER');
    assert.equal(env.root.querySelector('.cv-member-status .cv-program-badge').textContent,'FREE ACCOUNT');
    assert.equal(env.root.querySelectorAll('a[href^="/checkout?plan="]').length,2);
    env.dom.window.close();
  }
});
test('account API failures do not fabricate tier or subscription state',async()=>{
  const env=setup({error:'Sign in again to view this account.'},{ok:false});
  await env.w.ConversionUI.mountMembership(env.root,auth);
  assert.match(env.root.querySelector('[role="alert"]').textContent,/Sign in again/);
  assert.equal(env.root.querySelector('.cv-member-status'),null);
  await env.w.ConversionUI.subscriptions(env.root,auth);
  assert.match(env.root.querySelector('[role="alert"]').textContent,/Sign in again/);
  assert.equal(env.root.querySelector('.cv-research-empty'),null);
  env.dom.window.close();
});
test('empty research account introduces paid monthly invoices',async()=>{
  const env=setup({subscriptions:[],subscription_available:false,one_time_available:true});
  await env.w.ConversionUI.subscriptions(env.root,auth);
  assert.equal(env.root.querySelector('.cv-research-heading h2').textContent,'AUTO-STACK™');
  assert.match(env.root.querySelector('.cv-research-heading a').textContent,/Open Auto-Stack™/);
  assert.match(env.root.textContent,/No paid Auto-Stack™ plan is linked to your account/);
  assert.match(env.root.textContent,/Each month is paid by a new Card or Crypto invoice/);
  assert.match(env.root.querySelector('.cv-program-note').textContent,/Each month is paid by a new Card or Crypto invoice/);
  assert.doesNotMatch(env.root.querySelector('.cv-program-note').textContent,/automatic billing/);
  assert.match(env.root.querySelector('.cv-program-note').textContent,/Edit future selections or cancel anytime/);
  assert.equal(env.root.querySelector('.cv-research-plan'),null);
  assert.ok(env.root.querySelector('a[href="/research-builder"]'));
  assert.equal(env.calls[0].url,'/api/customer-config?research_builder=1&scope=mine');
  assert.ok(env.calls.every(call=>call.options.method==='GET'));
  env.dom.window.close();
});
test('research plan and cycle history come from account records, without unsupported billing mutations',async()=>{
  const env=setup({subscriptions:[{id:'fixture-plan',status:'active',monthly_cents:24000,paid_cycles:2,minimum_paid_cycles:3,first_delivery_shipped_at:'2026-01-02T00:00:00Z',next_billing_at:'2026-03-01T00:00:00Z',lines:[{id:'fixture',name:'<script>unsafe</script>',size:'5 mg',qty:1}],actions:[],research_subscription_cycles:[{cycle_number:1,amount_cents:24000,status:'shipped',paid_at:'2026-01-01T00:00:00Z',shipped_at:'2026-01-02T00:00:00Z',tracking_number:'TRACK-123'},{cycle_number:2,amount_cents:24000,status:'paid',paid_at:'2026-02-01T00:00:00Z'}]}]});
  await env.w.ConversionUI.subscriptions(env.root,auth);
  assert.match(env.root.textContent,/\$240\.00/);
  assert.equal(env.root.querySelector('.cv-research-details dd').textContent,'2','history shows paid cycles without presenting a legacy minimum as a current requirement');
  assert.doesNotMatch(env.root.textContent,/initial cycles|third delivery|follow the first shipment/);
  assert.match(env.root.querySelector('.cv-plan-support').textContent,/Pay the next month by a new invoice/);
  assert.match(env.root.textContent,/TRACK-123/);
  assert.equal(env.root.querySelectorAll('.cv-cycle-history li').length,2);
  assert.equal(env.root.querySelector('script'),null);
  assert.equal(env.root.querySelectorAll('[data-cv-renew],[data-cv-edit],[data-cv-cancel]').length,3);
  assert.equal(env.root.querySelector('a[href="/contact"]'),null);
  assert.ok(env.calls.every(call=>call.options.method==='GET'));
  env.dom.window.close();
});
