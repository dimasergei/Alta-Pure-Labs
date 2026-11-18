'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const shipping = require('../lib/admin-shipping-labels');
const env = { SHIPPO_MODE: 'live', SHIPPO_API_TOKEN: 'shippo_live_fixture', SHIPPO_ALLOW_LIVE_PURCHASES: 'true' };
const rate = { id: 'a'.repeat(32), amount_cents: 825, currency: 'USD', carrier: 'UPS', service: 'Ground' };
function fixture() {
  const row = { id: randomUUID(), order_id: randomUUID(), source: 'commerce', status: 'quoted', test_mode: false, rate_options: [rate], recipient: {}, sender: {}, parcel: {} };
  const db = {
    from() {
      let change;
      const q = { select() { return q; }, eq() { return q; }, in() { return q; }, update(data) { change = data; return q; },
        async maybeSingle() { if (change) Object.assign(row, change); return { data: { ...row } }; },
        async single() { if (change) Object.assign(row, change); return { data: { ...row } }; } };
      return q;
    },
    async rpc(name, args) {
      if (name === 'pure_shipping_label_record') {
        Object.assign(row, args.p_result, { transaction_id: args.p_transaction, provider_status: args.p_provider_status, status: args.p_provider_status === 'SUCCESS' ? 'created' : args.p_provider_status === 'ERROR' ? 'failed' : 'purchasing' });
        return { data: { ...row } };
      }
      const claimed = row.status === 'quoted'; if (claimed) Object.assign(row, { status: 'purchasing', selected_rate: rate }); return { data: { claimed, label: { ...row } } };
    }
  };
  const input = { id: row.order_id, source: row.source, label_id: row.id, rate_id: rate.id, amount_cents: rate.amount_cents, currency: rate.currency, confirm_purchase: true };
  const transaction = { object_id: 'b'.repeat(32), rate: rate.id, metadata: 'pure-label:' + row.id, test: false, status: 'SUCCESS', tracking_number: '1Z12345', label_url: 'https://deliver.goshippo.com/label.pdf' };
  return { row, db, input, transaction };
}
test('purchase requires an explicit unchanged amount and charges once across repeated clicks', async () => {
  const { row, db, input, transaction } = fixture(); let charges = 0;
  const fetch = async (url, options) => { charges++; assert.equal(url, 'https://api.goshippo.com/transactions/'); assert.equal(options.headers.Authorization, 'ShippoToken shippo_live_fixture'); assert.equal(JSON.parse(options.body).label_file_type, 'PDF_4x6'); return { ok: true, json: async () => transaction }; };
  await assert.rejects(shipping.purchase(db, { ...input, confirm_purchase: false }, { env, fetch }), /confirm/);
  await assert.rejects(shipping.purchase(db, { ...input, amount_cents: 1 }, { env, fetch }), /price changed/);
  assert.equal(charges, 0);
  const first = await shipping.purchase(db, input, { env, fetch });
  const retry = await shipping.purchase(db, input, { env, fetch });
  assert.equal(charges, 1); assert.equal(first.label.status, 'created'); assert.equal(retry.label.status, 'created');
  assert.equal(row.tracking_number, '1Z12345'); assert.equal(first.label.sender !== undefined, true);
});
test('timeout retains a durable review state and never automatically retries a possible charge', async () => {
  const { row, db, input } = fixture(); let charges = 0;
  const fetch = async () => { charges++; throw new Error('timeout after provider received request'); };
  const result = await shipping.purchase(db, input, { env, fetch });
  assert.equal(row.status, 'review'); assert.equal(result.label.status, 'review');
  assert.match(row.message, /unconfirmed/); assert.match(row.message, /Check label status.*dashboard/);
  assert.doesNotMatch(row.message, /Check Shippo/); await shipping.purchase(db, input, { env, fetch }); assert.equal(charges, 1);
});
test('an explicit account rejection releases the claim without retrying the purchase', async () => {
  const { row, db, input } = fixture(); let calls = 0;
  const fetch = async () => { calls++; return { ok: false, status: 401, json: async () => ({ detail: 'Unauthorized' }) }; };
  const result = await shipping.purchase(db, input, { env, fetch });
  assert.equal(calls, 1); assert.equal(row.status, 'failed'); assert.equal(result.label.status, 'failed'); assert.match(row.message, /No label was purchased/);
});
test('reconciliation rejects another order, a different rate, and test/live mismatches', async () => {
  const { row, db, transaction } = fixture(); row.selected_rate = rate;
  for (const change of [{ metadata: 'pure-label:' + randomUUID() }, { test: true }, { rate: 'c'.repeat(32) }]) {
    await assert.rejects(shipping.recordTransaction(db, row, { ...transaction, ...change }), /does not match/);
  }
  assert.equal(row.status, 'quoted');
});
test('setup state, unsafe URLs, rate currencies and money rounding are explicit', () => {
  assert.equal(shipping.config({}).configured, false);
  assert.equal(shipping.config({ SHIPPO_API_KEY: 'shippo_test_fixture' }).test, true);
  assert.equal(shipping.safeUrl('javascript:alert(1)'), null);
  assert.equal(shipping.safeUrl('https://user:pass@example.test/label'), null);
  assert.equal(shipping.moneyCents('8.25'), 825); assert.equal(shipping.moneyCents('8.255'), null);
  const rates = shipping.ratesFrom({ rates: [{ object_id: rate.id, amount: '8.25', currency: 'USD', provider: 'UPS', servicelevel: { name: 'Ground' } }, { object_id: rate.id, amount: '1.00', currency: 'JPY' }] });
  assert.equal(rates.length, 1); assert.equal(rates[0].amount_cents, 825);
});
test('customs requires all physical lines and operator certification without guessing values or origins', () => {
  const context = { sheet: { ship_to: { country: 'CA' }, items: [{ total: 3 }] }, order: { currency: 'USD' } };
  const sender = { country: 'US' }, packed = { weight: '2', mass_unit: 'lb' };
  assert.throws(() => shipping.customs(null, context, sender, packed), /certify/);
  const entry = { description: 'Synthetic laboratory item', origin_country: 'US', tariff_number: '999999', value_amount: '40.50', net_weight: '1' };
  const declaration = { items: [entry], certify: true, certify_signer: 'Fixture Operator', eel_pfc: 'Operator-provided filing reference' };
  const result = shipping.customs(declaration, context, sender, packed);
  assert.equal(result.items[0].quantity, 3); assert.equal(result.items[0].value_amount, '40.50'); assert.equal(result.items[0].origin_country, 'US');
  assert.throws(() => shipping.customs({ ...declaration, items: [{ ...entry, net_weight: '3' }] }, context, sender, packed), /cannot exceed/);
  assert.equal(shipping.customs(null, context, { country: 'CA' }, packed), null);
});
test('legacy snapshots preserve empty database strings instead of changing them to null', () => {
  const snap = shipping.snapshot({ payment_status: 'paid', fulfillment_status: 'unfulfilled', shipping_address: {}, shipping_name: '', tracking_number: '' }, 'store');
  assert.equal(snap.shipping_name, ''); assert.equal(snap.tracking_number, '');
});
test('legacy label quotes can choose a missing service but still require a complete paid destination', async () => {
  const order = { id: randomUUID(), payment_status: 'paid', fulfillment_status: 'unfulfilled', customer_name: 'Fixture Recipient', customer_email: 'fixture@example.test', shipping_name: '', tracking_number: '',
    shipping_address: { line1: '100 Example Street', city: 'Example City', state: 'CA', postal_code: '90000', country: 'US' },
    store_order_items: [{ product_name: 'Fixture merchandise', variant_size: '10mg', quantity: 1 }] };
  const db = { from(table) { const q = { select() { return q; }, eq() { return q; }, neq() { return q; }, in() { return q; }, order() { return q; }, limit() { return q; }, async maybeSingle() { return { data: order }; }, then(resolve) { return Promise.resolve({ data: table === 'admin_shipping_labels' ? [] : order }).then(resolve); } }; return q; } };
  let state = await shipping.state(db, { id: order.id, source: 'store' }, { env });
  assert.equal(state.eligible, true); assert.equal(state.quote_eligible, true); assert.equal(state.payment_confirmed, true); assert.match(state.shipping_service, /Not recorded/);
  order.shipping_address.line1 = '';
  state = await shipping.state(db, { id: order.id, source: 'store' }, { env }); assert.equal(state.eligible, false); assert.equal(state.quote_eligible, false);
  order.shipping_address.line1 = '100 Example Street'; order.payment_status = 'pending';
  state = await shipping.state(db, { id: order.id, source: 'store' }, { env }); assert.equal(state.eligible, false); assert.equal(state.quote_eligible, true); assert.equal(state.payment_confirmed, false);
});
test('saved test/live token names require explicit matching modes and never fall back to live', () => {
  const both = { SHIPPO_TEST_TOKEN: 'shippo_test_fixture', SHIPPO_API_TOKEN: 'shippo_live_fixture' };
  let c = shipping.config(both);
  assert.equal(c.mode, 'test'); assert.equal(c.key, both.SHIPPO_TEST_TOKEN); assert.equal(c.purchaseEnabled, true);
  c = shipping.config({ ...both, SHIPPO_MODE: 'live' });
  assert.equal(c.key, both.SHIPPO_API_TOKEN); assert.equal(c.configured, true); assert.equal(c.purchaseEnabled, false);
  assert.equal(shipping.config({ ...both, SHIPPO_MODE: 'live', SHIPPO_ALLOW_LIVE_PURCHASES: 'true' }).purchaseEnabled, true);
  for (const invalid of [
    { SHIPPO_API_TOKEN: 'shippo_live_fixture' },
    { SHIPPO_TEST_TOKEN: 'shippo_live_fixture', SHIPPO_API_TOKEN: 'shippo_live_fixture' },
    { ...both, SHIPPO_MODE: 'production' },
    { SHIPPO_MODE: 'live', SHIPPO_API_KEY: 'shippo_test_fixture' },
    { SHIPPO_MODE: 'live', SHIPPO_API_TOKEN: 'bad', SHIPPO_API_KEY: 'shippo_live_fixture' }
  ]) assert.equal(shipping.config(invalid).configured, false);
  assert.equal(shipping.config({ SHIPPO_API_KEY: 'shippo_test_fixture' }).configured, true);
  assert.equal(shipping.config({ SHIPPO_MODE: 'live', SHIPPO_API_KEY: 'shippo_live_fixture' }).configured, true);
});
test('live purchase gate prevents both the durable claim and the provider transaction', async () => {
  const { db, input } = fixture(); let claims = 0, calls = 0;
  db.rpc = async () => { claims++; throw new Error('must not claim'); };
  const options = { env: { ...env, SHIPPO_ALLOW_LIVE_PURCHASES: 'false' }, fetch: async () => { calls++; throw new Error('must not request'); } };
  await assert.rejects(shipping.purchase(db, input, options), /Live label purchases are disabled/);
  await assert.rejects(shipping.shippo('/transactions/', { rate: rate.id }, options), /Live label purchases are disabled/);
  assert.equal(claims, 0); assert.equal(calls, 0);
  const read = await shipping.shippo('/carrier_accounts/', null, { ...options, fetch: async (_, request) => {
    assert.equal(request.method, 'GET'); return { ok: true, json: async () => ({ results: [] }) };
  } });
  assert.deepEqual(read, { results: [] });
});
test('Canadian domestic customs is case-insensitive', () => {
  assert.equal(shipping.customs(null, { sheet: { ship_to: { country: 'ca' } } }, { country: 'CA' }, {}), null);
});
test('existing test labels can be refreshed read-only after switching production to live', async () => {
  const { row, db, input, transaction } = fixture();
  Object.assign(row, { test_mode: true, status: 'created', selected_rate: rate, transaction_id: transaction.object_id });
  const result = await shipping.handleAction(db, { ...input, action: 'shipping_label_refresh' }, {
    env: { ...env, SHIPPO_TEST_TOKEN: 'shippo_test_fixture' },
    fetch: async (_, request) => {
      assert.equal(request.method, 'GET'); assert.equal(request.headers.Authorization, 'ShippoToken shippo_test_fixture');
      return { ok: true, json: async () => ({ ...transaction, test: true }) };
    }
  });
  assert.equal(result.label.test, true); assert.equal(result.label.status, 'created');
});

