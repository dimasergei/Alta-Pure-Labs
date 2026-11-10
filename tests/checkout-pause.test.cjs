'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const statusHandler = require('../api/checkout-status');
const checkoutHandler = require('../api/checkout');

async function call(handler, method = 'GET', body) {
  const headers = {};
  const res = {
    code: 200,
    body: null,
    setHeader(key, value) { headers[key] = value; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
    end() { return this; }
  };
  await handler({ method, body, headers: { origin: 'https://altapurelabs.com' } }, res);
  return { status: res.code, body: res.body, headers };
}

test('public checkout availability remains false even with stale enabled env flags', async () => {
  const keys = ['CHECKOUT_ENABLED','LIVE_CHECKOUT_ENABLED','STRIPE_SECRET_KEY'];
  const values = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    for (const mode of ['unset', 'disabled', 'stale-live']) {
      if (mode === 'unset') {
        for (const key of keys) delete process.env[key];
      } else {
        process.env.CHECKOUT_ENABLED = mode === 'stale-live' ? 'true' : 'false';
        process.env.LIVE_CHECKOUT_ENABLED = mode === 'stale-live' ? 'true' : 'false';
        process.env.STRIPE_SECRET_KEY = 'sk_live_DO_NOT_USE_fixture';
      }
      const response = await call(statusHandler);
      assert.equal(response.status, 200);
      assert.deepEqual(response.body, { enabled: false });
      assert.match(response.headers['Cache-Control'], /no-store/);
      assert.deepEqual(Object.keys(response.body), ['enabled']);
    }
  } finally {
    for (const key of keys) {
      if (values[key] === undefined) delete process.env[key];
      else process.env[key] = values[key];
    }
  }
});

test('checkout-status API does not permit POST', async () => {
  const result = await call(statusHandler, 'POST');
  assert.equal(result.status, 405);
  assert.equal(result.headers.Allow, 'GET');
});

test('retired checkout rejects any new payment before creating an order/session', async () => {
  const keys = ['CHECKOUT_ENABLED','LIVE_CHECKOUT_ENABLED'];
  const values = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    process.env.CHECKOUT_ENABLED = 'true';
    process.env.LIVE_CHECKOUT_ENABLED = 'true';
    const result = await call(checkoutHandler, 'POST', {
      research: true,
      name: 'Test', email: 'test@example.test', org: 'Test',
      items: [{ id: 'test', size: '10mg', qty: 1 }]
    });
    assert.equal(result.status, 503);
    assert.match(result.body.error, /temporarily unavailable/i);
    assert.match(result.headers['Cache-Control'], /no-store/);
    const invalid = await call(checkoutHandler, 'GET');
    assert.equal(invalid.status, 405);
  } finally {
    for (const key of keys) {
      if (values[key] === undefined) delete process.env[key];
      else process.env[key] = values[key];
    }
  }
});

test('cart and submit controls require positive server checkout availability', () => {
  const root = path.resolve(__dirname, '..');
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const client = fs.readFileSync(path.join(root, 'checkout.js'), 'utf8');
  assert.match(app, /state\.cart\.length === 0 \|\| window\.AltaCheckoutEnabled !== true/);
  assert.match(client, /window\.AltaCheckoutEnabled = false/);
  assert.match(client, /fetch\('\/api\/checkout-status'/);
  assert.match(client, /window\.AltaCheckoutEnabled=result\?\.enabled===true/);
  assert.match(client, /window\.AltaCheckoutEnabled!==true/);
  assert.match(client, /Checkout temporarily unavailable/);
  assert.match(client, /role','status/);
});

test('old signed Stripe webhook remains available for historical payment events', () => {
  const root = path.resolve(__dirname, '..');
  const webhook = fs.readFileSync(path.join(root, 'api/stripe-webhook.js'), 'utf8');
  assert.match(webhook, /constructEvent/);
  assert.match(webhook, /apply_store_checkout_event/);
});
