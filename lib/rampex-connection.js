'use strict';
// Connection verification only: deliberately cannot create links or mark orders paid.
const { createHash } = require('node:crypto');
const { parseWebhook, MAX_BODY_BYTES } = require('./rampex-protocol');
const API = 'https://api.rampex.io/api-validate-key';
const CALLBACK = '/api/checkout?native=rampex-webhook';
const TTL_MS = 60000;
let cache;

function configuration(env) {
  return {
    api_key_saved: typeof env.RAMPEX_API_KEY === 'string' && env.RAMPEX_API_KEY.trim().length > 0,
    webhook_secret_saved: typeof env.RAMPEX_WEBHOOK_SECRET === 'string' && env.RAMPEX_WEBHOOK_SECRET.length >= 16
  };
}

async function authenticate(env, fetchImpl = fetch) {
  if (!configuration(env).api_key_saved) return 'not_configured';
  try {
    const response = await fetchImpl(API, {
      method: 'POST', redirect: 'error',
      headers: { 'X-API-Key': env.RAMPEX_API_KEY, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000)
    });
    const text = await boundedText(response, 16384);
    let result;
    try { result = JSON.parse(text); } catch { return 'unavailable'; }
    if (response.status === 401 && result?.valid === false) return 'rejected';
    if (!response.ok || !result || Array.isArray(result)) return 'unavailable';
    return result.valid === true && typeof result.merchant_id === 'string' &&
      result.merchant_id.length > 0 ? 'valid' : 'unavailable';
  } catch {
    // Never echo an upstream response/error: it may include credentials or account data.
    return 'unavailable';
  }
}

async function boundedText(response, limit) {
  const declared = response.headers?.get?.('content-length');
  if (declared && Number(declared) > limit) throw Error('Oversized response');
  if (response.body?.getReader) {
    const reader = response.body.getReader(); let length = 0; const parts = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > limit) { await reader.cancel(); throw Error('Oversized response'); }
        parts.push(Buffer.from(value));
      }
      return Buffer.concat(parts).toString('utf8');
    } finally { reader.releaseLock(); }
  }
  const text = await response.text();
  if (Buffer.byteLength(text) > limit) throw Error('Oversized response');
  return text;
}

async function readiness(env, fetchImpl = fetch, now = Date.now()) {
  const configured = configuration(env);
  const fingerprint = createHash('sha256').update(env.RAMPEX_API_KEY || '').digest('hex');
  if (!cache || cache.fingerprint !== fingerprint || now >= cache.expires) {
    cache = { fingerprint, expires: now + TTL_MS, promise: authenticate(env, fetchImpl) };
  }
  return {
    provider: 'rampex', phase: 'connection_verification', ...configured,
    authentication: await cache.promise,
    collection_enabled: false,
    order_reconciliation_ready: false,
    webhook_path: CALLBACK
  };
}

async function rawBody(req) {
  if (typeof req[Symbol.asyncIterator] === 'function') {
    let length = 0; const parts = [];
    for await (const value of req) {
      const part = Buffer.isBuffer(value) ? value : Buffer.from(value);
      length += part.length;
      if (length > MAX_BODY_BYTES) throw Object.assign(Error('Request too large.'), { status: 413 });
      parts.push(part);
    }
    return Buffer.concat(parts);
  }
  const value = Object.getOwnPropertyDescriptor(req, 'body')?.value;
  if (!Buffer.isBuffer(value) && typeof value !== 'string') {
    throw Object.assign(Error('Raw webhook bytes required.'), { status: 400 });
  }
  const raw = Buffer.isBuffer(value) ? value : Buffer.from(value);
  if (raw.length > MAX_BODY_BYTES) throw Object.assign(Error('Request too large.'), { status: 413 });
  return raw;
}

async function handle(req, res, params, deps = {}) {
  const env = deps.env || process.env;
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  const kind = params.get('native');
  if (kind === 'rampex-readiness') {
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'Use GET.' }); }
    const state = await readiness(env, deps.fetchImpl || fetch, deps.now ?? Date.now());
    return res.status(200).json(state);
  }
  if (kind !== 'rampex-webhook') return res.status(404).json({ error: 'Unknown Rampex endpoint.' });
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Use POST.' }); }
  if (!configuration(env).webhook_secret_saved) return res.status(503).json({ error: 'Webhook signing is not configured.', live_payment_applied: false });
  try {
    const raw = await rawBody(req);
    let event;
    try { event = parseWebhook(raw, req.headers || {}, env.RAMPEX_WEBHOOK_SECRET); }
    catch { return res.status(401).json({ error: 'Webhook verification failed.', live_payment_applied: false }); }
    // Only explicitly identified tests can be acknowledged before durable reconciliation exists.
    if (event.test === true || event.livemode === false || event.mode === 'test') {
      return res.status(200).json({ received: true, verified: true, test: true, live_payment_applied: false });
    }
    // Do not silently drop genuine callbacks or create entitlements from a signature alone.
    res.setHeader('Retry-After', '60');
    return res.status(503).json({ received: true, verified: true, live_payment_applied: false,
      error: 'Rampex order reconciliation is not enabled. Do not collect customer payments yet.' });
  } catch (error) {
    const status = [400, 413].includes(error.status) ? error.status : 503;
    return res.status(status).json({ error: status === 413 ? 'Request too large.' : 'Webhook could not be processed.', live_payment_applied: false });
  }
}

module.exports = { configuration, authenticate, readiness, rawBody, handle };
