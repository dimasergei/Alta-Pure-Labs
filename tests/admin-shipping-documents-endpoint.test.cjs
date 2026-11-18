'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');

const password = 'shipping-endpoint-fixture-password-at-least-32-characters';
const sessionToken = 's'.repeat(43);
const id = '10000000-0000-4000-8000-000000000001';
const labelId = '20000000-0000-4000-8000-000000000001';
const pdf = Buffer.from('%PDF-1.4\nPURE shipping endpoint fixture\n%%EOF');
const filename = 'PURE-label-10000000-20000000.pdf';
const input = { id, source: 'commerce', label_id: labelId, kind: 'label' };
const reconciliation = { label: { id: labelId, status: 'created', transaction_id: 'a'.repeat(32) } };
const calls = { clients: 0, document: [], reconcile: [], shipping: [], list: 0, auth: 0, network: 0, logs: [] };
let documentError, reconcileError;

const db = { from() { throw new Error('Unexpected database query in the endpoint routing fixture.'); }, rpc() { throw new Error('Unexpected database mutation in the endpoint routing fixture.'); } };
const originalModules = new Map();
function mockModule(name, exports) {
  const path = require.resolve(name);
  originalModules.set(path, require.cache[path]);
  require.cache[path] = { id: path, filename: path, loaded: true, exports };
}
mockModule('../lib/backend', {
  clients() { calls.clients++; return { db }; },
  checked(result) { if (result.error) throw result.error; return result.data; }
});
mockModule('../lib/admin-shipping-documents', {
  async readDocument(receivedDb, received) {
    assert.equal(receivedDb, db); calls.document.push(received);
    if (documentError) throw documentError;
    return { bytes: pdf, filename };
  },
  async reconcile(receivedDb, received) {
    assert.equal(receivedDb, db); calls.reconcile.push(received);
    if (reconcileError) throw reconcileError;
    return reconciliation;
  }
});
mockModule('../lib/admin-shipping-labels', {
  async handleAction(receivedDb, received) { assert.equal(receivedDb, db); calls.shipping.push(received); return { delegated_action: received.action }; }
});
mockModule('../lib/admin-order-query', {
  async unifiedAdminOrders(receivedDb) { assert.equal(receivedDb, db); calls.list++; return { orders: [] }; }
});
mockModule('../lib/inventory-db', {
  inventoryDb() {
    return { async rpc(name) {
      assert.equal(name, 'pure_admin_get_session'); calls.auth++;
      return { data: { expires_at: new Date(Date.now() + 60000).toISOString() } };
    } };
  }
});
const handlerPath = require.resolve('../api/admin-orders');
const originalHandler = require.cache[handlerPath];
delete require.cache[handlerPath];
const handler = require(handlerPath);
const envKeys = ['ADMIN_ORDERS_PASSWORD', 'ADMIN_AUTH_SIGNING_SECRET', 'ADMIN_AUTH_EMAIL', 'SITE_URL'];
const previousEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
const previousFetch = global.fetch, previousError = console.error;

test.before(() => {
  process.env.ADMIN_ORDERS_PASSWORD = password;
  process.env.ADMIN_AUTH_SIGNING_SECRET = password;
  process.env.ADMIN_AUTH_EMAIL = 'owner@example.test';
  process.env.SITE_URL = 'https://getpurelabs.com';
  global.fetch = async () => { calls.network++; throw new Error('External requests are forbidden in endpoint tests.'); };
  console.error = (...args) => calls.logs.push(args);
});
test.beforeEach(() => {
  for (const key of Object.keys(calls)) calls[key] = Array.isArray(calls[key]) ? [] : 0;
  documentError = reconcileError = undefined;
});
test.afterEach(() => { assert.equal(calls.network, 0); });
test.after(() => {
  for (const [path, original] of originalModules) { if (original) require.cache[path] = original; else delete require.cache[path]; }
  if (originalHandler) require.cache[handlerPath] = originalHandler; else delete require.cache[handlerPath];
  for (const key of envKeys) { if (previousEnv[key] === undefined) delete process.env[key]; else process.env[key] = previousEnv[key]; }
  global.fetch = previousFetch; console.error = previousError;
});

