'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createHmac} = require('node:crypto');
const fx = require('../lib/interac-fx');
const env = {CHECKOUT_RATE_LIMIT_SECRET: 'isolated-cad-quote-test-secret-at-least-32-characters'};
const now = Date.parse('2026-11-18T17:00:00.000Z');
const data = (rows = [{d: '2026-11-17', FXUSDCAD: {v: '1.4291'}}]) => ({seriesDetail: {FXUSDCAD: {label: 'USD/CAD'}}, observations: rows});
const response = body => new Response(JSON.stringify(body), {status: 200, headers: {'content-type': 'application/json'}});
function provider(body = data()) {
  const fn = async (url, options) => {fn.calls++; assert.equal(url, fx.ENDPOINT); assert.equal(options.redirect, 'error'); assert.equal(options.headers.Accept, 'application/json'); assert.ok(options.signal instanceof AbortSignal); return response(body);};
  fn.calls = 0; return fn;
}
const errorStatus = status => error => error.status === status;
const unpack = token => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
function signed(payload, secret = env.CHECKOUT_RATE_LIMIT_SECRET) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return 'ifx1.' + encoded + '.' + createHmac('sha256', secret).update('PURE:interac-fx:v1\0').update(encoded).digest('base64url');
}

test('uses the newest USD/CAD observation regardless of response order and signs a 30-minute CAD quote', async () => {
  const fetchImpl = provider(data([
    {d: '2026-11-16', FXUSDCAD: {v: '1.4298'}},
    {d: '2026-11-18', FXUSDCAD: {v: '1.425673'}},
    {d: '2026-11-17', FXUSDCAD: {v: '1.4291'}}
  ]));
  const quote = await fx.resolve({env, fetchImpl, now});
  assert.equal(quote.fx_ppm, 1425673);
  assert.equal(quote.source, 'Bank of Canada'); assert.equal(quote.series, 'FXUSDCAD');
  assert.equal(quote.rate_date, '2026-11-18'); assert.equal(quote.quoted_at, '2026-11-18T17:00:00.000Z');
  assert.equal(Date.parse(quote.expires_at) - now, 30 * 60 * 1000);
  assert.deepEqual(unpack(quote.token), {v: 1, from: 'USD', to: 'CAD', ...Object.fromEntries(Object.entries(quote).filter(([key]) => key !== 'token'))});
  assert.equal(fetchImpl.calls, 1);
  assert.deepEqual(await fx.resolve({token: quote.token, strict: true, env, fetchImpl, now: now + 1000}), quote);
  assert.equal(fetchImpl.calls, 1, 'Placement reuses the signed quote without repricing against the provider');
});

test('decimal rates convert exactly to integer ppm and reject ambiguous or extreme values', () => {
  for (const [rate, expected] of [['1.4291', 1429100], ['1.000001', 1000001], ['1', 1000000], ['0.1', 100000], ['10.000000', 10000000]]) assert.equal(fx.ratePpm(rate), expected);
  for (const rate of [1.42, null, '', ' 1.42', '1.42 ', '01.42', '-1.42', '1e0', '1.0000001', '0', '0.099999', '10.000001', 'Infinity', 'NaN']) assert.equal(fx.ratePpm(rate), null, String(rate));
});

test('uses the Canadian calendar and rejects stale or nonexistent observation dates', () => {
  const midnightUtc = Date.parse('2026-11-18T02:00:00.000Z');
  assert.equal(fx.observation(data([{d: '2026-11-18', FXUSDCAD: {v: '1.5'}}, {d: '2026-11-17', FXUSDCAD: {v: '1.4'}}]), midnightUtc).fx_ppm, 1400000);
  assert.equal(fx.observation(data([{d: '2026-11-11', FXUSDCAD: {v: '1.4'}}]), now).rate_date, '2026-11-11');
  for (const date of ['2026-11-10', '2026-11-19', '2026-11-31', '2026-02-30', '2026-1-18', 'not-a-date']) assert.throws(() => fx.observation(data([{d: date, FXUSDCAD: {v: '1.4'}}]), now), errorStatus(503));
});

test('rejects missing, inverse, conflicting or malformed provider rates without guessing', async () => {
  const bad = [null, {}, {observations: []}, {...data(), seriesDetail: {FXCADUSD: {label: 'CAD/USD'}}}, {...data(), seriesDetail: {FXUSDCAD: {label: 'CAD/USD'}}}, data([]), data([{d: '2026-11-17', FXCADUSD: {v: '0.7'}}]), data([{d: '2026-11-17', FXUSDCAD: {v: '1e0'}}]), data([{d: '2026-11-17', FXUSDCAD: {v: '1.4'}}, {d: '2026-11-17', FXUSDCAD: {v: '1.5'}}])];
  for (const body of bad) await assert.rejects(fx.resolve({env, fetchImpl: provider(body), now}), errorStatus(503));
  // A malformed newest quote must not silently fall back to an older valid row.
  assert.throws(() => fx.observation(data([{d: '2026-11-18', FXUSDCAD: {v: 'bad'}}, {d: '2026-11-17', FXUSDCAD: {v: '1.4'}}]), now), errorStatus(503));
});

test('caches observations and coalesces concurrent provider reads', async () => {
  let release, calls = 0;
  const fetchImpl = () => {calls++; return new Promise(resolve => {release = () => resolve(response(data()));});};
  const pending = Array.from({length: 8}, () => fx.resolve({env, fetchImpl, now}));
  assert.equal(calls, 1); release();
  const quotes = await Promise.all(pending);
  assert.equal(new Set(quotes.map(q => q.token)).size, 1);
  await fx.resolve({env, fetchImpl, now: now + 59 * 60000});
  assert.equal(calls, 1);
});

