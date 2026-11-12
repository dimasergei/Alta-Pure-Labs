'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const r = require('../lib/rampex-protocol');
const secret = 'offline-test-only-secret-not-a-real-credential';
const signed = payload => {
  const raw = Buffer.from(JSON.stringify(payload));
  return { raw, headers: { 'x-rampex-signature': createHmac('sha256', secret).update(raw).digest('hex') } };
};
const completion = { event: 'payment.completed', link_id: '1736515200-abc123', status: 'completed',
  amount: '100.50', received_amount: 100.5, currency: 'USD', woo_order_id: 'invoice_123' };
const expected = { provider: 'rampex', mode: 'live', link_id: completion.link_id,
  amount_cents: 10050, currency: 'USD', order_id: 'invoice_123' };
const request = { amount_cents: 10050, currency: 'USD', email: 'buyer@example.invalid',
  order_id: 'invoice_123', provider: 'rampnetwork',
  provider_status: { id: 'rampnetwork', status: 'active', minimum_amount: 4, minimum_currency: 'USD' },
  return_url: 'https://altapurelabs.com/invoice.html?id=invoice_123' };

test('converts decimal fiat without rounding', () => {
  assert.equal(r.toCents('100.50'), 10050); assert.equal(r.toCents(0.01), 1);
  for (const bad of [null, true, -1, NaN, Infinity, '1e2', '1.001', ' 1', '01', '9007199254740992']) {
    assert.throws(() => r.toCents(bad));
  }
});
test('checks raw-byte signature before JSON parse', () => {
  const {raw, headers} = signed(completion);
  assert.deepEqual(r.parseWebhook(raw, headers, secret), completion);
  assert.throws(() => r.parseWebhook(Buffer.concat([raw, Buffer.from('\n')]), headers, secret));
  assert.equal(r.verifySignature(completion, headers['x-rampex-signature'], secret), false);
});
test('rejects missing, malformed, wrong and duplicate signatures', () => {
  const {raw, headers} = signed(completion);
  for (const sig of [undefined, '', '00', 'g'.repeat(64), ['a'.repeat(64)], 'a'.repeat(64)]) {
    assert.equal(r.verifySignature(raw, sig, secret), false);
  }
  assert.throws(() => r.parseWebhook(raw, {...headers, 'x-webhook-signature': 'a'.repeat(64)}, secret));
});
test('accepts documented fallback signature header', () => {
  const {raw, headers} = signed(completion);
  assert.deepEqual(r.parseWebhook(raw, {'x-webhook-signature': headers['x-rampex-signature']}, secret), completion);
});
test('rejects oversized bodies and conflicting event headers', () => {
  assert.equal(r.verifySignature(Buffer.alloc(r.MAX_BODY_BYTES + 1), 'a'.repeat(64), secret), false);
  const {raw, headers} = signed(completion);
  assert.throws(() => r.parseWebhook(raw, {...headers, 'x-rampex-event': 'payment.expired'}, secret));
});
test('rejects signed malformed JSON and non-object JSON', () => {
  const raw = Buffer.from('{');
  const h = {'x-rampex-signature': createHmac('sha256', secret).update(raw).digest('hex')};
  assert.throws(() => r.parseWebhook(raw, h, secret));
  for (const value of [null, [], 42]) {
    const s = signed(value); assert.throws(() => r.parseWebhook(s.raw, s.headers, secret));
  }
});
test('binds completion to the stored exact amount and link', () => {
  const ok = r.validateCompletion(completion, expected);
  assert.equal(ok.eligible, true); assert.equal(ok.event_key, 'rampex:payment.completed:1736515200-abc123');
  for (const patch of [{link_id:'other'}, {currency:'EUR'}, {amount:'100.49'},
    {received_amount:100.49}, {received_amount:101}, {status:'active'}, {woo_order_id:'other'},
    {metadata:{order_id:'other'}}]) assert.throws(() => r.validateCompletion({...completion,...patch}, expected));
});
test('does not fulfill extra deposits, expirations, or unknown events', () => {
  for (const event of ['payment.extra_deposit','payment.expired','payment.unknown']) {
    assert.equal(r.validateCompletion({...completion,event}, expected).eligible, false);
  }
});
test('requires a valid server-owned Rampex expectation', () => {
  for (const patch of [{provider:'peptidepay'}, {mode:'sandbox'}, {amount_cents:0},
    {amount_cents:1.5}, {currency:'CAD'}]) {
    assert.throws(() => r.validateCompletion(completion, {...expected,...patch}));
  }
});
test('produces stable replay keys without pretending to persist deduplication', () => {
  assert.equal(r.validateCompletion(completion, expected).event_key,
    r.validateCompletion({...completion, paid_at:'later'}, expected).event_key);
});
test('builds an exact-amount request without network calls or secrets', () => {
  const made = r.buildPaymentRequest(request);
  assert.equal(made.url, 'https://api.rampex.io/api-create-payment-link');
  assert.equal(made.body.amount, 100.5); assert.equal(made.body.provider, 'rampnetwork');
  assert.equal(made.body.woo_order_id, 'invoice_123'); assert.equal(made.headers, undefined);
});
test('blocks unsupported direct routes and invented providers', () => {
  for (const provider of ['stripe','unknown','STRIPE']) {
    assert.throws(() => r.buildPaymentRequest({...request,provider}));
  }
});
test('blocks redirected and unavailable providers, unknown minimum currencies', () => {
  for (const patch of [{status:'redirected'}, {status:'inactive'}, {id:'moonpay'},
    {minimum_amount:101}, {minimum_currency:'EUR'}, {minimum_amount:undefined}]) {
    assert.throws(() => r.buildPaymentRequest({...request, provider_status:{...request.provider_status,...patch}}));
  }
});
test('blocks invalid amounts, email and unsafe return URLs', () => {
  for (const amount_cents of [0, -1, 1.5, 5000001, NaN]) assert.throws(() => r.buildPaymentRequest({...request,amount_cents}));
  assert.throws(() => r.buildPaymentRequest({...request, email:'bad'}));
  assert.throws(() => r.buildPaymentRequest({...request, currency:'CAD'}));
  for (const return_url of ['http://altapurelabs.com/invoice.html?id=invoice_123',
    'https://evil.invalid/invoice.html?id=invoice_123', 'https://altapurelabs.com/invoice.html?id=other',
    'https://altapurelabs.com/invoice.html?id=invoice_123&next=https://evil.invalid',
    'https://user:pass@altapurelabs.com/invoice.html?id=invoice_123']) {
    assert.throws(() => r.buildPaymentRequest({...request,return_url}));
  }
});
test('constructs read-only status URLs and rejects query injection', () => {
  assert.equal(r.paymentStatusUrl('abc-123'), 'https://api.rampex.io/api-get-payment-status?link_id=abc-123');
  assert.throws(() => r.paymentStatusUrl('abc&link_id=other'));
});

test('test-mode completion can never grant a production entitlement', () => {
  for (const patch of [{test:true}, {livemode:false}, {mode:'test'}]) {
    assert.equal(r.validateCompletion({...completion,...patch}, expected).eligible, false);
  }
});
