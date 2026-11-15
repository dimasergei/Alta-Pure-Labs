'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { quote, catalog } = require('../lib/research-builder-pricing');
const handler = require('../lib/research-builder-handler');

test('four distinct catalog compounds have server-priced monthly estimate and free bundled water', () => {
  const result = quote(['retatrutide', 'tirzepatide', 'semaglutide', 'tb-500'].map(id => ({ id, size: id === 'tb-500' ? '5mg' : '10mg', qty: 1 })), catalog());
  assert.equal(result.retail_cents, 25200);
  assert.equal(result.discount_cents, 10080);
  assert.equal(result.monthly_cents, 15120);
  assert.equal(result.bundled.monthly_cents, 0);
  assert.equal(result.subscription_available, false);
});

test('rejects duplicates, supplies, stale sizes and quantities', () => {
  const valid = ['retatrutide', 'tirzepatide', 'semaglutide', 'tb-500'].map(id => ({ id, size: id === 'tb-500' ? '5mg' : '10mg', qty: 1 }));
  for (const line of [{ id: 'retatrutide', size: '10mg', qty: 1 }, { id: 'bac-3', size: '3 mL', qty: 1 },
    { id: 'tb-500', size: '90mg', qty: 1 }, { id: 'tb-500', size: '5mg', qty: 2 }]) {
    assert.throws(() => quote([...valid.slice(0, 3), line], catalog()));
  }
});

test('checkout endpoint only quotes and cannot create a subscription', async () => {
  const old = process.env.SITE_URL;
  process.env.SITE_URL = 'https://altapurelabs.com';
  const response = () => ({ code: 0, payload: null, setHeader() {}, status(code) { this.code = code; return this; }, json(payload) { this.payload = payload; return this; } });
  const req = (action) => ({ method: 'POST', headers: { origin: 'https://altapurelabs.com', 'content-type': 'application/json' },
    body: { action, lines: ['retatrutide', 'tirzepatide', 'semaglutide', 'tb-500'].map(id => ({ id, size: id === 'tb-500' ? '5mg' : '10mg', qty: 1 })) } });
  try {
    const quoted = response(); await handler(req('quote'), quoted);
    assert.equal(quoted.code, 200); assert.equal(quoted.payload.monthly_cents, 15120);
    const enroll = response(); await handler(req('enroll'), enroll);
    assert.equal(enroll.code, 409); assert.match(enroll.payload.error, /unavailable/);
  } finally { if (old === undefined) delete process.env.SITE_URL; else process.env.SITE_URL = old; }
});
