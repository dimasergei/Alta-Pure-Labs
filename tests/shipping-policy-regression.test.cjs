'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

test('shipping policy describes direct US checkout and makes no worldwide shipping promise', () => {
  const policy = readFileSync(resolve(__dirname, '../shipping-policy.html'), 'utf8');
  const api = readFileSync(resolve(__dirname, '../api/checkout.js'), 'utf8');
  assert.match(api, /res\.status\(503\)/);
  assert.doesNotMatch(api, /checkout\.sessions\.create/);
  assert.match(policy, /Online checkout currently supports US delivery only/);
  assert.match(policy, /manually with a selected supplier after payment is confirmed/);
  assert.match(policy, /US\$25 per product order/);
  assert.match(policy, /International checkout is unavailable/);
  assert.doesNotMatch(policy, /We ship to a number of countries worldwide/);
  assert.doesNotMatch(policy, /<strong>International:<\/strong> 7/);
});