function response() {
  return { statusCode: 200, headers: {}, body: undefined,
    setHeader(key, value) { this.headers[key] = value; },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; },
    send(value) { this.body = value; return this; }
  };
}
const query = extra => '/api/admin-orders?' + new URLSearchParams({ view: 'shipping-label-file', ...input, ...extra });
const csrf = () => createHmac('sha256', createHmac('sha256', password).update('PURE admin authentication v1').digest()).update('csrf\n' + sessionToken).digest('base64url');
function headers(auth, method) {
  if (auth === 'cookie') return { cookie: '__Host-pure_admin=' + sessionToken, ...(method === 'PATCH' ? { origin: 'https://getpurelabs.com', 'x-pure-admin-csrf': csrf() } : {}) };
  return auth === false ? {} : { 'x-admin-password': password };
}
async function request({ method = 'GET', url = query(), body, auth = true, extraHeaders = {} } = {}) {
  const res = response();
  await handler({ method, url, body, headers: { ...headers(auth, method), ...(method === 'PATCH' ? { 'content-type': 'application/json' } : {}), ...extraHeaders } }, res);
  return res;
}

test('document GET and reconciliation PATCH reject unauthenticated requests before database or document access', async () => {
  for (const args of [{}, { method: 'PATCH', body: { action: 'shipping_label_reconcile', ...input } }]) {
    const res = await request({ ...args, auth: false });
    assert.equal(res.statusCode, 401); assert.equal(res.body.error, 'Unauthorized.');
    assert.equal(res.headers['Cache-Control'], 'no-store');
    assert.equal(res.headers['Content-Disposition'], undefined);
  }
  assert.equal(calls.clients, 0); assert.equal(calls.auth, 0);
  assert.deepEqual(calls.document, []); assert.deepEqual(calls.reconcile, []); assert.deepEqual(calls.shipping, []);
});

