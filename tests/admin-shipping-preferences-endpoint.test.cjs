'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const password = 'shipping-preferences-endpoint-fixture-at-least-32-characters';
const sessionToken = 'p'.repeat(43);
const sender = { name: 'PURE Fixture', street1: '100 Example Street', street2: 'Unit 2', city: 'Fixture City', state: 'ON', zip: 'A1A 1A1', country: 'CA', phone: '+1 416 555 0100', email: 'fixture@example.test' };
const empty = { version: 0, sender: null, package_defaults: null, updated_at: null };
let preferences, failure;
const calls = { clients: 0, reads: 0, saves: [], auth: 0, network: 0, orders: 0, logs: [] };
const db = { from() { throw Error('Unexpected order query.'); }, rpc() { throw Error('Unexpected order mutation.'); } };
const savedModules = new Map();
function mock(name, exports) {
  const path = require.resolve(name); savedModules.set(path, require.cache[path]);
  require.cache[path] = { id: path, filename: path, loaded: true, exports };
}
mock('../lib/backend', { clients() { calls.clients++; return { db }; }, checked(r) { if (r.error) throw r.error; return r.data; } });
mock('../lib/admin-shipping-preferences', {
  async readPreferences(received) { assert.equal(received, db); calls.reads++; if (failure) throw failure; return preferences; },
  async savePreferences(received, input) {
    assert.equal(received, db); calls.saves.push(input); if (failure) throw failure;
    preferences = { ...preferences, version: preferences.version + 1, updated_at: '2026-11-18T01:00:00Z',
      ...(input.scope === 'sender' ? { sender: input.sender } : { package_defaults: input.package_defaults }) };
    return preferences;
  }
});
mock('../lib/admin-order-query', { async unifiedAdminOrders(received) { assert.equal(received, db); calls.orders++; return { orders: [] }; } });
mock('../lib/inventory-db', { inventoryDb() { return { async rpc(name) {
  assert.equal(name, 'pure_admin_get_session'); calls.auth++;
  return { data: { expires_at: new Date(Date.now() + 60000).toISOString() } };
} }; } });
const handlerPath = require.resolve('../api/admin-orders'), savedHandler = require.cache[handlerPath];
delete require.cache[handlerPath];
const handler = require(handlerPath);
const envKeys = ['ADMIN_ORDERS_PASSWORD', 'ADMIN_AUTH_SIGNING_SECRET', 'ADMIN_AUTH_EMAIL', 'SITE_URL'];
const previousEnv = Object.fromEntries(envKeys.map(k => [k, process.env[k]]));
const previousFetch = global.fetch, previousError = console.error;
test.before(() => {
  process.env.ADMIN_ORDERS_PASSWORD = password; process.env.ADMIN_AUTH_SIGNING_SECRET = password;
  process.env.ADMIN_AUTH_EMAIL = 'owner@example.test'; process.env.SITE_URL = 'https://getpurelabs.com';
  global.fetch = async () => { calls.network++; throw Error('Preferences must never contact a provider.'); };
  console.error = (...args) => calls.logs.push(args);
});
test.beforeEach(() => { preferences = { ...empty }; failure = null; for (const k of Object.keys(calls)) calls[k] = Array.isArray(calls[k]) ? [] : 0; });
test.afterEach(() => assert.equal(calls.network, 0));
test.after(() => {
  for (const [path, original] of savedModules) { if (original) require.cache[path] = original; else delete require.cache[path]; }
  if (savedHandler) require.cache[handlerPath] = savedHandler; else delete require.cache[handlerPath];
  for (const k of envKeys) { if (previousEnv[k] === undefined) delete process.env[k]; else process.env[k] = previousEnv[k]; }
  global.fetch = previousFetch; console.error = previousError;
});
function response() { return { statusCode: 200, headers: {}, body: null,
  setHeader(k, v) { this.headers[k] = v; }, status(n) { this.statusCode = n; return this; }, json(v) { this.body = v; return this; }, send(v) { this.body = v; return this; }
}; }
function csrf() { return createHmac('sha256', createHmac('sha256', password).update('PURE admin authentication v1').digest()).update('csrf\n' + sessionToken).digest('base64url'); }
async function request({ method = 'GET', url = '/api/admin-orders?view=shipping-preferences', body, auth = 'cookie', headers = {} } = {}) {
  const authenticated = auth === 'cookie' ? { cookie: '__Host-pure_admin=' + sessionToken,
    ...(method === 'PATCH' ? { origin: 'https://getpurelabs.com', 'x-pure-admin-csrf': csrf() } : {}) }
    : auth === 'legacy' ? { 'x-admin-password': password } : {};
  const res = response();
  await handler({ method, url, body, headers: { ...authenticated, ...(method === 'PATCH' ? { 'content-type': 'application/json' } : {}), ...headers } }, res);
  return res;
}

