'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const handler = require('../api/checkout-status');

async function call(method) {
  const headers = {};
  const res = {
    code: 200,
    body: null,
    setHeader(key, value) { headers[key] = value; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
    end() { return this; }
  };
  await handler({ method }, res);
  return { status: res.code, body: res.body, headers };
}

test('public checkout-status API defaults to fail-closed and does not expose secrets', async () => {
  const original = process.env.CHECKOUT_ENABLED;
  try {
    delete process.env.CHECKOUT_ENABLED;
    let x = await call('GET');
    assert.equal(x.status, 200);
    assert.deepEqual(x.body, { enabled: false });
    assert.match(x.headers['Cache-Control'], /no-store/);
    process.env.CHECKOUT_ENABLED = 'false';
    x = await call('GET');
    assert.deepEqual(x.body, { enabled: false });
    process.env.CHECKOUT_ENABLED = 'true';
    x = await call('GET');
    assert.deepEqual(x.body, { enabled: true });
    assert.deepEqual(Object.keys(x.body), ['enabled']);
  } finally {
    if (original === undefined) delete process.env.CHECKOUT_ENABLED;
    else process.env.CHECKOUT_ENABLED = original;
  }
});

test('checkout-status API does not permit POST', async () => {
  const response = await call('POST');
  assert.equal(response.status, 405);
  assert.equal(response.headers.Allow, 'GET');
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