test('refreshes after the cache lifetime and uses the new daily observation', async () => {
  let calls = 0;
  const fetchImpl = async () => response(data([{d: '2026-11-18', FXUSDCAD: {v: ++calls === 1 ? '1.4' : '1.5'}}]));
  assert.equal((await fx.resolve({env, fetchImpl, now})).fx_ppm, 1400000);
  assert.equal((await fx.resolve({env, fetchImpl, now: now + 61 * 60000})).fx_ppm, 1500000);
  assert.equal(calls, 2);
});

test('a short provider outage reuses a bounded last-known rate, then fails closed', async () => {
  let calls = 0;
  const fetchImpl = async () => {if (++calls > 1) throw new Error('provider unavailable'); return response(data());};
  await fx.resolve({env, fetchImpl, now});
  assert.equal((await fx.resolve({env, fetchImpl, now: now + 65 * 60000})).fx_ppm, 1429100);
  assert.equal(calls, 2);
  assert.equal((await fx.resolve({env, fetchImpl, now: now + 65 * 60000 + 1000})).fx_ppm, 1429100);
  assert.equal(calls, 2, 'Backoff avoids hammering an unavailable provider');
  await assert.rejects(fx.resolve({env, fetchImpl, now: now + 24 * 3600000 + 1}), errorStatus(503));
});

test('an aged source rate cannot be extended by the fallback cache', async () => {
  let calls = 0;
  const fetchImpl = async () => {if (++calls > 1) throw Error('offline'); return response(data([{d: '2026-11-11', FXUSDCAD: {v: '1.4'}}]));};
  await fx.resolve({env, fetchImpl, now});
  await assert.rejects(fx.resolve({env, fetchImpl, now: now + 13 * 3600000}), errorStatus(503));
});

test('provider failures, redirects, invalid JSON and oversized bodies do not produce a payment total', async () => {
  for (const fetchImpl of [async () => new Response('no', {status: 503}), async () => new Response('', {status: 302}), async () => new Response('not json'), async () => new Response('x'.repeat(65537)), async () => {throw Error('offline');}, () => {throw Error('synchronous failure');}]) {
    await assert.rejects(fx.resolve({env, fetchImpl, now}), errorStatus(503));
    await assert.rejects(fx.resolve({env, fetchImpl, now: now + 60001}), errorStatus(503));
  }
});

test('placement requires an existing unexpired signed quote; quote refresh renews valid expired tokens', async () => {
  const fetchImpl = provider();
  for (const token of [undefined, null, '']) await assert.rejects(fx.resolve({token, strict: true, env, fetchImpl, now}), errorStatus(409));
  assert.equal(fetchImpl.calls, 0);
  const quote = await fx.resolve({env, fetchImpl, now});
  await assert.rejects(fx.resolve({token: quote.token, strict: true, env, fetchImpl, now: now + fx.QUOTE_TTL_MS}), errorStatus(409));
  const renewed = await fx.resolve({token: quote.token, strict: false, env, fetchImpl, now: now + fx.QUOTE_TTL_MS});
  assert.equal(renewed.fx_ppm, quote.fx_ppm); assert.notEqual(renewed.token, quote.token);
  assert.equal(Date.parse(renewed.quoted_at), now + fx.QUOTE_TTL_MS);
  assert.equal(fetchImpl.calls, 1);
});

test('client changes to rate, signature, encoding or signing key are rejected even during refresh', async () => {
  const fetchImpl = provider(), quote = await fx.resolve({env, fetchImpl, now});
  const parts = quote.token.split('.');
  const edited = unpack(quote.token); edited.fx_ppm = 1000000;
  const editedToken = 'ifx1.' + Buffer.from(JSON.stringify(edited)).toString('base64url') + '.' + parts[2];
  const tokens = [editedToken, quote.token + '=', quote.token.replace('ifx1.', 'ifx2.'), parts.slice(0, 2).join('.') + '.' + 'A'.repeat(43), ' ', {}, 'x'.repeat(2049)];
  for (const token of tokens) await assert.rejects(fx.resolve({token, env, fetchImpl, now}), errorStatus(409));
  await assert.rejects(fx.resolve({token: quote.token, env: {CHECKOUT_RATE_LIMIT_SECRET: 'a-different-test-signing-secret-long-enough'}, fetchImpl, now}), errorStatus(409));
  assert.equal(fetchImpl.calls, 1);
});

test('signed payloads are constrained to the intended currencies, source, rate bounds and lifetime', async () => {
  const fetchImpl = provider(), quote = await fx.resolve({env, fetchImpl, now}), payload = unpack(quote.token);
  const changes = [{v: 2}, {from: 'CAD'}, {to: 'USD'}, {source: 'Unverified'}, {series: 'FXCADUSD'}, {fx_ppm: 0}, {fx_ppm: 1429100.5}, {fx_ppm: 10000001}, {extra: true}, {rate_date: '2026-11-19'}, {quoted_at: 'bad'}, {expires_at: new Date(now + 3600000).toISOString()}, {quoted_at: new Date(now + 180000).toISOString(), expires_at: new Date(now + 180000 + fx.QUOTE_TTL_MS).toISOString()}];
  for (const change of changes) await assert.rejects(fx.resolve({token: signed({...payload, ...change}), env, fetchImpl, now}), errorStatus(409));
});

test('missing or weak server signing secrets fail without contacting the rate provider', async () => {
  const fetchImpl = provider();
  for (const secret of [undefined, '', 'too-short']) await assert.rejects(fx.resolve({env: {CHECKOUT_RATE_LIMIT_SECRET: secret}, fetchImpl, now}), errorStatus(503));
  assert.equal(fetchImpl.calls, 0);
});