test('an authenticated cookie GET serves the PDF inline with private caching and same-origin framing', async () => {
  const res = await request({ auth: 'cookie' });
  assert.equal(res.statusCode, 200); assert.equal(res.body, pdf);
  assert.equal(calls.auth, 1); assert.equal(calls.clients, 1);
  assert.deepEqual(calls.document, [input]);
  assert.equal(res.headers['Cache-Control'], 'private, no-store, max-age=0');
  assert.equal(res.headers['Content-Type'], 'application/pdf');
  assert.equal(res.headers['Content-Disposition'], 'inline; filename="' + filename + '"');
  assert.equal(res.headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(res.headers['X-Frame-Options'], 'SAMEORIGIN');
  assert.equal(res.headers['Content-Security-Policy'], "default-src 'none'; frame-ancestors 'self'; base-uri 'none'");
  assert.equal(res.headers['Referrer-Policy'], 'no-referrer');
  assert.deepEqual(calls.reconcile, []); assert.deepEqual(calls.shipping, []); assert.equal(calls.list, 0);
});

test('download mode is an explicit attachment and forwards order identity and document kind only', async () => {
  const res = await request({ url: query({ source: 'store', kind: 'customs', download: '1', url: 'https://untrusted.example/ignored.pdf' }) });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Content-Disposition'], 'attachment; filename="' + filename + '"');
  assert.equal(res.headers['Content-Type'], 'application/pdf');
  assert.equal(res.headers['Cache-Control'], 'private, no-store, max-age=0');
  assert.deepEqual(calls.document, [{ ...input, source: 'store', kind: 'customs' }]);
  const defaultKind = await request({ url: '/api/admin-orders?' + new URLSearchParams({ view: 'shipping-label-file', id, source: 'commerce', label_id: labelId, download: 'true' }) });
  assert.equal(defaultKind.statusCode, 200);
  assert.equal(defaultKind.headers['Content-Disposition'], 'inline; filename="' + filename + '"');
  assert.deepEqual(calls.document[1], input);
});

test('document errors retain useful safe messages and never claim to send a PDF', async () => {
  for (const [status, message] of [
    [400, 'Choose a label or customs PDF.'], [404, 'No customs PDF is available for this label.'],
    [409, 'This label is not ready to download. Check its status first.'],
    [502, 'The shipping provider did not return a PDF.'], [503, 'The label file is temporarily unavailable. Refresh the label and retry.']
  ]) {
    documentError = Object.assign(new Error(message), { status });
    const res = await request();
    assert.equal(res.statusCode, status); assert.deepEqual(res.body, { error: message });
    assert.equal(res.headers['Cache-Control'], 'no-store');
    assert.equal(res.headers['Content-Disposition'], undefined); assert.equal(res.headers['Content-Type'], undefined);
  }
  documentError = new Error('private internal database or provider diagnostic');
  const res = await request();
  assert.equal(res.statusCode, 503); assert.deepEqual(res.body, { error: 'Orders unavailable.' });
  assert.ok(!JSON.stringify(calls.logs).includes(documentError.message));
});

test('cookie reconciliation keeps the existing CSRF gate before calling its dedicated branch', async () => {
  const body = { action: 'shipping_label_reconcile', id, source: 'commerce', label_id: labelId };
  const rejected = await request({ method: 'PATCH', body, auth: 'cookie', extraHeaders: { 'x-pure-admin-csrf': '' } });
  assert.equal(rejected.statusCode, 403);
  assert.equal(calls.clients, 0); assert.deepEqual(calls.reconcile, []); assert.deepEqual(calls.shipping, []);
  const accepted = await request({ method: 'PATCH', body, auth: 'cookie' });
  assert.equal(accepted.statusCode, 200); assert.deepEqual(accepted.body, reconciliation);
  assert.deepEqual(calls.reconcile, [body]);
  assert.deepEqual(calls.document, []); assert.deepEqual(calls.shipping, []); assert.equal(calls.list, 0);
  assert.equal(accepted.headers['Cache-Control'], 'no-store');
  assert.equal(accepted.headers['Content-Disposition'], undefined);
});

test('GET, unsupported methods, and invalid PATCH bodies cannot trigger reconciliation', async () => {
  const get = await request({ url: '/api/admin-orders?' + new URLSearchParams({ action: 'shipping_label_reconcile', id, source: 'commerce', label_id: labelId }) });
  assert.equal(get.statusCode, 200); assert.deepEqual(get.body, { orders: [] });
  for (const method of ['POST', 'DELETE']) {
    const res = await request({ method, body: { action: 'shipping_label_reconcile', ...input } });
    assert.equal(res.statusCode, 405); assert.equal(res.headers.Allow, 'GET, PATCH');
  }
  const contentType = await request({ method: 'PATCH', body: { action: 'shipping_label_reconcile', ...input }, extraHeaders: { 'content-type': 'text/plain' } });
  assert.equal(contentType.statusCode, 415);
  const malformed = await request({ method: 'PATCH', body: '{' });
  assert.equal(malformed.statusCode, 400);
  assert.deepEqual(calls.reconcile, []); assert.deepEqual(calls.document, []); assert.deepEqual(calls.shipping, []);
});

test('other shipping actions remain delegated and reconciliation errors do not fall through to another mutation', async () => {
  const body = { action: 'shipping_label_refresh', id, source: 'commerce', label_id: labelId };
  const delegated = await request({ method: 'PATCH', body });
  assert.equal(delegated.statusCode, 200); assert.deepEqual(calls.shipping, [body]);
  assert.deepEqual(calls.reconcile, []);
  const message = 'No matching label has been confirmed yet. Check again shortly. A repeat purchase remains blocked.';
  reconcileError = Object.assign(new Error(message), { status: 409 });
  const failed = await request({ method: 'PATCH', body: { ...body, action: 'shipping_label_reconcile' } });
  assert.equal(failed.statusCode, 409); assert.deepEqual(failed.body, { error: message });
  assert.equal(calls.reconcile.length, 1); assert.equal(calls.shipping.length, 1);
  assert.deepEqual(calls.document, []); assert.equal(calls.list, 0);
});