function quoteFixture(source = 'commerce', overrides = {}) {
  const destination = { name: 'Fixture Recipient', line1: '100 Example Street', city: 'Toronto', region: 'ON', postal_code: 'M5H 2N2', country: 'CA' };
  const order = source === 'commerce'
    ? { id: randomUUID(), kind: 'goods', status: 'accepted', version: 2, customer_name: 'Fixture Recipient', customer_email: 'recipient@example.test', tracking_number: '', currency: 'CAD',
      request_data: { name: 'Fixture Recipient', address: destination, items: [{ id: 'fixture-product', name: 'Fixture merchandise', size: '10mg', qty: 1 }] }, ...overrides }
    : { id: randomUUID(), payment_status: 'pending', fulfillment_status: 'unfulfilled', customer_name: 'Fixture Recipient', customer_email: 'recipient@example.test', shipping_name: '', tracking_number: '', currency: 'CAD',
      shipping_address: destination, store_order_items: [{ product_name: 'Fixture merchandise', variant_size: '10mg', quantity: 1 }], ...overrides };
  const labels = [], calls = [], rpcCalls = [], reads = [];
  const db = {
    from(table) {
      let filters = [], count = Infinity, inserted;
      const rows = () => {
        const values = table === 'admin_shipping_labels' ? labels : ['commerce_invoices', 'store_orders'].includes(table) ? [order] : [];
        return values.filter(row => filters.every(matches => matches(row))).slice(0, count);
      };
      const q = {
        select() { return q; }, eq(key, value) { filters.push(row => row[key] === value); return q; },
        neq(key, value) { filters.push(row => row[key] !== value); return q; },
        in(key, values) { filters.push(row => values.includes(row[key])); return q; }, order() { return q; }, limit(value) { count = value; return q; },
        insert(row) { inserted = { ...JSON.parse(JSON.stringify(row)), created_at: new Date().toISOString() }; labels.unshift(inserted); return q; },
        async maybeSingle() { return { data: rows()[0] || null }; }, async single() { return { data: inserted || rows()[0] || null }; },
        then(resolve) { reads.push({ table, limit: count }); return Promise.resolve({ data: rows() }).then(resolve); }
      };
      return q;
    },
    async rpc(name, args) { rpcCalls.push({ name, args }); return { error: { message: 'Order is not ready to ship' } }; }
  };
  const fetch = async (url, request) => {
    calls.push({ url, request });
    assert.equal(url, 'https://api.goshippo.com/shipments/', 'rate preview must never create a transaction');
    assert.equal(request.method, 'POST');
    return { ok: true, json: async () => ({ object_id: 'd'.repeat(32), test: false,
      rates: [{ object_id: rate.id, amount: '8.25', currency: 'CAD', provider: 'Canada Post', servicelevel: { name: 'Expedited Parcel' } }] }) };
  };
  const input = { id: order.id, source, action: 'shipping_label_quote',
    sender: { name: 'PURE Fixture', street1: '200 Example Road', city: 'Ottawa', state: 'ON', zip: 'K1P 1J1', country: 'CA', phone: '6135550100', email: 'sender@example.test' },
    parcel: { length: '20', width: '15', height: '10', distance_unit: 'cm', weight: '500', mass_unit: 'g' } };
  return { order, labels, calls, rpcCalls, reads, db, input, options: { env, fetch } };
}

