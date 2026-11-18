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
  const calls = [], confirmations = [], opened = [];
  const availableRates = clone(options.rates || rates);
  const state = {
    configured: true, test_mode: false, quote_eligible: true, quote_reason: null, eligible: true, purchase_enabled: true, payment_confirmed: true, reason: null, sender: clone(sender), recipient: clone(recipient),
    currency: 'USD', shipping_service: 'Standard UPS (US)', items: [{ description: 'Synthetic research item', quantity: 2 }], labels: [],
    ...clone(options.state || {})
  };
  let quoted = state.current_quote ? clone(state.current_quote) : undefined, purchaseStarted = false;
  const controls = { confirm: true };
  window.open = (url, target, features) => { opened.push({ url, target, features }); return {}; };
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
      quoted = { id: labelId, status: 'quoted', test: state.test_mode, sender: clone(body.sender), recipient: clone(state.recipient), parcel: clone(body.parcel), rates: clone(availableRates), expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString() };
      state.current_quote = clone(quoted);
      state.draft = { sender: clone(body.sender), parcel: clone(body.parcel), customs: clone(body.customs) };
      return { label: clone(quoted) };
    }
    if (body.action === 'shipping_label_buy') {
      purchaseStarted = true;
      if (options.buyReject) {
        if (options.onBuyReject) options.onBuyReject(state);
        throw new Error(options.buyReject);
      }
      const rate = availableRates.find(row => row.id === body.rate_id);
      const label = { ...quoted, created_at: '2026-11-18T12:00:00Z', rate, status: options.buyFails ? 'review' : 'created', transaction_id: options.buyFails ? null : 'provider-fixture', label_url: options.buyFails ? null : 'https://deliver.goshippo.com/fixture-label.pdf', tracking_number: options.buyFails ? null : 'FIXTURE-TRACKING' };
      state.labels = [label]; state.current_quote = null;
      if (options.buyFails) throw new Error('Purchase response was lost.');
      return { label: clone(label) };
    }
    if (body.action === 'shipping_label_refresh' || body.action === 'shipping_label_reconcile') return { label: clone(state.labels[0]) };
    throw new Error('Unexpected shipping mutation: ' + body.action);
  };
  window.eval(source);
  window.PureShippingLabels.mount({ host, row: { id: orderId, source: 'commerce', kind: 'goods' }, api });
  return { window, host, calls, confirmations, controls, state, opened };
}

function field(h, label, scope = h.host) {
  const element = [...scope.querySelectorAll('label.psl-field')].find(node => node.querySelector('span')?.textContent === label);
  assert.ok(element, 'field exists: ' + label);
  return element.querySelector('input,select');
}
function button(h, text) { return [...h.host.querySelectorAll('button')].find(node => node.textContent === text); }
function submit(h, form) { form.dispatchEvent(new h.window.Event('submit', { bubbles: true, cancelable: true })); }
function setValue(h, input, value) { input.value = value; input.dispatchEvent(new h.window.Event('input', { bubbles: true })); }
async function open(h) { button(h, 'Get rates & manage labels').click(); await tick(); }
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
    { quote_eligible: false, eligible: false, reason: 'Cancellation pending. Fulfillment remains on hold.' },
    { quote_eligible: false, eligible: false, reason: 'Cancellation needs payment review. Fulfillment remains on hold.' }
  ]) {
    const h = harness(t, { state });
    assert.equal(h.calls.length, 0, 'mount does not contact a provider');
    await open(h);
    assert.equal(h.calls.length, 1);
    assert.equal(h.host.querySelector('.psl-form'), null);
    assert.equal(h.host.querySelector('.psl-rates'), null);
    assert.equal(button(h, 'Get shipping rates'), undefined);
    if (state.configured === false) assert.match(h.host.textContent, /Connect Shippo/);
    else assert.ok(h.host.textContent.includes(state.reason));
    assert.equal(h.calls.filter(call => call.method !== 'GET').length, 0);
  }
});

test('shipping configuration errors are visible without exposing quote or purchase controls', async t => {
  const error = 'The live shipping token does not match the selected mode.';
  const h = harness(t, { state: { configured: false, purchase_enabled: false, configuration_error: error } });
  await open(h);
  assert.equal(h.host.querySelector('[role=alert]').textContent, error);
  assert.equal(h.host.querySelector('.psl-form'), null);
  assert.equal(h.host.querySelector('.psl-rates'), null);
  assert.equal(h.calls.filter(call => call.method !== 'GET').length, 0);
});

