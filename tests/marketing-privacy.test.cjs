'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('marketing-analytics.js', 'utf8').replace('/* PUBLIC_PATHS */ []', JSON.stringify(['/', '/shop', '/coas', '/product/bpc-157', '/research-documentation']));
function run(pathname = '/shop', extras = {}) {
  const scripts = [];
  const ctx = { URL, Set, location: { hostname: 'altapurelabs.com', origin: 'https://altapurelabs.com', pathname, ...extras.location }, navigator: extras.navigator || {}, window: extras.window || {}, document: { createElement: () => ({}), head: { appendChild: s => scripts.push(s) } } };
  vm.runInNewContext(source, ctx);
  return { scripts, hook: ctx.window.vaq?.[0]?.[1] };
}
test('public analytics strips arbitrary secrets, campaign identifiers and fragments', () => {
  const { scripts, hook } = run();
  assert.equal(scripts.length, 1);
  const result = hook({ type: 'pageview', url: 'https://altapurelabs.com/shop?email=private@example.com&token=secret&utm_campaign=person#access_token=secret' });
  assert.equal(result.url, 'https://altapurelabs.com/shop');
  assert.equal(hook({ type: 'event', url: 'https://altapurelabs.com/shop', data: { email: 'private@example.com' } }), null);
});
test('private, unknown and preview pages never load analytics', () => {
  for (const url of ['/account', '/account/orders/123', '/my-account', '/pay.html', '/invoice.html', '/checkout-result.html', '/track-order', '/admin-orders.html', '/product/private-customer', '/api/checkout']) assert.equal(run(url).scripts.length, 0, url);
  assert.equal(run('/shop', { location: { hostname: 'altapurelabs-preview.vercel.app' } }).scripts.length, 0);
});
test('privacy preferences prevent script loading and suppress later events', () => {
  assert.equal(run('/shop', { navigator: { globalPrivacyControl: true } }).scripts.length, 0);
  assert.equal(run('/shop', { navigator: { doNotTrack: '1' } }).scripts.length, 0);
  const nav = {};
  const { hook } = run('/shop', { navigator: nav });
  nav.globalPrivacyControl = true;
  assert.equal(hook({ type: 'pageview', url: 'https://altapurelabs.com/shop' }), null);
});
test('pageview filter rejects private routes and foreign origins even after navigation', () => {
  const { hook } = run();
  for (const url of ['https://altapurelabs.com/pay.html?invoice=123', 'https://other.example/shop', 'not-a-url']) assert.equal(hook({ type: 'pageview', url }), null);
  assert.equal(hook({ type: 'pageview', url: 'https://altapurelabs.com/research-documentation.html?token=x' }).url, 'https://altapurelabs.com/research-documentation.html');
});