test('unpaid physical orders can compare rates without creating a label or claiming payment', async () => {
  for (const source of ['commerce', 'store']) {
    const h = quoteFixture(source);
    const before = await shipping.state(h.db, h.input, h.options);
    assert.equal(before.quote_eligible, true);
    assert.equal(before.quote_reason, '');
    assert.equal(before.eligible, false);
    assert.equal(before.payment_confirmed, false);
    assert.match(before.purchase_reason, /payment/i);
    assert.equal(before.current_quote, null);
    const result = await shipping.handleAction(h.db, h.input, h.options);
    assert.equal(result.label.status, 'quoted');
    assert.equal(result.label.rates.length, 1);
    assert.equal(result.label.label_url, null);
    assert.equal(result.label.transaction_id, '');
    assert.equal(result.label.purchased_at, null);
    assert.equal(h.calls.length, 1);
    assert.equal(h.rpcCalls.length, 0, 'rate previews never claim a purchase');
    const after = await shipping.state(h.db, h.input, h.options);
    assert.equal(after.current_quote.id, result.label.id);
    assert.equal(after.payment_confirmed, false);
    assert.deepEqual(after.draft.sender, h.labels[0].sender);
    assert.deepEqual(after.draft.parcel, h.input.parcel);
    assert.equal(after.draft.customs, null);
    assert.equal(h.order.status || h.order.payment_status, source === 'commerce' ? 'accepted' : 'pending');
  }
});

