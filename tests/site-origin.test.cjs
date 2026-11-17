'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {configuredOrigin, isAllowedOrigin} = require('../lib/checkout-security');
const current = 'https://getpurelabs.com';
const legacy = 'https://altapurelabs.com';

test('either verified production configuration accepts current and legacy storefront origins', () => {
  for (const configured of [current, legacy]) {
    for (const origin of [current, legacy]) assert.equal(isAllowedOrigin(origin, configured), true);
    for (const origin of [undefined, null, 'null', 'http://getpurelabs.com',
      current+'/', current+':444', current+'.evil.test', 'https://evil.test',
      'https://preview.vercel.app', 'https://www.getpurelabs.com']) {
      assert.equal(isAllowedOrigin(origin, configured), false, String(origin));
    }
  }
});

test('preview and other configured origins stay isolated from production aliases', () => {
  const preview = 'https://pure-preview.vercel.app';
  assert.equal(isAllowedOrigin(preview, preview), true);
  for (const origin of [current, legacy, 'https://other.vercel.app']) {
    assert.equal(isAllowedOrigin(origin, preview), false);
  }
});

test('invalid site configuration still fails closed', () => {
  for (const configured of [undefined, '', 'http://getpurelabs.com',
    'https://user:password@getpurelabs.com', current+'/account', current+'?next=x', current+'#x']) {
    assert.throws(() => configuredOrigin(configured), /HTTPS origin/);
    assert.throws(() => isAllowedOrigin(current, configured), /HTTPS origin/);
  }
});