test('private shipping defaults reject unauthenticated reads and writes before database access', async () => {
  preferences = { ...empty, sender };
  for (const args of [{}, { method: 'PATCH', body: { action: 'shipping_preferences_save', scope: 'sender', version: 0, sender } }]) {
    const res = await request({ ...args, auth: false });
    assert.equal(res.statusCode, 401); assert.deepEqual(res.body, { error: 'Unauthorized.' });
    assert.equal(res.headers['Cache-Control'], 'no-store');
    assert.ok(!JSON.stringify(res.body).includes(sender.street1));
  }
  assert.equal(calls.clients, 0); assert.equal(calls.reads, 0); assert.equal(calls.saves.length, 0);
});

test('authenticated reads return the saved private defaults without requiring an order or provider connection', async () => {
  let res = await request();
  assert.equal(res.statusCode, 200); assert.deepEqual(res.body, { preferences: empty });
  assert.equal(res.headers['Cache-Control'], 'private, no-store, max-age=0');
  assert.equal(res.headers['X-Content-Type-Options'], 'nosniff');
  preferences = { ...empty, version: 1, sender };
  res = await request();
  assert.equal(res.statusCode, 200); assert.deepEqual(res.body.preferences.sender, sender);
  assert.equal(calls.orders, 0); assert.equal(calls.saves.length, 0); assert.equal(calls.auth, 2);
});

test('cookie saves require same-origin CSRF and preserve the scoped versioned payload', async () => {
  const body = { action: 'shipping_preferences_save', scope: 'sender', version: 0, sender };
  for (const headers of [{ 'x-pure-admin-csrf': '' }, { origin: 'https://untrusted.example' }, { 'sec-fetch-site': 'cross-site' }]) {
    const res = await request({ method: 'PATCH', body, headers });
    assert.equal(res.statusCode, 403); assert.equal(calls.clients, 0); assert.equal(calls.saves.length, 0);
  }
  const res = await request({ method: 'PATCH', body: JSON.stringify(body) });
  assert.equal(res.statusCode, 200); assert.deepEqual(calls.saves, [body]);
  assert.equal(res.body.preferences.version, 1); assert.deepEqual(res.body.preferences.sender, sender);
  assert.equal(res.body.preferences.package_defaults, null);
  assert.equal(res.headers['Cache-Control'], 'private, no-store, max-age=0');
  assert.equal(calls.orders, 0);
});

test('package saves and clearing defaults use the same protected preferences route', async () => {
  const package_defaults = { length: '15', width: '10', height: '5', distance_unit: 'cm', mass_unit: 'g' };
  preferences = { ...empty, version: 1, sender };
  for (const value of [package_defaults, null]) {
    const body = { action: 'shipping_preferences_save', scope: 'package', version: preferences.version, package_defaults: value };
    const res = await request({ method: 'PATCH', body });
    assert.equal(res.statusCode, 200); assert.deepEqual(res.body.preferences.sender, sender);
    assert.deepEqual(res.body.preferences.package_defaults, value);
    assert.deepEqual(calls.saves.at(-1), body);
  }
  assert.equal(preferences.version, 3); assert.equal(calls.orders, 0);
});

test('invalid request types and non-PATCH methods cannot save defaults', async () => {
  const body = { action: 'shipping_preferences_save', scope: 'sender', version: 0, sender };
  for (const method of ['POST', 'DELETE']) {
    const res = await request({ method, body, auth: 'legacy' }); assert.equal(res.statusCode, 405);
  }
  let res = await request({ method: 'PATCH', body, headers: { 'content-type': 'text/plain' } });
  assert.equal(res.statusCode, 415);
  res = await request({ method: 'PATCH', body: '{' }); assert.equal(res.statusCode, 400);
  res = await request({ method: 'PATCH', body: { ...body, action: 'shipping_preferences_delete_everything' } });
  assert.equal(res.statusCode, 400);
  res = await request({ url: '/api/admin-orders?view=shipping-preferences&action=shipping_preferences_save', body });
  assert.equal(res.statusCode, 200); assert.deepEqual(res.body, { preferences: empty });
  assert.equal(calls.saves.length, 0); assert.equal(calls.orders, 0);
});

test('concurrent-edit and validation errors are explicit while internal failures do not disclose the personal address', async () => {
  const body = { action: 'shipping_preferences_save', scope: 'sender', version: 0, sender };
  for (const [status, message] of [[400, 'Enter a valid sender phone number.'], [409, 'Saved shipping defaults changed. Refresh them before saving again.']]) {
    failure = Object.assign(Error(message), { status });
    const res = await request({ method: 'PATCH', body });
    assert.equal(res.statusCode, status); assert.deepEqual(res.body, { error: message });
  }
  failure = Error('private database error for ' + sender.street1);
  const res = await request({ method: 'PATCH', body });
  assert.equal(res.statusCode, 500); assert.deepEqual(res.body, { error: 'Update failed. Refresh the order before retrying.' });
  assert.ok(!JSON.stringify(calls.logs).includes(sender.street1));
});

test('cross-site reads cannot expose saved personal sender details through an existing cookie', async () => {
  preferences = { ...empty, sender };
  const res = await request({ headers: { 'sec-fetch-site': 'cross-site', origin: 'https://untrusted.example' } });
  assert.equal(res.statusCode, 403); assert.equal(calls.clients, 0); assert.equal(calls.reads, 0);
  assert.ok(!JSON.stringify(res.body).includes(sender.street1));
});