test('paid transition hides the old unpaid quote while retaining its parcel draft and requires fresh rates', async () => {
  for (const source of ['commerce', 'store']) {
    const h = quoteFixture(source);
    const old = await shipping.handleAction(h.db, h.input, h.options);
    if (source === 'commerce') { h.order.status = 'paid'; h.order.version++; }
    else h.order.payment_status = 'paid';
    const stale = await shipping.state(h.db, h.input, h.options);
    assert.equal(stale.payment_confirmed, true);
    assert.equal(stale.eligible, true);
    assert.equal(stale.quote_eligible, true);
    assert.equal(stale.current_quote, null);
    assert.match(stale.quote_notice, /payment status changed.*fresh shipping rates/i);
    assert.deepEqual(stale.draft.parcel, h.input.parcel);
    assert.equal(stale.labels.find(row => row.id === old.label.id).status, 'quoted', 'old quote remains historical only');
    const fresh = await shipping.handleAction(h.db, h.input, h.options);
    const current = await shipping.state(h.db, h.input, h.options);
    assert.equal(current.current_quote.id, fresh.label.id);
    assert.notEqual(current.current_quote.id, old.label.id);
    assert.equal(current.quote_notice, '');
    assert.equal(h.rpcCalls.length, 0);
  }
});

test('expired and wrong-mode quotes are not offered as current usable rates', async () => {
  const h = quoteFixture();
  await shipping.handleAction(h.db, h.input, h.options);
  h.labels[0].expires_at = new Date(Date.now() - 1000).toISOString();
  let result = await shipping.state(h.db, h.input, h.options);
  assert.equal(result.current_quote, null);
  assert.match(result.quote_notice, /expired/);
  assert.deepEqual(result.draft.parcel, h.input.parcel);
  h.labels[0].expires_at = new Date(Date.now() + 60000).toISOString();
  h.labels[0].test_mode = true;
  result = await shipping.state(h.db, h.input, h.options);
  assert.equal(result.current_quote, null);
});

