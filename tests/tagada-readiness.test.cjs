'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { run, summarize } = require('../scripts/check-tagada-readiness.cjs');

test('readiness output excludes credentials and private contact details at every depth', () => {
  const output = summarize({ store: { id: 'store_abc', enabled: false, options: { apiKey: 'secret-value', clientSecret: 'secret-value', email: 'owner@example.com', walletAddress: 'secret-value', miscellaneous: 'secret-value' } } });
  assert.equal(output.store.id, 'store_abc');
  assert.equal(output.store.enabled, false);
  assert.doesNotMatch(JSON.stringify(output), /secret-value|owner@example/);
});

test('readiness uses only documented read operations and never sends credentials across redirects', async () => {
  const calls = [], logs = [];
  await run({ env: { TAGADA_API_KEY: 'sk_crm_' + 'a'.repeat(48), TAGADA_STORE_ID: 'store_abc' }, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, text: async () => JSON.stringify({ enabled: false }) };
  }, log: value => logs.push(value) });
  assert.equal(calls.length, 4);
  assert.equal(calls[0].url, 'https://api.tagada.io/api/public/v1/auth/test');
  assert.equal(calls[0].options.method, 'POST');
  assert.ok(calls.slice(1).every(call => call.options.method === 'GET'));
  assert.ok(calls.every(call => call.options.redirect === 'error'));
  assert.doesNotMatch(logs.join('\n'), /sk_crm_/);
});

test('readiness stops when authentication fails and does not log exception secrets', async () => {
  let calls = 0; const logs = [];
  const options = { env: { TAGADA_API_KEY: 'sk_crm_' + 'a'.repeat(48), TAGADA_STORE_ID: 'store_abc' }, log: value => logs.push(value) };
  await run({ ...options, fetchImpl: async () => { calls++; return { ok: false, status: 401 }; } });
  assert.equal(calls, 1);
  await run({ ...options, fetchImpl: async () => { throw new Error('secret-value'); } });
  assert.doesNotMatch(logs.join('\n'), /secret-value/);
});
