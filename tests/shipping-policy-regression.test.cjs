'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

test('shipping policy reflects the current US-only $25 checkout and does not offer unrestricted international service', () => {
  const policy = readFileSync(resolve(__dirname, '../shipping-policy.html'), 'utf8');
  const api = readFileSync(resolve(__dirname, '../api/checkout.js'), 'utf8');
  assert.match(api, /allowed_countries:\s*\['US'\]/);
  assert.match(api, /shipping !== 2500/);
  assert.match(policy, /standard shipping to eligible U\.S\. addresses only/);
  assert.match(policy, /\$25 USD per order/);
  assert.match(policy, /International shipping is not currently available through the online checkout/);
  assert.doesNotMatch(policy, /We ship to a number of countries worldwide/);
  assert.doesNotMatch(policy, /<strong>International:<\/strong> 7/);
});