test('canceled and refunded physical orders can preview rates while remaining ineligible for purchase', async () => {
  for (const status of ['canceled', 'refunded']) {
    const h = quoteFixture('commerce', { status });
    const state = await shipping.state(h.db, h.input, h.options);
    assert.equal(state.quote_eligible, true);
    assert.equal(state.eligible, false);
    assert.equal(state.payment_confirmed, false);
    assert.match(state.purchase_reason, /canceled|refunded/);
    await shipping.handleAction(h.db, h.input, h.options);
    assert.equal(h.calls.length, 1);
    assert.equal(h.rpcCalls.length, 0);
  }
});

test('missing destinations and active labels still block new rate previews', async () => {
  const incomplete = quoteFixture();
  incomplete.order.request_data.address.line1 = '';
  let state = await shipping.state(incomplete.db, incomplete.input, incomplete.options);
  assert.equal(state.quote_eligible, false);
  assert.match(state.quote_reason, /recipient.*address/i);
  await assert.rejects(shipping.handleAction(incomplete.db, incomplete.input, incomplete.options), /recipient.*address/i);
  assert.equal(incomplete.calls.length, 0);
  const active = quoteFixture();
  await shipping.handleAction(active.db, active.input, active.options);
  Object.assign(active.labels[0], { status: 'created', provider_status: 'SUCCESS', purchased_at: '2026-11-18T01:00:00Z', selected_rate: rate });
  state = await shipping.state(active.db, active.input, active.options);
  assert.equal(state.quote_eligible, false);
  assert.match(state.quote_reason, /already exists/);
  assert.equal(state.current_quote, null);
  assert.equal(state.labels[0].provider_status, 'SUCCESS');
  assert.equal(state.labels[0].purchased_at, '2026-11-18T01:00:00Z');
  await assert.rejects(shipping.handleAction(active.db, active.input, active.options), /already exists/);
  assert.equal(active.calls.length, 1);
});

