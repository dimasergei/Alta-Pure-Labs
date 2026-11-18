'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {JSDOM} = require('jsdom');
const source = fs.readFileSync('membership-experience.js','utf8');
const config = () => ({
  memberships_enabled:true,
  membership_shipping_label:'Free US 2-Day Express shipping',
  plans:{
    member:{monthly_cents:0,annual_cents:0,points_per_dollar:2.5},
    vip:{monthly_cents:1999,annual_cents:19190,points_per_dollar:5,discount_bps:500,free_shipping:true,early_access:true},
    elite:{monthly_cents:9999,annual_cents:95990,points_per_dollar:10,discount_bps:1000,free_shipping:true,early_access:true,priority_fulfillment:true,monthly_credit_cents:5000,free_bac_water_3ml:true}
  }
});
function setup(path='/memberships',data=config()) {
  const dom = new JSDOM('<main id="ap-main"></main>',{url:'https://pure.example'+path,runScripts:'outside-only'});
  dom.window.AltaConversionConfig = data;
  dom.window.eval(source);
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  return dom;
}
test('PURE tier selection uses exact monthly and annual prices and retains keyboard focus',() => {
  const dom = setup(),d = dom.window.document;
  assert.equal(d.querySelectorAll('.mx-card').length,3);
  assert.match(d.querySelector('.mx-card-white').textContent,/PURE WHITE[\s\S]*\$19\.99/);
  assert.match(d.querySelector('.mx-card-black').textContent,/PURE BLACK[\s\S]*\$99\.99/);
  assert.equal(d.querySelector('.mx-card-white .mx-choose').getAttribute('href'),'/checkout?plan=vip&period=monthly');
  d.querySelector('[data-mx-period="annual"]').click();
  assert.match(d.querySelector('.mx-card-white').textContent,/\$191\.90/);
  assert.match(d.querySelector('.mx-card-black').textContent,/\$959\.90/);
  assert.equal(d.querySelector('.mx-card-black .mx-choose').getAttribute('href'),'/checkout?plan=elite&period=annual');
  assert.equal(d.activeElement.dataset.mxPeriod,'annual');
  assert.equal(d.activeElement.getAttribute('aria-pressed'),'true');
  assert.equal(d.querySelector('[data-mx-period="monthly"]').getAttribute('aria-pressed'),'false');
  assert.doesNotMatch(d.body.textContent,/GOLD|PLATINUM|BOGO/);
  dom.window.close();
});
test('benefits are sourced from configuration, with credit qualification disclosed only on BLACK',() => {
  const dom = setup(),d = dom.window.document;
  const white = d.querySelector('.mx-card-white'),black = d.querySelector('.mx-card-black');
  assert.match(white.textContent,/5% off eligible merchandise/);
  assert.match(white.textContent,/5 points per eligible \$1 spent/);
  assert.match(white.textContent,/Free US 2-Day Express shipping/);
  assert.doesNotMatch(white.textContent,/monthly credit|BAC Water/);
  assert.match(black.textContent,/\$50 monthly credit after a qualifying \$150\+ order/);
  assert.doesNotMatch(black.textContent,/Issued once per UTC calendar month|threshold uses eligible merchandise|before points or store credit/);
  const creditTerms=black.querySelector('.mx-benefit-footnote');
  assert.equal(creditTerms.textContent,'†');
  assert.equal(creditTerms.getAttribute('href'),'/membership-terms.html#pure-black-credit');
  assert.equal(creditTerms.getAttribute('aria-label'),'Read the PURE BLACK monthly credit terms');
  assert.equal(white.querySelector('.mx-benefit-footnote'),null);
  assert.match(black.textContent,/BAC Water 3mL with each eligible product order/);
  dom.window.close();
});
test('disabled enrollment never creates a paid membership checkout link',() => {
  const c = config();c.memberships_enabled = false;
  const dom = setup('/memberships',c),d = dom.window.document;
  assert.equal(d.querySelectorAll('a[href^="/checkout?plan="]').length,0);
  assert.equal(d.querySelectorAll('.mx-choose:disabled').length,2);
  assert.ok(d.querySelector('a[href="/account/signup"]'));
  dom.window.close();
});
test('automatic renewal is never implied by a single unverified flag',() => {
  const c = config();c.automatic_renewal = true;c.billing_mode = 'automatic_recurring';
  const dom = setup('/memberships',c),d = dom.window.document;
  assert.match(d.querySelector('.mx-terms').textContent,/No automatic renewal/);
  assert.match(d.querySelector('.mx-card-white .mx-billing-note').textContent,/One payment/);
  assert.doesNotMatch(d.querySelector('.mx-card-white').textContent,/Renews monthly/);
  dom.window.close();
});
test('account comparison prevents duplicate paid memberships while current tier is active',() => {
  const dom = setup('/account/membership'),w = dom.window,root = w.document.getElementById('ap-main');
  w.PureMemberships.mount(root,config(),{active:{plan:'vip'},context:'account'});
  assert.equal(root.querySelectorAll('a[href^="/checkout?plan="]').length,0);
  assert.match(root.querySelector('.mx-card-white').textContent,/YOUR CURRENT TIER/);
  assert.match(root.querySelector('.mx-card-black').textContent,/after your current paid term ends/);
  assert.ok(root.querySelector('a[href="/shop"]'));
  dom.window.close();
});
test('configuration labels are escaped before rendering',() => {
  const c = config();c.membership_shipping_label = '<img src=x onerror="alert(1)">';
  const dom = setup('/memberships',c),d = dom.window.document;
  assert.equal(d.querySelectorAll('.mx-features img').length,0);
  assert.match(d.querySelector('.mx-card-white').textContent,/<img src=x/);
  dom.window.close();
});