test('disabled live purchases still allow rate review but reject forced purchase submission', async t => {
  const h = harness(t, { state: { purchase_enabled: false } });
  await open(h);
  assert.match(h.host.textContent, /LIVE MODE.*Live label purchases are disabled/s);
  await quote(h);
  assert.equal(h.calls.filter(call => call.body?.action === 'shipping_label_quote').length, 1);
  assert.match(h.host.textContent, /You can still review rates/);
  assert.match(h.host.textContent, /12\.50.*USD/);
  chooseRate(h); approve(h);
  const form = h.host.querySelector('.psl-rates'), buy = form.querySelector('button');
  assert.equal(buy.disabled, true);
  assert.equal(buy.textContent, 'Label purchases disabled');
  assert.equal(form.querySelector('input[type=checkbox]').disabled, true);
  buy.disabled = false;
  submit(h, form); await tick();
  assert.equal(h.confirmations.length, 0);
  assert.equal(h.calls.filter(call => call.body?.action === 'shipping_label_buy').length, 0);
  button(h, 'Edit parcel or sender').click();
  assert.equal(h.host.querySelector('.psl-form').hidden, false);
});

test('disabling live purchases leaves existing label reconciliation available', async t => {
  const h = harness(t, { state: { purchase_enabled: false, labels: [{ id: labelId, status: 'created', test: false, recipient, sender, rate: rates[0], transaction_id: 'provider-fixture', label_url: 'https://deliver.goshippo.com/fixture-label.pdf' }] } });
  await open(h);
  assert.equal(h.host.querySelector('.psl-form'), null);
  button(h, 'Refresh label link').click(); await tick();
  assert.equal(h.calls.filter(call => call.body?.action === 'shipping_label_refresh').length, 1);
  assert.equal(h.calls.filter(call => call.body?.action === 'shipping_label_buy').length, 0);
});

test('a Canadian sender defaults to metric parcel units while keeping both unit systems available', async t => {
  const h = harness(t, { state: { sender: { ...sender, state: 'ON', zip: 'M5V 1A1', country: 'CA' }, recipient: { ...recipient, state: 'ON', zip: 'M5V 1A1', country: 'CA' } } });
  await open(h);
  assert.equal(field(h, 'Country code (US, CA, etc.)').value, 'CA');
  assert.equal(field(h, 'Dimension unit').value, 'cm');
  assert.equal(field(h, 'Weight unit').value, 'g');
  assert.equal([...field(h, 'Dimension unit').options].some(option => option.value === 'in'), true);
  assert.equal([...field(h, 'Weight unit').options].some(option => option.value === 'lb'), true);
  assert.equal(h.host.querySelector('.psl-customs').disabled, true);
});

test('Canadian domestic customs stay hidden when the recipient country uses lowercase or surrounding whitespace', async t => {
  const h = harness(t, { state: { sender: { ...sender, state: 'ON', zip: 'M5V 1A1', country: 'CA' }, recipient: { ...recipient, state: 'ON', zip: 'M5V 1A1', country: ' ca ' } } });
  await open(h);
  const customs = h.host.querySelector('.psl-customs');
  assert.equal(customs.hidden, true);
  assert.equal(customs.disabled, true);
  await quote(h);
  assert.equal(h.calls.find(call => call.body?.action === 'shipping_label_quote').body.customs, null);
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
  assert.ok([...h.host.querySelectorAll('[role=alert]')].some(node => node.textContent === 'Purchase response was lost.'), 'the purchase error remains visible after the state refresh');
});

test('a purchase validation rejection stays visible after refreshing the safe current state', async t => {
  const message = 'The shipping connection changed. Get a fresh rate before purchasing.';
  const h = harness(t, { buyReject: message, onBuyReject: state => { state.purchase_enabled = false; } });
  await open(h); await quote(h); chooseRate(h); approve(h);
  submit(h, h.host.querySelector('.psl-rates')); await tick();
  assert.ok([...h.host.querySelectorAll('[role=alert]')].some(node => node.textContent === message));
  assert.equal(h.calls.at(-1).method, 'GET');
  assert.equal(h.host.querySelector('.psl-rates button').disabled, true);
  assert.equal(h.calls.filter(call => call.body?.action === 'shipping_label_buy').length, 1);
});