test('retained labels and active-purchase guards survive more than ten newer quote previews', async () => {
  const h = quoteFixture('commerce', { status: 'paid' });
  const saved = (await shipping.handleAction(h.db, h.input, h.options)).label;
  const retained = h.labels[0];
  Object.assign(retained, { status: 'created', provider_status: 'SUCCESS', transaction_id: 'b'.repeat(32), label_url: 'https://labels.example.test/retained.pdf',
    selected_rate: rate, purchased_at: '2026-11-18T01:00:00Z' });
  for (let index = 0; index < 30; index++) {
    h.labels.unshift({ ...retained, id: randomUUID(), status: 'quoted', test_mode: true, selected_rate: null, transaction_id: null, label_url: null,
      sender: { ...retained.sender, name: 'Latest draft ' + index }, parcel: { ...retained.parcel, weight: String(500 + index) },
      created_at: new Date(Date.now() + index).toISOString() });
  }
  const state = await shipping.state(h.db, h.input, h.options);
  assert.equal(state.quote_eligible, false);
  assert.match(state.quote_reason, /already exists/);
  assert.equal(state.current_quote, null);
  const label = state.labels.find(item => item.id === saved.id);
  assert.equal(label.status, 'created');
  assert.equal(label.label_url, 'https://labels.example.test/retained.pdf');
  assert.equal(label.transaction_id, 'b'.repeat(32));
  assert.equal(state.draft.sender.name, 'Latest draft 29');
  assert.equal(state.draft.parcel.weight, '529');
  assert.equal(state.labels.length, 1, 'other-mode quote churn is excluded from retained document history');
  assert.ok(h.reads.filter(read => read.table === 'admin_shipping_labels').every(read => Number.isFinite(read.limit) && read.limit <= 50));
  await assert.rejects(shipping.handleAction(h.db, h.input, h.options), /already exists/);
  assert.equal(h.calls.length, 1, 'a hidden older active label still prevents a duplicate quote/provider call');
});

test('bounded history preserves fifty non-quotes and makes an older active attempt reachable', async () => {
  const h = quoteFixture('commerce', { status: 'paid' });
  await shipping.handleAction(h.db, h.input, h.options);
  const template = { ...h.labels[0] };
  const current = { ...template, id: randomUUID(), status: 'review', test_mode: false, selected_rate: rate,
    message: 'Purchase outcome is unconfirmed. Check Shippo for this reference before retrying: pure-label:fixture' };
  h.labels.push(current);
  for (let index = 0; index < 60; index++) {
    h.labels.unshift({ ...template, id: randomUUID(), status: 'failed', test_mode: true, selected_rate: rate, created_at: new Date(Date.now() + index).toISOString() });
  }
  const state = await shipping.state(h.db, h.input, h.options);
  assert.equal(state.quote_eligible, false);
  assert.equal(state.current_quote, null);
  assert.equal(state.labels.filter(label => label.status === 'failed').length, 50);
  assert.equal(state.labels.filter(label => label.status === 'quoted').length, 1);
  assert.equal(state.labels.length, 52, 'history plus current quote and out-of-window active attempt remains bounded');
  const active = state.labels.find(label => label.id === current.id);
  assert.ok(active, 'the current attempt remains available for in-dashboard reconciliation');
  assert.match(active.message, /Check label status.*dashboard/);
  assert.doesNotMatch(active.message, /Check Shippo/);
});

test('latest current-mode quote remains usable even behind many other-mode previews', async () => {
  const h = quoteFixture();
  const quoted = (await shipping.handleAction(h.db, h.input, h.options)).label;
  const original = { ...h.labels[0] };
  for (let index = 0; index < 30; index++) h.labels.unshift({ ...original, id: randomUUID(), test_mode: true });
  const state = await shipping.state(h.db, h.input, h.options);
  assert.equal(state.current_quote.id, quoted.id);
  assert.equal(state.quote_eligible, true);
  assert.equal(state.labels.length, 1);
  assert.equal(h.calls.length, 1);
});
