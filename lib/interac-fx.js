'use strict';

const {createHmac, timingSafeEqual} = require('node:crypto');

const SOURCE = 'Bank of Canada';
const SERIES = 'FXUSDCAD';
const ENDPOINT = 'https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?recent=5';
const QUOTE_TTL_MS = 30 * 60 * 1000;
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_FALLBACK_MS = 24 * 60 * 60 * 1000;
const FAILURE_BACKOFF_MS = 60 * 1000;
const MAX_RATE_AGE_DAYS = 7;
const MAX_BODY_BYTES = 65536;
const DOMAIN = 'PURE:interac-fx:v1\0';
const caches = new WeakMap();
const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit'
});
const fail = (status, message) => {throw Object.assign(new Error(message), {status});};
const invalidQuote = () => fail(409, 'Your CAD total needs to be refreshed. Review the updated total before placing your order.');
const unavailable = () => fail(503, 'The CAD total is temporarily unavailable. Please refresh checkout in a moment.');

function timestamp(value) {
  const time = value === undefined ? Date.now() : typeof value === 'function' ? value() : value;
  const ms = time instanceof Date ? time.getTime() : time;
  if (!Number.isSafeInteger(ms) || ms < 0) throw new Error('Invalid exchange-rate clock.');
  return ms;
}

function localDate(ms) {
  const parts = Object.fromEntries(dateFormatter.formatToParts(new Date(ms)).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function dateDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const ms = Date.parse(value + 'T00:00:00.000Z');
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== value) return null;
  return ms / 86400000;
}

function freshDate(value, now) {
  const day = dateDay(value), today = dateDay(localDate(now));
  return day !== null && day <= today && today - day <= MAX_RATE_AGE_DAYS;
}

function ratePpm(value) {
  // The provider's decimal string is converted exactly; binary floating point
  // never decides which rate is signed into a customer's CAD quote.
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,2})(?:\.\d{1,6})?$/.test(value)) return null;
  const [whole, decimals = ''] = value.split('.');
  const ppm = Number(whole) * 1000000 + Number(decimals.padEnd(6, '0'));
  return Number.isSafeInteger(ppm) && ppm >= 100000 && ppm <= 10000000 ? ppm : null;
}

function observation(data, now) {
  if (!data || data.seriesDetail?.[SERIES]?.label !== 'USD/CAD' || !Array.isArray(data.observations) || data.observations.length > 100) unavailable();
  const candidates = data.observations.filter(row => row && freshDate(row.d, now));
  if (!candidates.length) unavailable();
  const latestDate = candidates.map(row => row.d).sort().at(-1);
  const latest = candidates.filter(row => row.d === latestDate);
  const rates = latest.map(row => ratePpm(row[SERIES]?.v));
  if (rates.some(rate => rate === null) || new Set(rates).size !== 1) unavailable();
  return {fx_ppm: rates[0], source: SOURCE, series: SERIES, rate_date: latestDate};
}

async function readJson(response) {
  if (!response?.ok) unavailable();
  const length = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) unavailable();
  let raw;
  if (response.body?.getReader) {
    const reader = response.body.getReader(), chunks = [];
    let size = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > MAX_BODY_BYTES) {await reader.cancel(); unavailable();}
        chunks.push(Buffer.from(part.value));
      }
    } finally {reader.releaseLock();}
    raw = Buffer.concat(chunks).toString('utf8');
  } else {
    raw = await response.text();
    if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) unavailable();
  }
  try {return JSON.parse(raw);} catch {unavailable();}
}

