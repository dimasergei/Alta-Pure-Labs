'use strict';

// Reference conversions for storefront display only. Checkout and Interac keep
// their own canonical amounts, validation and signed Bank of Canada quotes.
const config = require('../config/display-currencies.json');
const SUPPORTED_CURRENCIES = Object.freeze([...config.supported_currencies]);
const TARGETS = SUPPORTED_CURRENCIES.filter(code => code !== 'USD');
const SUPPORTED = new Set(SUPPORTED_CURRENCIES);
const SOURCE = 'European Central Bank';
const PROVIDER = 'frankfurter-ecb-v2';
const ENDPOINT = 'https://api.frankfurter.dev/v2/providers/ecb/rates?base=usd&quotes=' + TARGETS.map(code => code.toLowerCase()).sort().join(',');
const DAY_MS = 86400000;
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_FALLBACK_MS = 24 * 60 * 60 * 1000;
const FAILURE_BACKOFF_MS = 60 * 1000;
const MAX_RATE_AGE_DAYS = 7;
const MAX_BODY_BYTES = 65536;
// This only deduplicates requests and keeps a bounded warm-instance fallback.
// Public HTTP caching is the shared layer; a cold instance can always use USD.
const caches = new WeakMap();

function timestamp(value) {
  const time = value === undefined ? Date.now() : typeof value === 'function' ? value() : value;
  const ms = time instanceof Date ? time.getTime() : time;
  if (!Number.isSafeInteger(ms) || ms < 0 || ms > 8640000000000000) throw new Error('Invalid display-rate clock.');
  return ms;
}

function dateDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const ms = Date.parse(value + 'T00:00:00.000Z');
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== value) return null;
  return ms / DAY_MS;
}

function freshDate(value, now) {
  const day = dateDay(value), today = Math.floor(now / DAY_MS);
  return day !== null && day <= today && today - day <= MAX_RATE_AGE_DAYS;
}

function observation(rows, now) {
  if (!Array.isArray(rows) || rows.length < TARGETS.length || rows.length > SUPPORTED_CURRENCIES.length) throw new Error('Invalid display-rate response.');
  const rates = {USD: 1}, seen = new Set();
  let rateDate = null;
  for (const row of rows) {
    if (!row || row.base !== 'USD' || typeof row.quote !== 'string' || !SUPPORTED.has(row.quote) || seen.has(row.quote)
      || typeof row.rate !== 'number' || !Number.isFinite(row.rate) || row.rate < 0.000001 || row.rate > 1000000
      || (row.quote === 'USD' && row.rate !== 1) || !freshDate(row.date, now) || (rateDate !== null && row.date !== rateDate)) {
      throw new Error('Invalid display-rate response.');
    }
    seen.add(row.quote);
    rateDate = row.date;
    rates[row.quote] = row.rate;
  }
  if (TARGETS.some(code => !seen.has(code))) throw new Error('Incomplete display-rate response.');
  return {rates: Object.freeze(rates), rate_date: rateDate};
}

async function readJson(response) {
  if (!response?.ok) throw new Error('Display rates unavailable.');
  const length = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) throw new Error('Display-rate response too large.');
  let raw;
  if (response.body?.getReader) {
    const reader = response.body.getReader(), chunks = [];
    let size = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > MAX_BODY_BYTES) {await reader.cancel(); throw new Error('Display-rate response too large.');}
        chunks.push(Buffer.from(part.value));
      }
    } finally {reader.releaseLock();}
    raw = Buffer.concat(chunks).toString('utf8');
  } else {
    raw = await response.text();
    if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) throw new Error('Display-rate response too large.');
  }
  return JSON.parse(raw);
}

function unavailable() {
  return {
    version: 'display-fx-v1', base: 'USD', source: SOURCE, provider: PROVIDER,
    status: 'unavailable', rates: {USD: 1}, rate_date: null, fetched_at: null, expires_at: null,
    supported_currencies: [...SUPPORTED_CURRENCIES]
  };
}

function reusable(snapshot, now, age) {
  return snapshot && now >= snapshot.fetched_at && now - snapshot.fetched_at < age && freshDate(snapshot.rate_date, now);
}

function payload(snapshot, now) {
  if (!reusable(snapshot, now, CACHE_FALLBACK_MS)) return unavailable();
  const fresh = reusable(snapshot, now, CACHE_TTL_MS);
  const sourceDeadline = (dateDay(snapshot.rate_date) + MAX_RATE_AGE_DAYS + 1) * DAY_MS;
  const hardDeadline = Math.min(snapshot.fetched_at + CACHE_FALLBACK_MS, sourceDeadline);
  const expires = Math.min(fresh ? snapshot.fetched_at + CACHE_TTL_MS : now + FAILURE_BACKOFF_MS, hardDeadline);
  if (expires <= now) return unavailable();
  return {
    version: 'display-fx-v1', base: 'USD', source: SOURCE, provider: PROVIDER,
    status: fresh ? 'fresh' : 'stale', rates: {...snapshot.rates}, rate_date: snapshot.rate_date,
    fetched_at: new Date(snapshot.fetched_at).toISOString(), expires_at: new Date(expires).toISOString(),
    supported_currencies: [...SUPPORTED_CURRENCIES]
  };
}

async function load({fetchImpl = global.fetch, now} = {}) {
  const clock = () => timestamp(now);
  const at = clock();
  if (typeof fetchImpl !== 'function') return unavailable();
  let cache = caches.get(fetchImpl);
  if (!cache) {cache = {snapshot: null, failed_at: null, pending: null}; caches.set(fetchImpl, cache);}
  if (reusable(cache.snapshot, at, CACHE_TTL_MS)) return payload(cache.snapshot, at);
  if (cache.pending) {await cache.pending; return payload(cache.snapshot, clock());}
  if (cache.failed_at !== null && at >= cache.failed_at && at - cache.failed_at < FAILURE_BACKOFF_MS) return payload(cache.snapshot, at);
  const pending = (async () => {
    try {
      const response = await fetchImpl(ENDPOINT, {headers: {Accept: 'application/json'}, redirect: 'error', signal: AbortSignal.timeout(8000)});
      const rows = await readJson(response);
      const fetchedAt = clock();
      cache.snapshot = {...observation(rows, fetchedAt), fetched_at: fetchedAt};
      cache.failed_at = null;
    } catch {
      cache.failed_at = clock();
    }
  })();
  cache.pending = pending;
  try {await pending;} finally {if (cache.pending === pending) cache.pending = null;}
  return payload(cache.snapshot, clock());
}

function cacheControl(result, now) {
  if (result.status !== 'fresh') return 'no-store';
  const remaining = Math.floor((Date.parse(result.expires_at) - timestamp(now)) / 1000);
  if (!Number.isFinite(remaining) || remaining < 1) return 'no-store';
  return `public, max-age=${Math.min(60, remaining)}, s-maxage=${Math.min(3600, remaining)}`;
}

module.exports = {load, observation, unavailable, cacheControl, ENDPOINT, SUPPORTED_CURRENCIES, CACHE_TTL_MS, CACHE_FALLBACK_MS, FAILURE_BACKOFF_MS, MAX_RATE_AGE_DAYS};