test('a failed state refresh after purchase cannot re-enable the stale Buy controls', async t => {
  const h = harness(t, { afterPurchaseRead: async () => { throw new Error('Shipping details are temporarily unavailable.'); } });
  await open(h); await quote(h); chooseRate(h); approve(h);
  submit(h, h.host.querySelector('.psl-rates')); await tick();
  assert.equal(h.calls.filter(call => call.body?.action === 'shipping_label_buy').length, 1);
  assert.equal(h.host.querySelector('.psl-rates'), null);
  assert.equal(h.host.querySelector('.psl-form').hidden, true);
  assert.match(h.host.textContent, /Shipping details are temporarily unavailable/);
  assert.ok(button(h, 'Refresh shipping details'));
});

test('refunded and unresolved labels cannot offer stale customs or label documents', async t => {
  for (const status of ['refunded', 'review', 'purchasing', 'failed']) {
    const h = harness(t, { state: { labels: [{ id: labelId, status, test: false, recipient, sender, rate: rates[0], transaction_id: 'provider-fixture', label_url: 'https://deliver.goshippo.com/stale-label.pdf', customs_url: 'https://deliver.goshippo.com/stale-customs.pdf' }] } });
    await open(h);
    assert.equal(h.host.querySelector('iframe'), null);
    assert.equal([...h.host.querySelectorAll('a')].some(a => a.href.includes('view=shipping-label-file')), false);
  }
});

test('an unpaid order can compare rates while payment confirmation is required to buy a label', async t => {
  const h = harness(t, { state: { quote_eligible: true, eligible: false, payment_confirmed: false, purchase_reason: 'Payment must be confirmed before purchasing a label.' } });
  await open(h);
  assert.match(h.host.textContent, /Awaiting payment/);
  assert.ok(h.host.querySelector('.psl-form'));
  await quote(h);
  assert.equal(h.calls.filter(call => call.body?.action === 'shipping_label_quote').length, 1);
  assert.equal(h.host.querySelectorAll('.psl-rate').length, 2);
  chooseRate(h); approve(h);
  const form = h.host.querySelector('.psl-rates'), buy = form.querySelector('button');
  assert.equal(buy.disabled, true);
  assert.equal(buy.textContent, 'Payment required to buy label');
  buy.disabled = false;
  submit(h, form); await tick();
  assert.equal(h.confirmations.length, 0);
  assert.equal(h.calls.filter(call => call.body?.action === 'shipping_label_buy').length, 0);
});

test('purchase controls fail closed unless payment, order eligibility, and configuration each explicitly allow purchase', async t => {
  for (const state of [{ payment_confirmed: undefined }, { eligible: undefined }, { purchase_enabled: undefined }, { payment_confirmed: false }, { eligible: false }]) {
    const h = harness(t);
    Object.assign(h.state, state);
    await open(h); await quote(h); chooseRate(h); approve(h);
    const form = h.host.querySelector('.psl-rates'), buy = form.querySelector('button');
    assert.equal(buy.disabled, true);
    buy.disabled = false;
    submit(h, form); await tick();
    assert.equal(h.confirmations.length, 0);
    assert.equal(h.calls.filter(call => call.body?.action === 'shipping_label_buy').length, 0);
  }
});

test('carrier comparison sorts prices within currency and fastest estimates put unknown transit last', async t => {
  const h = harness(t, { rates: [...rates,
    { id: 'canada-fixture', carrier: 'Canada Post', service: 'Expedited Parcel', amount_cents: 1100, currency: 'CAD', estimated_days: 3 },
    { id: 'unknown-fixture', carrier: 'DHL', service: 'Express', amount_cents: 1000, currency: 'USD', estimated_days: null }
  ] });
  await open(h); await quote(h);
  const ids = () => [...h.host.querySelectorAll('.psl-rates input[type=radio]')].map(input => input.value);
  assert.deepEqual(ids(), ['canada-fixture', 'ground-fixture', 'unknown-fixture', 'express-fixture']);
  const sort = field(h, 'Sort rates'); sort.value = 'fastest'; sort.dispatchEvent(new h.window.Event('change', { bubbles: true }));
  assert.deepEqual(ids(), ['express-fixture', 'canada-fixture', 'ground-fixture', 'unknown-fixture']);
  assert.match(h.host.textContent, /Transit estimate unavailable/);
  const carrier = field(h, 'Carrier'); carrier.value = 'UPS'; carrier.dispatchEvent(new h.window.Event('change', { bubbles: true }));
  assert.deepEqual(ids(), ['express-fixture', 'ground-fixture']);
  chooseRate(h, 0); approve(h);
  carrier.value = 'Canada Post'; carrier.dispatchEvent(new h.window.Event('change', { bubbles: true }));
  assert.deepEqual(ids(), ['canada-fixture']);
  assert.equal(h.host.querySelector('.psl-rates input[type=radio]').checked, false, 'hidden selected rate is cleared');
  assert.equal(h.host.querySelector('.psl-rates input[type=checkbox]').checked, false);
  submit(h, h.host.querySelector('.psl-rates')); await tick();
  assert.equal(h.confirmations.length, 0);
});

