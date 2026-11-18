'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { issueInvoice } = require('../lib/manual-commerce');

const source = fs.readFileSync(path.join(__dirname, '../interac-invoice-admin.js'), 'utf8');
const fulfillmentSource = fs.readFileSync(path.join(__dirname, '../admin-fulfillment.js'), 'utf8');
const id = '11111111-1111-4111-8111-111111111111';
const methodId = '22222222-2222-4222-8222-222222222222';
const otherId = '33333333-3333-4333-8333-333333333333';
const clone = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function fixture() {
  return {
    id, kind: 'goods', status: 'requested', version: 3, customer_name: 'Fixture Research', customer_email: 'fixture@example.test', created_at: '2026-11-18T12:00:00Z',
    request_data: {
      items: [{ id: 'tirzepatide', name: 'Tirzepatide', size: '60mg', qty: 1, unit_price_usd_cents: 10000 }],
      address: { line1: '123 Fixture Street', city: 'Toronto', region: 'ON', country: 'CA', postal_code: 'M5V 1A1' },
      preferred_payment: { method_id: methodId, provider_key: 'interac', label: 'Interac', currency: 'CAD' },
      checkout: { coupon: 'BLACKFRIDAY15', delivery: { shipping: 'express', extras: ['priority', 'protection'] }, payment_kind: 'interac', request_only: true, points: 0, credit_cents: 0, usd_estimate: { currency: 'USD', subtotal_cents: 10000, discount_cents: 1500, coupon_discount_cents: 1500, shipping_cents: 1995, tax_cents: 0, total_cents: 10495 } }
    }
  };
}
function harness(t, options = {}) {
  const dom = new JSDOM('<!doctype html><body><div id="host"></div><div id="fulfillment-hub"></div></body>', { url: 'https://pure.example.test/admin-orders.html', runScripts: 'outside-only' });
  const { window } = dom, host = window.document.getElementById('host');
  t.after(() => { window.AltaFulfillment?.clear(); window.close(); });
  const order = options.order || fixture(), calls = [], issued = [], controls = { previewGate: null };
  const methods = options.methods || [
    { id: methodId, version: 4, label: 'Approved Interac', active: true, kind: 'interac', provider_key: 'interac', currency: 'CAD', sale_scope: 'goods', payee: 'PRIVATE-PAYEE-FIXTURE', instructions: 'PRIVATE-RECEIVING-INSTRUCTIONS-FIXTURE' },
    { id: otherId, version: 2, label: 'Other approved Interac', active: true, kind: 'interac', provider_key: 'interac', currency: 'CAD', sale_scope: 'both' },
    { id: 'inactive', version: 1, label: 'Inactive Interac', active: false, kind: 'interac', provider_key: 'interac', currency: 'CAD', sale_scope: 'goods' },
    { id: 'usd', version: 1, label: 'USD wire', active: true, kind: 'bank_transfer', currency: 'USD' }
  ];
  const preferences = { version: 1, sender: { company: 'PURE fixture', name: 'Fixture sender', country: 'CA', state: 'ON', street1: 'Private fixture return address' } };
  const row = () => ({ ...clone(order), source: 'commerce', commerce_status: order.status, fulfillment_status: 'unfulfilled', payment_status: 'pending', order_number: 'ORD-11111111', total_cents: order.total_cents || 0, currency: order.currency || 'USD' });
  const db = { from(table) { return { select() { return this; }, eq(key, value) { this.value = value; return this; }, async single() { return { data: table === 'commerce_invoices' ? clone(order) : clone(methods.find(item => item.id === this.value)), error: null }; } }; } };
  window.fetch = () => { throw Error('Unexpected external request'); };
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  const api = async (url, init = {}) => {
    const parsed = new URL(url, window.location.href), body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, method: init.method || 'GET', body, headers: init.headers });
    if (!body) {
      if (parsed.searchParams.get('view') === 'methods') return { methods: clone(methods) };
      if (parsed.searchParams.get('view') === 'shipping-preferences') return { preferences: clone(preferences) };
      if (parsed.searchParams.get('lotus') === 'admin') return { order: clone(order), allocations: [], jobs: [], history: [], manual_payment_allowed: false };
      if (parsed.pathname === '/api/admin-orders') return { orders: [row()], pagination: { total: 1 } };
      throw Error('Unexpected read: ' + url);
    }
    assert.equal(parsed.searchParams.get('commerce'), 'admin'); assert.equal(parsed.searchParams.get('view'), 'write');
    assert.equal(init.method, 'POST'); assert.equal(init.headers['Content-Type'], 'application/json');
    assert.ok(['preview', 'issue'].includes(body.action), 'UI may only preview or issue, never record payment or change methods');
    const result = await issueInvoice(db, body);
    if (body.action === 'preview' && controls.previewGate) await controls.previewGate;
    if (body.action === 'issue') Object.assign(order, result, { status: 'issued', version: order.version + 1 });
    return clone(result);
  };
  window.eval(source);
  if (options.fulfillment) {
    window.eval(fulfillmentSource); window.AltaFulfillment.mount(api);
  } else window.PureInteracInvoiceAdmin.mount({ host, order, api, onIssued: result => { issued.push(result); }, onRefresh: () => { controls.reloaded = true; } });
  return { window, host, order, methods, calls, issued, controls, preferences, row, api };
}
function input(h, name) { const control = h.window.document.querySelector('.pica-panel [name="' + name + '"]'); assert.ok(control, name + ' exists'); return control; }
function set(h, name, value) { const control = input(h, name); if (control.type === 'checkbox') control.checked = value; else control.value = value; control.dispatchEvent(new h.window.Event(control.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }
function button(h, text) { return [...h.window.document.querySelectorAll('.pica-panel button')].find(node => node.textContent === text); }
function posts(h, action) { return h.calls.filter(call => call.body?.action === action); }
async function fill(h, overrides = {}) {
  await tick();
  for (const [name, value] of Object.entries({ fx: '1.35', shipping: '20.00', origin_country: 'CA', origin_region: 'ON', carrier: 'Fixture carrier', service: 'Ground', handling_max_days: '2', transit_min_days: '2', transit_max_days: '5', quote_reference: 'FIXTURE-QUOTE', quote_expires_at: '2099-01-01T12:00', duties: 'domestic', route_review: 'Fixture product and route eligibility reviewed.', tax_mode: 'reviewed', tax_basis: 'Fixture documented no-collection treatment.', review_note: 'Fixture FX source, delivery, tax and exact items reviewed.', ...overrides })) set(h, name, value);
  set(h, 'jurisdictions_reviewed', true); set(h, 'fulfillment_confirmed', true);
}
async function preview(h) { h.window.document.querySelector('.pica-form').dispatchEvent(new h.window.Event('submit', { bubbles: true, cancelable: true })); await tick(); }
function issueButton(h) { return h.window.document.querySelector('.pica-issue button'); }

test('only requested Interac orders mount the review; estimates and approved method labels reveal no receiving instructions', async t => {
  const h = harness(t); await tick();
  assert.match(h.host.textContent, /Requested USD estimate.*USD\s+104\.95/s);
  assert.match(h.host.textContent, /BLACKFRIDAY15/); assert.match(h.host.textContent, /Express delivery · Priority processing · Shipping protection/);
  assert.equal(input(h, 'fx').value, ''); assert.equal(input(h, 'shipping').value, ''); assert.equal(input(h, 'carrier').value, '');
  assert.equal(input(h, 'fulfillment_confirmed').checked, false); assert.equal(input(h, 'jurisdictions_reviewed').checked, false);
  assert.deepEqual([...input(h, 'method_id').options].map(option => option.value), ['', methodId]);
  assert.doesNotMatch(h.host.textContent, /PRIVATE-PAYEE|PRIVATE-RECEIVING|Private fixture return address/);
  assert.equal(h.calls.some(call => call.method !== 'GET'), false);
  for (const order of [{ ...fixture(), status: 'issued' }, { ...fixture(), cancellation_status: 'pending' }, { ...fixture(), request_data: { ...fixture().request_data, preferred_payment: { provider_key: 'zelle' } } }]) {
    const other = harness(t, { order }); await tick(); assert.equal(other.host.children.length, 0); assert.equal(other.calls.length, 0);
  }
});

test('the existing Orders list exposes the review action and never presents an unissued CAD request as a zero-dollar total', async t => {
  const h = harness(t, { fulfillment: true }); await tick();
  const row = h.window.document.querySelector('.uc-order-row'); assert.match(row.textContent, /CAD quote pending/); assert.match(row.textContent, /104\.95 USD estimate/);
  assert.equal(row.querySelector('button').textContent, 'Review CAD invoice');
  await h.window.AltaFulfillment.manage(h.row()); await tick();
  const dialog = h.window.document.querySelector('dialog'); assert.ok(dialog.querySelector('.pica-panel')); assert.equal(dialog.querySelector('.uc-total'), null);
  assert.match(dialog.querySelector('.uc-info').textContent, /USD request estimate\$104\.95 USD/);
  assert.doesNotMatch(dialog.querySelector('.uc-payment').textContent, /Mark payment received|Awaiting confirmed payment/);
});

test('a requested method with the wrong provider, native provider, currency or sale scope is never offered', async t => {
  for (const patch of [{ provider_key: 'wire' }, { native_provider: 'provider' }, { currency: 'USD' }, { sale_scope: 'membership' }]) {
    const h = harness(t, { methods: [{ id: methodId, version: 1, label: 'Fixture method', active: true, kind: 'interac', provider_key: 'interac', currency: 'CAD', sale_scope: 'goods', ...patch }] }); await tick();
    assert.deepEqual([...input(h, 'method_id').options].map(option => option.value), ['']);
    assert.equal(button(h, 'Preview CAD invoice').disabled, true); assert.equal(h.calls.some(call => call.body), false);
  }
});

test('required review fields prevent requests and open the collapsed section that needs completion', async t => {
  const h = harness(t); await tick(); set(h, 'fx', '1.35'); set(h, 'shipping', '0');
  await preview(h); assert.equal(posts(h, 'preview').length, 0);
  assert.equal(h.host.querySelector('.pica-review').open, true); assert.match(h.host.querySelector('[role=alert]').textContent, /Complete the highlighted/);
  await fill(h, { quote_expires_at: '2001-01-01T12:00' }); await preview(h);
  assert.equal(posts(h, 'preview').length, 0); assert.match(h.host.textContent, /current carrier quote with a future expiry/);
});

test('reviewed preview and explicit issuance preserve versions, complete server tax review and exact final CAD amount', async t => {
  const h = harness(t); await fill(h, { tax_basis: 'Fixture documented no-collection treatment.\nDestination obligations reviewed.', route_review: 'Fixture product eligibility reviewed.\nCarrier route confirmed.' }); await preview(h);
  const request = posts(h, 'preview')[0].body;
  assert.equal(request.version, 3); assert.equal(request.expected_method_version, 4); assert.equal(request.fx_ppm, 1350000); assert.equal(request.shipping_cents, 2000);
  assert.equal(request.delivery_tax.confirmed, true); assert.equal(request.delivery_tax.jurisdictions_reviewed, true); assert.equal(request.delivery_tax.destination_country, 'CA');
  assert.equal(request.delivery_tax.delivery.carrier, 'Fixture carrier'); assert.deepEqual(request.delivery_tax.components, []);
  assert.equal(request.delivery_tax.tax_mode, 'reviewed'); assert.equal(request.fulfillment_confirmed, true);
  assert.equal(request.coupon, undefined, 'the server uses the saved coupon, not an editable client discount');
  assert.match(h.host.querySelector('.pica-preview').textContent, /Final amountCAD\s+134\.75/);
  assert.match(h.host.querySelector('.pica-preview').textContent, /BLACKFRIDAY15 included: −CAD\s+20\.25/);
  assert.equal(issueButton(h).disabled, true); issueButton(h).click(); await tick(); assert.equal(posts(h, 'issue').length, 0);
  set(h, 'issue_confirmed', true); input(h, 'issue_confirmed').dispatchEvent(new h.window.Event('change', { bubbles: true }));
  issueButton(h).click(); await tick();
  const issued = posts(h, 'issue')[0].body;
  assert.equal(issued.expected_total_cents, 13475); assert.equal(issued.expected_method_version, 4); assert.equal(issued.version, 3);
  assert.equal(h.issued.length, 1); assert.equal(h.order.status, 'issued'); assert.equal(h.order.version, 4);
  assert.match(h.host.textContent, /customer must accept it before viewing Interac instructions/);
  assert.equal(h.calls.some(call => call.body && !['preview', 'issue'].includes(call.body.action)), false);
});

test('editing any quote or payment method invalidates the preview, including edits while its response is pending', async t => {
  const h = harness(t); await fill(h); await preview(h); assert.equal(h.host.querySelector('.pica-preview').hidden, false);
  set(h, 'shipping', '21'); assert.equal(h.host.querySelector('.pica-preview').hidden, true); assert.equal(issueButton(h).disabled, true); assert.equal(input(h, 'fulfillment_confirmed').checked, false);
  set(h, 'fulfillment_confirmed', true); await preview(h); set(h, 'method_id', '');
  assert.equal(h.host.querySelector('.pica-preview').hidden, true); assert.equal(issueButton(h).disabled, true);
  let release; h.controls.previewGate = new Promise(resolve => { release = resolve; }); set(h, 'method_id', methodId); set(h, 'fulfillment_confirmed', true);
  const pending = preview(h); await tick(); set(h, 'fx', '1.40'); release(); await pending; await tick();
  assert.equal(h.host.querySelector('.pica-preview').hidden, true); assert.equal(h.host.querySelector('.pica-issue').hidden, true);
  assert.equal(posts(h, 'issue').length, 0);
});

test('a changed or deactivated receiving method blocks issuance and requires a new preview', async t => {
  for (const patch of [{ version: 5 }, { active: false }]) {
    const h = harness(t); await fill(h); await preview(h);
    set(h, 'issue_confirmed', true); input(h, 'issue_confirmed').dispatchEvent(new h.window.Event('change', { bubbles: true }));
    Object.assign(h.methods[0], patch); issueButton(h).click(); await tick();
    assert.equal(posts(h, 'issue').length, 0); assert.equal(h.host.querySelector('.pica-preview').hidden, true);
    assert.match(h.host.textContent, /Interac method changed/); assert.equal(issueButton(h).disabled, true);
  }
});

test('saved ship-from application copies only the dispatch location and leaves financial and carrier decisions unconfirmed', async t => {
  const h = harness(t); await tick(); button(h, 'Use saved ship-from profile').click();
  assert.equal(input(h, 'origin_country').value, 'CA'); assert.equal(input(h, 'origin_region').value, 'ON');
  for (const name of ['fx', 'shipping', 'carrier', 'service', 'quote_reference', 'quote_expires_at', 'duties', 'tax_mode']) assert.equal(input(h, name).value, '', name + ' stays blank');
  assert.equal(input(h, 'fulfillment_confirmed').checked, false); assert.equal(input(h, 'jurisdictions_reviewed').checked, false); assert.equal(posts(h, 'preview').length, 0);
});

test('Canadian GST/HST and additional tax rows are explicitly reviewed and use CAD integer values accepted by the server', async t => {
  const h = harness(t); await fill(h, { tax_mode: 'canada_taxable_goods', gst_hst_number: '123456789RT0001', shipping_taxable: 'yes' });
  set(h, 'canada_supply_confirmed', true); set(h, 'fulfillment_confirmed', true); await preview(h);
  const request = posts(h, 'preview')[0].body; assert.equal(request.delivery_tax.canada_supply_confirmed, true); assert.equal(request.delivery_tax.shipping_taxable, true);
  assert.match(h.host.querySelector('.pica-preview').textContent, /Final amountCAD\s+152\.27/);
  set(h, 'tax_mode', 'reviewed'); assert.equal(h.host.querySelector('.pica-canada').disabled, true);
  button(h, 'Add reviewed tax line').click();
  const controls = h.host.querySelectorAll('.pica-tax-line input');
  for (const [index, value] of ['Fixture tax', '7.1250', '114.75', 'Fixture collection authority'].entries()) { controls[index].value = value; controls[index].dispatchEvent(new h.window.Event('input', { bubbles: true })); }
  set(h, 'fulfillment_confirmed', true); await preview(h);
  const component = posts(h, 'preview')[1].body.delivery_tax.components[0];
  assert.deepEqual(component, { label: 'Fixture tax', rate_ppm: 71250, taxable_cents: 11475, registration_number: 'Fixture collection authority' });
  assert.equal(h.host.querySelector('.pica-preview').hidden, false);
});
