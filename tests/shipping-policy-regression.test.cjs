'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

test('shipping policy says checkout is paused and makes no worldwide shipping promise', () => {
  const policy = readFileSync(resolve(__dirname, '../shipping-policy.html'), 'utf8');
  const api = readFileSync(resolve(__dirname, '../api/checkout.js'), 'utf8');
  assert.match(api, /res\.status\(503\)/);
  assert.doesNotMatch(api, /checkout\.sessions\.create/);
  assert.match(policy, /Online checkout is temporarily unavailable/);
  assert.match(policy, /previous U\.S\. checkout charged/);
  assert.match(policy, /\$25 USD per order/);
  assert.match(policy, /International shipping and new domestic checkout shipments are not currently available/);
  assert.doesNotMatch(policy, /We ship to a number of countries worldwide/);
  assert.doesNotMatch(policy, /<strong>International:<\/strong> 7/);
});
