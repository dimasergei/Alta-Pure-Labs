'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(require.resolve('../admin-shipping-labels.js'), 'utf8');

const orderId = '10000000-0000-4000-8000-000000000001';
const labelId = '20000000-0000-4000-8000-000000000001';
const sender = { name: 'PURE Fixture', company: '', street1: '10 Example Lane', street2: '', city: 'Test City', state: 'NY', zip: '10001', country: 'US', phone: '2125550100', email: 'sender@example.test' };
const recipient = { name: 'Fixture Researcher', company: '', street1: '20 Research Road', street2: '', city: 'Test City', state: 'NY', zip: '10002', country: 'US', phone: '2125550101', email: 'researcher@example.test' };
const rates = [
  { id: 'ground-fixture', carrier: 'UPS', service: 'Ground', amount_cents: 625, currency: 'USD', estimated_days: 4 },
  { id: 'express-fixture', carrier: 'UPS', service: 'Next Day Air', amount_cents: 1250, currency: 'USD', estimated_days: 1 }
];
const tick = () => new Promise(resolve => setImmediate(resolve));
const clone = value => JSON.parse(JSON.stringify(value));

function harness(t, options = {}) {
  const dom = new JSDOM('<!doctype html><html><body><main id="host"></main></body></html>', { url: 'https://getpurelabs.com/admin-orders.html', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const { window } = dom, host = window.document.getElementById('host');
  const calls = [], confirmations = [];
  const state = {
    configured: true, test_mode: false, eligible: true, reason: null, sender: clone(sender), recipient: clone(recipient),
    currency: 'USD', shipping_service: 'Standard UPS (US)', items: [{ description: 'Synthetic research item', quantity: 2 }], labels: [],
    ...clone(options.state || {})
  };
  let quoted, purchaseStarted = false;
  const controls = { confirm: true };
  window.confirm = message => { confirmations.push(message); return controls.confirm; };
  window.fetch = () => { throw new Error('External network requests are forbidden in this DOM test.'); };
  const api = async (url, init = {}) => {
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, method, headers: init.headers, body });
    if (method === 'GET') {
      const parsed = new URL(url, window.location.href);
      assert.equal(parsed.searchParams.get('view'), 'shipping-label');
      assert.equal(parsed.searchParams.get('id'), orderId);
      assert.equal(parsed.searchParams.get('source'), 'commerce');
      if (purchaseStarted && options.afterPurchaseRead) return options.afterPurchaseRead(state);
      return clone(state);
    }
    assert.equal(method, 'PATCH');
    assert.equal(init.headers?.['Content-Type'], 'application/json', 'shipping mutations must pass the API JSON gate');
    assert.equal(body.id, orderId);
    assert.equal(body.source, 'commerce');
    if (body.action === 'shipping_label_quote') {
      quoted = { id: labelId, status: 'quoted', test: state.test_mode, sender: clone(body.sender), recipient: clone(state.recipient), parcel: clone(body.parcel), rates: clone(rates) };
      return { label: clone(quoted) };
    }
    if (body.action === 'shipping_label_buy') {
      purchaseStarted = true;
      const rate = rates.find(row => row.id === body.rate_id);
      const label = { ...quoted, rate, status: options.buyFails ? 'review' : 'created', transaction_id: options.buyFails ? null : 'provider-fixture', label_url: options.buyFails ? null : 'https://deliver.goshippo.com/fixture-label.pdf', tracking_number: options.buyFails ? null : 'FIXTURE-TRACKING' };
      state.labels = [label];
      if (options.buyFails) throw new Error('Purchase response was lost.');
      return { label: clone(label) };
    }
    if (body.action === 'shipping_label_refresh') return { label: clone(state.labels[0]) };
    throw new Error('Unexpected shipping mutation: ' + body.action);
  };
  window.eval(source);
  window.PureShippingLabels.mount({ host, row: { id: orderId, source: 'commerce', kind: 'goods' }, api });
  return { window, host, calls, confirmations, controls, state };
}