async function currentRate(fetchImpl, now) {
  if (typeof fetchImpl !== 'function') unavailable();
  let cache = caches.get(fetchImpl);
  if (!cache) {cache = {rate: null, fetched_at: 0, failed_at: null, pending: null}; caches.set(fetchImpl, cache);}
  const reusable = maxAge => cache.rate && now >= cache.fetched_at && now - cache.fetched_at <= maxAge && freshDate(cache.rate.rate_date, now);
  if (reusable(CACHE_TTL_MS)) return cache.rate;
  if (cache.pending) return cache.pending;
  if (cache.failed_at !== null && now >= cache.failed_at && now - cache.failed_at < FAILURE_BACKOFF_MS) {
    if (reusable(CACHE_FALLBACK_MS)) return cache.rate;
    unavailable();
  }
  const pending = (async () => {
    try {
      const response = await fetchImpl(ENDPOINT, {headers: {Accept: 'application/json'}, redirect: 'error', signal: AbortSignal.timeout(8000)});
      const rate = observation(await readJson(response), now);
      cache.rate = rate; cache.fetched_at = now; cache.failed_at = null;
      return rate;
    } catch {
      cache.failed_at = now;
      // A short provider outage may reuse a previously verified daily rate.
      // It never introduces a default rate or extends the source-age limit.
      if (reusable(CACHE_FALLBACK_MS)) return cache.rate;
      unavailable();
    }
  })();
  cache.pending = pending;
  try {return await pending;} finally {if (cache.pending === pending) cache.pending = null;}
}

function signingSecret(env) {
  const secret = env?.CHECKOUT_RATE_LIMIT_SECRET;
  if (typeof secret !== 'string' || secret.length < 32) unavailable();
  return secret;
}

function signature(encoded, secret) {
  return createHmac('sha256', secret).update(DOMAIN).update(encoded).digest();
}

function encode(payload, secret) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `ifx1.${encoded}.${signature(encoded, secret).toString('base64url')}`;
}

function decode(token, secret, now) {
  if (typeof token !== 'string' || token.length > 2048) invalidQuote();
  const match = /^ifx1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match) invalidQuote();
  const content = Buffer.from(match[1], 'base64url'), supplied = Buffer.from(match[2], 'base64url');
  if (content.toString('base64url') !== match[1] || supplied.toString('base64url') !== match[2] || !timingSafeEqual(supplied, signature(match[1], secret))) invalidQuote();
  let payload;
  try {payload = JSON.parse(content.toString('utf8'));} catch {invalidQuote();}
  const keys = ['v','from','to','fx_ppm','source','series','rate_date','quoted_at','expires_at'];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).sort().join() !== keys.sort().join()) invalidQuote();
  if (payload.v !== 1 || payload.from !== 'USD' || payload.to !== 'CAD' || payload.source !== SOURCE || payload.series !== SERIES || !Number.isSafeInteger(payload.fx_ppm) || payload.fx_ppm < 100000 || payload.fx_ppm > 10000000) invalidQuote();
  const quoted = Date.parse(payload.quoted_at), expires = Date.parse(payload.expires_at);
  if (!Number.isFinite(quoted) || !Number.isFinite(expires) || new Date(quoted).toISOString() !== payload.quoted_at || new Date(expires).toISOString() !== payload.expires_at || expires - quoted !== QUOTE_TTL_MS || quoted > now + 120000 || !freshDate(payload.rate_date, quoted)) invalidQuote();
  return payload;
}

async function resolve({token, strict = false, env = process.env, fetchImpl = globalThis.fetch, now} = {}) {
  const time = timestamp(now), secret = signingSecret(env);
  if (token !== undefined && token !== null && token !== '') {
    const payload = decode(token, secret, time);
    if (Date.parse(payload.expires_at) > time && freshDate(payload.rate_date, time)) {
      const {v, from, to, ...rate} = payload;
      return {...rate, token};
    }
    if (strict) invalidQuote();
  } else if (strict) invalidQuote();
  const rate = await currentRate(fetchImpl, time);
  const payload = {v: 1, from: 'USD', to: 'CAD', ...rate, quoted_at: new Date(time).toISOString(), expires_at: new Date(time + QUOTE_TTL_MS).toISOString()};
  const {v, from, to, ...quote} = payload;
  return {...quote, token: encode(payload, secret)};
}

module.exports = {resolve, observation, ratePpm, ENDPOINT, QUOTE_TTL_MS, MAX_RATE_AGE_DAYS};
