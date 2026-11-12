'use strict';
// Read-only readiness and authenticated callbacks. Payment creation is handled separately.
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
    let schema=false,active=false;
    try{
      const db=deps.db||require('./inventory-db').inventoryDb();
      const version=await db.rpc('commerce_rampex_schema_version');
      schema=!version.error&&['rampex-v1','rampex-hosted-v1'].includes(version.data);
      if(schema){
        const config=require('./rampex').configuration(env);
        const methods=await db.from('commerce_payment_methods').select('id').eq('native_provider','rampex').eq('active',true);
        const accounts=await db.from('commerce_gateway_accounts').select('method_id').eq('provider','rampex').eq('account_tag',config.account_tag);
        active=!methods.error&&!accounts.error&&(methods.data||[]).some(m=>(accounts.data||[]).some(a=>a.method_id===m.id));
      }
    }catch{/* Absence of the separately approved migration keeps collection closed. */}
    return res.status(200).json({...state,phase:'order_integration',order_reconciliation_ready:schema,collection_enabled:schema&&active&&state.authentication==='valid'&&require('./rampex').configuration(env).ready,hosted_checkout_supported:true,...(!active&&state.authentication==='valid'?{setup_account_tag:require('./rampex').configuration(env).account_tag}:{}),hosted_wallets:{apple_pay:'provider_dependent',google_pay:'provider_dependent',live_payment_verified:false}});
  }
  if (kind !== 'rampex-webhook') return res.status(404).json({ error: 'Unknown Rampex endpoint.' });
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Use POST.' }); }
  if (!configuration(env).webhook_secret_saved) return res.status(503).json({ error: 'Webhook signing is not configured.', live_payment_applied: false });
  let verified=false;
  try {
    const raw = await rawBody(req);
    let event;
    try { event = parseWebhook(raw, req.headers || {}, env.RAMPEX_WEBHOOK_SECRET); }
    catch { return res.status(401).json({ error: 'Webhook verification failed.', live_payment_applied: false }); }
    verified=true;
    // Only explicitly identified tests can be acknowledged before durable reconciliation exists.
    if (event.test === true || event.livemode === false || event.mode === 'test') {
      return res.status(200).json({ received: true, verified: true, test: true, live_payment_applied: false });
    }
    const db=deps.db||require('./inventory-db').inventoryDb();
    const result=await require('./rampex-payments').event(db,event,env,deps.fetchImpl||fetch,deps);
    return res.status(200).json(result);
  } catch (error) {
    const status = [400, 409, 413].includes(error.status) ? error.status : 503;
    if(status===503)res.setHeader('Retry-After','60');
    return res.status(status).json({ error: status === 413 ? 'Request too large.' : 'Webhook could not be processed.', verified, live_payment_applied: false });
  }
}

module.exports = { configuration, authenticate, readiness, rawBody, handle };
