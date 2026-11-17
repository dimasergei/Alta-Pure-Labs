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
  assert.match(row.message, /unconfirmed/); await shipping.purchase(db, input, { env, fetch }); assert.equal(charges, 1);
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
  const db = { from(table) { const q = { select() { return q; }, eq() { return q; }, order() { return q; }, limit() { return q; }, async maybeSingle() { return { data: order }; }, then(resolve) { return Promise.resolve({ data: table === 'admin_shipping_labels' ? [] : order }).then(resolve); } }; return q; } };
  let state = await shipping.state(db, { id: order.id, source: 'store' }, { env });
  assert.equal(state.eligible, true); assert.match(state.shipping_service, /Not recorded/);
  order.shipping_address.line1 = '';
  state = await shipping.state(db, { id: order.id, source: 'store' }, { env }); assert.equal(state.eligible, false);
  order.shipping_address.line1 = '100 Example Street'; order.payment_status = 'pending';
  state = await shipping.state(db, { id: order.id, source: 'store' }, { env }); assert.equal(state.eligible, false);
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
