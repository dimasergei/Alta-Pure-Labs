'use strict';

// Run manually in the production hosting environment. This never enables a
// payment method, creates a checkout session, or submits a payment.
const API = 'https://api.tagada.io/api/public/v1';
const SAFE_TEXT = new Set(['id', 'storeId', 'processorId', 'name', 'type', 'provider', 'status', 'mode', 'code', 'currency', 'baseCurrency']);
const PRIVATE_KEY = /secret|token|password|credential|authorization|api.?key|email|phone|address|wallet|customer|billing|shipping/i;

function summarize(value, key = '', depth = 0) {
  if (PRIVATE_KEY.test(key)) return '[redacted]';
  if (depth > 5) return '[nested]';
  if (Array.isArray(value)) return value.slice(0, 20).map(item => summarize(item, key, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 100).map(([field, item]) => [field, summarize(item, field, depth + 1)]));
  if (value === null || typeof value === 'boolean') return value;
  if (SAFE_TEXT.has(key) && typeof value === 'string' && /^[a-zA-Z0-9 _.:—-]{1,120}$/.test(value)) return value;
  return '[omitted]';
}

async function run({ env = process.env, fetchImpl = fetch, log = console.log } = {}) {
  if (!/^sk_crm_[a-f0-9]{48}$/i.test(env.TAGADA_API_KEY || '') || !/^store_[a-zA-Z0-9]+$/.test(env.TAGADA_STORE_ID || '')) {
    log('TAGADA_READINESS ' + JSON.stringify({ configurationPresent: false }));
    return;
  }
  const checks = [
    ['authentication', '/auth/test', 'POST'],
    ['store', '/stores/' + env.TAGADA_STORE_ID, 'GET'],
    ['processors', '/processors', 'GET'],
    ['payment_setup', '/stores/' + env.TAGADA_STORE_ID + '/payment-setup', 'GET'],
  ];
  for (const [check, path, method] of checks) {
    try {
      const response = await fetchImpl(API + path, {
        method, redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { Authorization: 'Bearer ' + env.TAGADA_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
        ...(method === 'POST' ? { body: '{}' } : {}),
      });
      const result = { check, status: response.status };
      if (check !== 'authentication') {
        const text = await response.text();
        if (text.length <= 200000) {
          try { result.data = summarize(JSON.parse(text)); } catch { result.data = '[non-JSON response]'; }
        }
      }
      log('TAGADA_READINESS ' + JSON.stringify(result));
      if (check === 'authentication' && !response.ok) break;
    } catch {
      log('TAGADA_READINESS ' + JSON.stringify({ check, error: 'request_failed' }));
      if (check === 'authentication') break;
    }
  }
}

if (require.main === module) run();
module.exports = { run, summarize };
