'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fx = require('../lib/display-fx');
const now = Date.parse('2026-11-18T17:00:00.000Z');
const response = body => new Response(JSON.stringify(body), {status: 200, headers: {'content-type': 'application/json'}});
const rows = (date = '2026-11-18') => fx.SUPPORTED_CURRENCIES.filter(code => code !== 'USD').map(quote => ({
  date, base: 'USD', quote, rate: ({CAD: 1.43, EUR: 0.91, GBP: 0.76, AUD: 1.49, JPY: 159.42, KRW: 1332.33, IDR: 18254})[quote] || 2
}));
function provider(body = rows()) {
  const fetchImpl = async (url, options) => {
    fetchImpl.calls++;
    assert.equal(url, fx.ENDPOINT);
    assert.match(url, /^https:\/\/api\.frankfurter\.dev\/v2\/providers\/ecb\/rates\?base=usd&quotes=/);
    assert.equal(options.redirect, 'error');
    assert.deepEqual(options.headers, {Accept: 'application/json'});
    assert.ok(options.signal instanceof AbortSignal);
    return response(body);
  };
  fetchImpl.calls = 0;
  return fetchImpl;
}
const invalid = body => assert.throws(() => fx.observation(body, now), /display-rate response/);

test('display rates normalize the explicit ECB provider to USD without payment or location fields', async () => {
  const fetchImpl = provider(rows().reverse());
  const result = await fx.load({fetchImpl, now});
  assert.deepEqual(Object.keys(result).sort(), ['version','base','source','provider','status','rates','rate_date','fetched_at','expires_at','supported_currencies'].sort());
  assert.equal(result.version, 'display-fx-v1');
  assert.equal(result.base, 'USD');
  assert.equal(result.source, 'European Central Bank');
  assert.equal(result.provider, 'frankfurter-ecb-v2');
  assert.equal(result.status, 'fresh');
  assert.equal(result.rates.USD, 1);
  assert.equal(result.rates.CAD, 1.43);
  assert.equal(result.rates.JPY, 159.42);
  assert.equal(result.rates.IDR, 18254);
  assert.equal(Object.keys(result.rates).length, 30);
  assert.equal(result.rate_date, '2026-11-18');
  assert.equal(result.fetched_at, new Date(now).toISOString());
  assert.equal(Date.parse(result.expires_at), now + 3600000);
  assert.deepEqual(fx.observation([...rows(), {date: '2026-11-18', base: 'USD', quote: 'USD', rate: 1}], now).rates, result.rates);
  assert.equal(fetchImpl.calls, 1);
});

test('rejects inverse bases, incomplete coverage, duplicate or unapproved currencies and mixed dates', () => {
  for (const body of [null, {}, [], rows().slice(1), [...rows(), ...rows()], rows().map((r,i) => i ? r : null),
    rows().map((r,i) => i ? r : {...r, base: 'EUR'}), rows().map((r,i) => i ? r : {...r, base: 'usd'}),
    rows().map((r,i) => i ? r : {...r, quote: 'BTC'}), rows().map((r,i) => i ? r : {...r, quote: '__proto__'}),
    rows().map((r,i) => i ? r : {...r, quote: 'cad'}), rows().map((r,i) => i ? r : rows()[1]),
    rows().map((r,i) => i ? r : {...r, date: '2026-11-17'}),
    [...rows(), {date: '2026-11-18', base: 'USD', quote: 'USD', rate: 1.1}]]) invalid(body);
});

test('accepts recent working-day reference dates but rejects future, stale and nonexistent dates', () => {
  assert.equal(fx.observation(rows('2026-11-11'), now).rate_date, '2026-11-11');
  assert.equal(fx.observation(rows('2026-11-13'), Date.parse('2026-11-15T12:00:00.000Z')).rate_date, '2026-11-13');
  for (const date of ['2026-11-10', '2026-11-19', '2026-11-31', '2026-02-30', '2026-1-18', '2026-11-18T00:00:00Z', '', null]) invalid(rows(date));
});

test('rejects nonnumeric, zero, negative and unreasonable rate values', () => {
  for (const rate of [undefined, null, '1.43', '1e0', NaN, Infinity, -Infinity, 0, -1, 0.0000001, 1000001]) {
    invalid(rows().map((r,i) => i ? r : {...r, rate}));
  }
});

test('deduplicates concurrent reads and keeps callers from modifying cached rates', async () => {
  let release, calls = 0;
  const fetchImpl = () => {calls++; return new Promise(resolve => {release = () => resolve(response(rows()));});};
  const pending = Array.from({length: 8}, () => fx.load({fetchImpl, now}));
  assert.equal(calls, 1); release();
  const results = await Promise.all(pending);
  assert.ok(results.every(result => result.status === 'fresh'));
  assert.equal(new Set(results.map(result => result.fetched_at)).size, 1);
  results[0].rates.CAD = 999;
  results[0].supported_currencies.push('BTC');
  const again = await fx.load({fetchImpl, now: now + 1000});
  assert.equal(again.rates.CAD, 1.43);
  assert.equal(again.supported_currencies.includes('BTC'), false);
  assert.equal(calls, 1);
});