test('reopening the workspace restores the saved current quote and parcel draft without requesting rates again', async t => {
  const h = harness(t); await open(h); await quote(h);
  button(h, 'Hide shipping workspace').click(); await tick();
  assert.equal(h.host.querySelector('.psl-panel').hidden, true);
  assert.equal(button(h, 'Get rates & manage labels').getAttribute('aria-expanded'), 'false');
  await open(h);
  assert.ok(h.host.querySelector('.psl-rates'));
  assert.equal(h.host.querySelector('.psl-form').hidden, true);
  assert.match(h.host.textContent, /Quote expires/);
  button(h, 'Edit parcel or sender').click();
  assert.equal(field(h, 'Length').value, '6');
  assert.equal(field(h, 'Width').value, '4');
  assert.equal(field(h, 'Height').value, '2');
  assert.equal(field(h, 'Packed weight').value, '1');
  assert.equal(field(h, 'Street address').value, sender.street1);
  assert.equal(h.calls.filter(call => call.body?.action === 'shipping_label_quote').length, 1);
});

test('a saved international draft prefills customs details but requires a fresh certification', async t => {
  const customs = { certify: true, certify_signer: 'Fixture Operator', incoterm: 'DDU', eel_pfc: 'SAVED-REFERENCE', items: [{ description: 'Saved merchandise description', origin_country: 'US', tariff_number: '3822190000', value_amount: '123.45', net_weight: '0.25' }] };
  const h = harness(t, { state: { recipient: { ...recipient, country: 'CA', state: 'ON', zip: 'M5V 1A1' }, quote_notice: 'The previous quote expired. Your shipment details were restored.', draft: { sender, parcel: { length: '10', width: '8', height: '3', weight: '2', distance_unit: 'in', mass_unit: 'lb' }, customs } } });
  await open(h);
  assert.match(h.host.textContent, /previous quote expired/);
  assert.equal(field(h, 'Accurate customs description').value, 'Saved merchandise description');
  assert.equal(field(h, 'Country of manufacture (2 letters)').value, 'US');
  assert.equal(field(h, 'HS / tariff code').value, '3822190000');
  assert.equal(field(h, 'Total declared value (USD)').value, '123.45');
  assert.equal(field(h, 'Total net weight for this line').value, '0.25');
  assert.equal(field(h, 'Person certifying the declaration').value, 'Fixture Operator');
  assert.equal(field(h, 'US export filing reference or applicable exemption').value, 'SAVED-REFERENCE');
  assert.equal(h.host.querySelector('.psl-customs input[type=checkbox]').checked, false);
  submit(h, h.host.querySelector('.psl-form')); await tick();
  assert.equal(h.calls.filter(call => call.method === 'PATCH').length, 0);
});

test('refreshing after payment confirmation restores the draft and allows a fresh purchasable quote', async t => {
  const h = harness(t, { state: { eligible: false, payment_confirmed: false } });
  await open(h); await quote(h);
  assert.equal(h.host.querySelector('.psl-rates button').disabled, true);
  Object.assign(h.state, { eligible: true, payment_confirmed: true, purchase_reason: '', current_quote: null, quote_notice: 'The order or payment status changed. Get fresh shipping rates before creating a label.' });
  button(h, 'Refresh shipping details').click(); await tick();
  assert.match(h.host.textContent, /Payment confirmed/);
  assert.match(h.host.textContent, /Get fresh shipping rates/);
  assert.equal(h.host.querySelector('.psl-rates'), null);
  assert.equal(field(h, 'Length').value, '6');
  await quote(h);
  assert.equal(h.host.querySelector('.psl-rates button').disabled, false);
  assert.equal(h.calls.filter(call => call.body?.action === 'shipping_label_quote').length, 2);
  assert.equal(h.calls.filter(call => call.body?.action === 'shipping_label_buy').length, 0);
});