function field(h, label, scope = h.host) {
  const element = [...scope.querySelectorAll('label.psl-field')].find(node => node.querySelector('span')?.textContent === label);
  assert.ok(element, 'field exists: ' + label);
  return element.querySelector('input,select');
}
function button(h, text) { return [...h.host.querySelectorAll('button')].find(node => node.textContent === text); }
function submit(h, form) { form.dispatchEvent(new h.window.Event('submit', { bubbles: true, cancelable: true })); }
function setValue(h, input, value) { input.value = value; input.dispatchEvent(new h.window.Event('input', { bubbles: true })); }
async function open(h) { button(h, 'Generate shipping label').click(); await tick(); }
function fillParcel(h) { for (const [name, value] of [['Length', '6'], ['Width', '4'], ['Height', '2'], ['Packed weight', '1']]) field(h, name).value = value; }
async function quote(h) { fillParcel(h); submit(h, h.host.querySelector('.psl-form')); await tick(); }
function chooseRate(h, index = 1) {
  const radio = h.host.querySelectorAll('.psl-rates input[type=radio]')[index];
  radio.checked = true; radio.dispatchEvent(new h.window.Event('change', { bubbles: true }));
}
function approve(h) { h.host.querySelector('.psl-rates input[type=checkbox]').checked = true; }

test('unconfigured and cancellation-blocked orders cannot request quotes or purchase labels', async t => {
  for (const state of [
    { configured: false },
    { eligible: false, reason: 'Cancellation pending. Fulfillment remains on hold.' },
    { eligible: false, reason: 'Cancellation needs payment review. Fulfillment remains on hold.' }
  ]) {
    const h = harness(t, { state });
    assert.equal(h.calls.length, 0, 'mount does not contact a provider');
    await open(h);
    assert.equal(h.calls.length, 1);
    assert.equal(h.host.querySelector('.psl-form'), null);
    assert.equal(h.host.querySelector('.psl-rates'), null);
    assert.equal(button(h, 'Get shipping rates'), undefined);
    if (state.configured === false) assert.equal(h.host.querySelector('a').href, 'https://apps.goshippo.com/settings/api');
    else assert.ok(h.host.textContent.includes(state.reason));
    assert.equal(h.calls.filter(call => call.method !== 'GET').length, 0);
  }
});

test('domestic customs fields are hidden and disabled and cannot block a valid JSON quote', async t => {
  const h = harness(t); await open(h); fillParcel(h);
  const form = h.host.querySelector('.psl-form'), customs = h.host.querySelector('.psl-customs');
  assert.equal(customs.hidden, true);
  assert.equal(customs.disabled, true);
  for (const input of customs.querySelectorAll('[required]')) assert.equal(input.willValidate, false, 'hidden customs input is excluded from validation');
  assert.equal(form.checkValidity(), true);
  submit(h, form); await tick();
  const sent = h.calls.find(call => call.body?.action === 'shipping_label_quote');
  assert.equal(sent.headers['Content-Type'], 'application/json');
  assert.equal(sent.body.customs, null);
  assert.deepEqual(sent.body.parcel, { length: '6', width: '4', height: '2', weight: '1', distance_unit: 'in', mass_unit: 'lb' });
  assert.equal(h.confirmations.length, 0, 'requesting rates is not a postage purchase');
  assert.equal(form.hidden, true);
  assert.ok(h.host.querySelector('.psl-rates'));
});

test('international quotes require customs details and disable irrelevant country filing fields', async t => {
  const h = harness(t, { state: { recipient: { ...recipient, state: 'ON', zip: 'M5V 1A1', country: 'CA' } } });
  await open(h); fillParcel(h);
  const form = h.host.querySelector('.psl-form'), customs = h.host.querySelector('.psl-customs');
  assert.equal(customs.hidden, false); assert.equal(customs.disabled, false);
  assert.equal(form.checkValidity(), false);
  submit(h, form); await tick();
  assert.equal(h.calls.filter(call => call.method === 'PATCH').length, 0, 'incomplete declaration cannot request rates');
  for (const [name, value] of [
    ['Country of manufacture (2 letters)', 'US'], ['HS / tariff code', '3822190000'], ['Total declared value (USD)', '123.45'],
    ['Total net weight for this line', '0.25'], ['Person certifying the declaration', 'Fixture Operator'],
    ['US export filing reference or applicable exemption', 'SYNTHETIC-EXPORT-REFERENCE']
  ]) field(h, name).value = value;
  customs.querySelector('input[type=checkbox]').checked = true;
  const us = field(h, 'US export filing reference or applicable exemption');
  const ca = field(h, 'Canadian export filing option');
  assert.equal(us.required, true); assert.equal(us.disabled, false);
  assert.equal(ca.disabled, true); assert.equal(ca.closest('label').hidden, true);
  assert.equal(form.checkValidity(), true);
  submit(h, form); await tick();
  const sent = h.calls.find(call => call.body?.action === 'shipping_label_quote').body;
  assert.equal(sent.customs.certify, true);
  assert.equal(sent.customs.certify_signer, 'Fixture Operator');
  assert.equal(sent.customs.items[0].origin_country, 'US');
  assert.equal(sent.customs.items[0].value_amount, '123.45');
  assert.equal(sent.customs.items[0].net_weight, '0.25');
  button(h, 'Edit parcel or sender').click();
  setValue(h, field(h, 'Country code (US, CA, etc.)'), 'CA');
  assert.equal(customs.hidden, true); assert.equal(customs.disabled, true, 'matching origin/destination becomes domestic');
  assert.equal(us.disabled, true); assert.equal(us.required, false);
});