test('cache reuse does not extend freshness and a successful refresh changes the observation', async () => {
  let calls = 0;
  const fetchImpl = async () => response(rows().map(r => r.quote === 'CAD' ? {...r, rate: ++calls === 1 ? 1.43 : 1.5} : r));
  const first = await fx.load({fetchImpl, now});
  const cached = await fx.load({fetchImpl, now: now + 59 * 60000});
  assert.equal(calls, 1);
  assert.equal(cached.expires_at, first.expires_at);
  assert.equal(fx.cacheControl(cached, now + 59 * 60000), 'public, max-age=60, s-maxage=60');
  const refreshed = await fx.load({fetchImpl, now: now + 3600000});
  assert.equal(calls, 2);
  assert.equal(refreshed.rates.CAD, 1.5);
  assert.equal(refreshed.status, 'fresh');
  assert.equal(Date.parse(refreshed.fetched_at), now + 3600000);
});

test('an outage serves only a verified, explicitly stale fallback with a short valid expiry', async () => {
  let calls = 0;
  const fetchImpl = async () => {if (++calls > 1) throw Error('upstream failure must not leak'); return response(rows());};
  const first = await fx.load({fetchImpl, now});
  const later = now + 65 * 60000;
  const stale = await fx.load({fetchImpl, now: later});
  assert.equal(stale.status, 'stale');
  assert.equal(stale.fetched_at, first.fetched_at);
  assert.equal(stale.rates.CAD, 1.43);
  assert.equal(Date.parse(stale.expires_at), later + 60000);
  assert.equal(fx.cacheControl(stale, later), 'no-store');
  assert.equal((await fx.load({fetchImpl, now: later + 1000})).status, 'stale');
  assert.equal(calls, 2, 'Failure backoff protects the provider');
  const lastMoment = now + 86400000 - 30000;
  const bounded = await fx.load({fetchImpl, now: lastMoment});
  assert.equal(bounded.status, 'stale');
  assert.equal(Date.parse(bounded.expires_at), now + 86400000, 'Stale expiry never extends past the original 24-hour fallback limit');
  const expired = await fx.load({fetchImpl, now: now + 86400000});
  assert.deepEqual(expired, fx.unavailable());
});

test('fallback and CDN expiry cannot extend the seven-day source-date bound', async () => {
  let calls = 0;
  const fetchImpl = async () => {if (++calls > 1) throw Error('offline'); return response(rows('2026-11-11'));};
  const late = Date.parse('2026-11-18T23:59:30.000Z');
  const first = await fx.load({fetchImpl, now: late});
  assert.equal(Date.parse(first.expires_at), Date.parse('2026-11-19T00:00:00.000Z'));
  assert.equal(fx.cacheControl(first, late), 'public, max-age=30, s-maxage=30');
  assert.equal((await fx.load({fetchImpl, now: late + 30000})).status, 'unavailable');
  assert.equal(fx.cacheControl(first, late + 30000), 'no-store');
});

test('cold failures, redirects, invalid JSON and oversized responses fall back to USD without invented rates', async () => {
  for (const make of [() => new Response('no', {status: 503}), () => new Response('', {status: 302}),
    () => new Response('not json'), () => new Response('x'.repeat(65537)),
    () => new Response('[]', {headers: {'content-length': '65537'}}), () => {throw Error('offline');},
    () => response(rows().map((r,i) => i ? r : {...r, base: 'EUR'}))]) {
    let calls = 0;
    const fetchImpl = async () => {calls++; return make();};
    assert.deepEqual(await fx.load({fetchImpl, now}), fx.unavailable());
    assert.deepEqual(await fx.load({fetchImpl, now: now + 1000}), fx.unavailable());
    assert.equal(calls, 1);
    assert.deepEqual(await fx.load({fetchImpl, now: now + 60000}), fx.unavailable());
    assert.equal(calls, 2);
  }
  assert.deepEqual(await fx.load({fetchImpl: null, now}), fx.unavailable());
});

test('an invalid refresh cannot replace a verified observation or reset its age', async () => {
  let calls = 0;
  const fetchImpl = async () => response(++calls === 1 ? rows() : rows().map((r,i) => i ? r : {...r, rate: -1}));
  await fx.load({fetchImpl, now});
  const stale = await fx.load({fetchImpl, now: now + 3600000});
  assert.equal(stale.status, 'stale');
  assert.equal(stale.rates.CAD, 1.43);
  assert.equal(Date.parse(stale.fetched_at), now);
  assert.equal((await fx.load({fetchImpl, now: now + 86400000})).status, 'unavailable');
});

test('the timestamp is captured after the fetch and a new response is still checked against that clock', async () => {
  let time = now, release;
  const fetchImpl = () => new Promise(resolve => {release = () => resolve(response(rows()));});
  const pending = fx.load({fetchImpl, now: () => time});
  time += 5000; release();
  const result = await pending;
  assert.equal(Date.parse(result.fetched_at), time);
  assert.equal(Date.parse(result.expires_at), time + 3600000);
});