test('generated labels preview, download and print through authenticated PURE URLs with a postage record', async t => {
  const created = { id: labelId, status: 'created', test: false, recipient, sender, rate: rates[0], created_at: '2026-11-18T12:00:00Z', transaction_id: 'provider-fixture', tracking_number: 'FIXTURE-TRACKING', label_url: 'https://deliver.goshippo.com/private-signed-label', customs_url: 'https://deliver.goshippo.com/private-customs-file' };
  const h = harness(t, { state: { labels: [created] } }); await open(h);
  assert.match(h.host.textContent, /Postage record/);
  assert.match(h.host.textContent, /Transaction referenceprovider-fixture/);
  assert.match(h.host.textContent, /Tracking numberFIXTURE-TRACKING/);
  assert.match(h.host.textContent, /2026/);
  const frame = h.host.querySelector('iframe'); assert.ok(frame);
  const expected = { view: 'shipping-label-file', id: orderId, source: 'commerce', label_id: labelId, kind: 'label' };
  const parsed = new URL(frame.src);
  assert.equal(parsed.origin, 'https://getpurelabs.com');
  assert.deepEqual(Object.fromEntries(parsed.searchParams), expected);
  assert.match(frame.title, /4 × 6/);
  const links = [...h.host.querySelectorAll('a')];
  const download = new URL(links.find(a => a.textContent === 'Download 4 × 6 label').href);
  assert.deepEqual(Object.fromEntries(download.searchParams), { ...expected, download: '1' });
  const customs = new URL(links.find(a => a.textContent === 'Download customs invoice').href);
  assert.deepEqual(Object.fromEntries(customs.searchParams), { ...expected, kind: 'customs', download: '1' });
  assert.ok(!h.host.innerHTML.includes('private-signed-label'));
  assert.ok(!h.host.innerHTML.includes('private-customs-file'));
  assert.deepEqual(links.filter(a => new URL(a.href).hostname.includes('goshippo.com')).map(a => a.textContent), ['Manage Shippo billing']);
  let prints = 0;
  frame.contentWindow.focus = () => {};
  frame.contentWindow.print = () => { prints++; };
  frame.dispatchEvent(new h.window.Event('load'));
  button(h, 'Print label').click(); assert.equal(prints, 1);
  frame.contentWindow.print = () => { throw new Error('PDF viewer does not support embedded printing.'); };
  button(h, 'Print label').click();
  assert.equal(h.opened.length, 1);
  const fallback = new URL(h.opened[0].url, h.window.location.href);
  assert.equal(fallback.origin, 'https://getpurelabs.com');
  assert.deepEqual(Object.fromEntries(fallback.searchParams), expected);
  assert.equal(h.opened[0].features, 'noopener,noreferrer');
  assert.equal(h.calls.filter(call => call.body).length, 0, 'file actions do not purchase another label');
});

test('unknown purchases reconcile within PURE without a manually entered provider transaction', async t => {
  const h = harness(t, { state: { labels: [{ id: labelId, status: 'review', test: false, recipient, sender, rate: rates[0], transaction_id: '' }] } });
  await open(h);
  assert.equal(h.host.querySelector('input'), null);
  assert.match(h.host.textContent, /repeat purchase is blocked/);
  button(h, 'Check label status').click(); await tick();
  const sent = h.calls.find(call => call.body);
  assert.deepEqual(sent.body, { id: orderId, source: 'commerce', action: 'shipping_label_reconcile', label_id: labelId });
  assert.equal(h.calls.at(-1).method, 'GET');
  assert.equal(h.calls.filter(call => call.body?.action === 'shipping_label_buy').length, 0);
  assert.equal([...h.host.querySelectorAll('a')].some(a => a.textContent === 'Open Shippo'), false);
});

test('an expired saved quote cannot be purchased by a forced form submission', async t => {
  const h = harness(t, { state: { current_quote: { id: labelId, status: 'quoted', test: false, sender, recipient, rates, parcel: { length: '6', width: '4', height: '2', weight: '1', distance_unit: 'in', mass_unit: 'lb' }, expires_at: '2020-01-01T00:00:00Z' } } });
  await open(h); chooseRate(h); approve(h);
  const form = h.host.querySelector('.psl-rates'), buy = form.querySelector('button');
  assert.equal(buy.disabled, true);
  assert.equal(buy.textContent, 'Quote expired — get new rates');
  buy.disabled = false; submit(h, form); await tick();
  assert.equal(h.confirmations.length, 0);
  assert.equal(h.calls.filter(call => call.body).length, 0);
});