test('live postage requires a selected rate, checked review, and explicit amount confirmation', async t => {
  const h = harness(t); await open(h); await quote(h);
  const form = h.host.querySelector('.psl-rates');
  assert.match(h.host.textContent, /charged to your connected Shippo account/);
  submit(h, form); await tick(); assert.equal(h.confirmations.length, 0);
  chooseRate(h);
  assert.match(form.querySelector('button').textContent, /12\.50.*USD/);
  submit(h, form); await tick(); assert.equal(h.confirmations.length, 0, 'review checkbox is required');
  approve(h); h.controls.confirm = false;
  submit(h, form); await tick();
  assert.match(h.confirmations[0], /Buy this UPS label for \$12\.50 USD through Shippo/);
  assert.equal(h.calls.filter(call => call.body?.action === 'shipping_label_buy').length, 0, 'declining the confirmation does not buy');
  h.controls.confirm = true;
  submit(h, form); await tick();
  const bought = h.calls.find(call => call.body?.action === 'shipping_label_buy');
  assert.deepEqual(bought.body, { id: orderId, source: 'commerce', action: 'shipping_label_buy', label_id: labelId, rate_id: 'express-fixture', amount_cents: 1250, currency: 'USD', confirm_purchase: true });
  assert.equal(bought.headers['Content-Type'], 'application/json');
  assert.deepEqual(h.calls.filter(call => call.body).map(call => call.body.action), ['shipping_label_quote', 'shipping_label_buy'], 'buying postage does not mark an order shipped');
  assert.match(h.host.textContent, /Shipping label purchased/);
  assert.ok([...h.host.querySelectorAll('a')].some(a => a.textContent === 'Download 4 × 6 label'));
  assert.equal(h.host.querySelector('.psl-rates'), null);
  assert.equal(h.host.querySelector('.psl-form'), null, 'an existing current-mode label blocks duplicate purchase');
});

test('test mode is clearly labeled before confirmation and after generation', async t => {
  const h = harness(t, { state: { test_mode: true } });
  await open(h); assert.match(h.host.textContent, /TEST MODE.*cannot be used to ship/s);
  await quote(h);
  assert.match(h.host.textContent, /no live postage is purchased/);
  assert.doesNotMatch(h.host.textContent, /charged to your connected Shippo account/);
  chooseRate(h); approve(h);
  assert.equal(h.host.querySelector('.psl-rates button').textContent, 'Generate test label');
  submit(h, h.host.querySelector('.psl-rates')); await tick();
  assert.equal(h.confirmations[0], 'Generate this test label? It is not valid postage.');
  assert.match(h.host.textContent, /Test label generated/);
  assert.ok([...h.host.querySelectorAll('a')].some(a => a.textContent === 'Open test PDF'));
  assert.equal(h.calls.filter(call => call.body?.action === 'shipping_label_buy').length, 1);
});

test('an uncertain purchase removes the buy controls and refreshes saved state before offering another action', async t => {
  let resolveRead;
  const pendingRead = new Promise(resolve => { resolveRead = resolve; });
  const h = harness(t, { buyFails: true, afterPurchaseRead: () => pendingRead });
  await open(h); await quote(h); chooseRate(h); approve(h);
  submit(h, h.host.querySelector('.psl-rates')); await tick();
  assert.equal(h.calls.filter(call => call.body?.action === 'shipping_label_buy').length, 1);
  assert.equal(h.calls.at(-1).method, 'GET', 'the purchase outcome is refreshed after a failed transport');
  assert.equal(h.host.querySelector('.psl-rates'), null, 'the stale Buy button is removed while checking');
  assert.equal(h.host.querySelector('.psl-form').hidden, true, 'the original quote form is not re-offered while checking');
  assert.match(h.host.textContent, /Checking the purchase outcome/);
  resolveRead(clone(h.state)); await tick();
  assert.match(h.host.textContent, /Label purchase needs review/);
  assert.match(h.host.textContent, /repeat purchase is blocked/);
  assert.equal(h.host.querySelector('.psl-rates'), null);
  assert.equal(h.host.querySelector('.psl-form'), null);
  assert.ok(button(h, 'Check label status'));
  assert.equal(h.calls.filter(call => call.body?.action === 'shipping_label_buy').length, 1);
});
