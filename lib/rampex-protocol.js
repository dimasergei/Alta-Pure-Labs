'use strict';
// Protocol helpers. Completion validation is not a substitute for durable reconciliation.
// Contract: https://rampex.io/api-docs (reviewed 2026-11-12).
const { createHmac, timingSafeEqual } = require('node:crypto');
const API_ORIGIN = 'https://api.rampex.io';
const MAX_BODY_BYTES = 65536;
const PROVIDERS = new Set(['hosted','rampnetwork','robinhood','topper','unlimit','bitnovo',
  'simpleswap','mercuryo','revolut','transak','cryptix','guardarian','moonpay',
  'banxa','alchemypay','sardine','particle','wert','simplex','utorg','transfi']);
const fail = message => { throw new Error(message); };

/** Convert a non-negative, two-decimal fiat amount without silently rounding. */
function toCents(value) {
  if (!['string','number'].includes(typeof value)) fail('Invalid fiat amount.');
  const s = String(value);
  if (!/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(s)) fail('Invalid fiat precision.');
  const [whole, fraction = ''] = s.split('.');
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) fail('Fiat amount too large.');
  return Number(cents);
}

/** IDs are opaque. Never substitute an internal payment_link_id for link_id. */
function linkId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(value)) {
    fail('Invalid payment link identifier.');
  }
  return value;
}

function verifySignature(raw, signature, secret) {
  if (!Buffer.isBuffer(raw) || raw.length === 0 || raw.length > MAX_BODY_BYTES ||
      typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature) ||
      typeof secret !== 'string' || secret.length < 16) return false;
  const expected = createHmac('sha256', secret).update(raw).digest();
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}

/** Authentication precedes parsing. A signed event is not payment authorization. */
function parseWebhook(raw, headers, secret) {
  const primary = headers && headers['x-rampex-signature'];
  const alternate = headers && headers['x-webhook-signature'];
  if (primary !== undefined && alternate !== undefined && primary !== alternate) {
    fail('Conflicting webhook signatures.');
  }
  if (!verifySignature(raw, primary === undefined ? alternate : primary, secret)) {
    fail('Invalid webhook signature.');
  }
  let payload;
  try { payload = JSON.parse(raw.toString('utf8')); }
  catch { fail('Invalid webhook JSON.'); }
  if (!payload || Array.isArray(payload) || typeof payload !== 'object' ||
      typeof payload.event !== 'string') fail('Invalid webhook payload.');
  if (headers['x-rampex-event'] !== undefined && headers['x-rampex-event'] !== payload.event) {
    fail('Conflicting webhook event.');
  }
  return payload;
}

/** Pure validation. Caller must pass a durable, server-owned attempt mapping. */
function validateCompletion(payload, expected) {
  if (payload.event !== 'payment.completed') return { eligible: false, reason: 'not_completion' };
  if (payload.test === true || payload.livemode === false || payload.mode === 'test') {
    return { eligible: false, reason: 'test_event' };
  }
  if (!expected || expected.provider !== 'rampex' || expected.mode !== 'live' ||
      !Number.isSafeInteger(expected.amount_cents) || expected.amount_cents <= 0 ||
      expected.currency !== 'USD') fail('Invalid stored payment expectation.');
  if (payload.status !== 'completed') fail('Payment is not completed.');
  const id = linkId(payload.link_id);
  if (id !== linkId(expected.link_id)) fail('Payment link mismatch.');
  if (payload.currency !== expected.currency) fail('Payment currency mismatch.');
  if (toCents(payload.amount) !== expected.amount_cents ||
      toCents(payload.received_amount) !== expected.amount_cents) fail('Payment amount mismatch.');
  const references = [payload.woo_order_id, payload.metadata && payload.metadata.order_id]
    .filter(value => value !== undefined && value !== null);
  if (references.some(value => String(value) !== String(expected.order_id))) {
    fail('Payment order reference mismatch.');
  }
  // Replay protection is a UNIQUE database event key, NOT an in-memory Set.
  return { eligible: true, link_id: id, amount_cents: expected.amount_cents,
    currency: expected.currency, event_key: 'rampex:payment.completed:' + id };
}

/** Build a request only; never sends it, creates an order, or submits a payment. */
function buildPaymentRequest({ amount_cents, currency, email, order_id, provider,
  provider_status, return_url }) {
  if (!Number.isSafeInteger(amount_cents) || amount_cents <= 0 || amount_cents > 5000000) {
    fail('Invalid server-calculated amount.');
  }
  if (currency !== 'USD') fail('Initial Rampex integration is USD-only.');
  // Hosted selection is explicitly authorized; it can include Stripe inside Rampex.
  if (!PROVIDERS.has(provider)) fail('Select a supported Rampex provider.');
  const status = provider_status;
  if (!status || status.id !== provider || status.status !== 'active' ||
      status.minimum_currency !== currency || toCents(status.minimum_amount) > amount_cents) {
    fail('Provider unavailable, redirected, or minimum not met.');
  }
  if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fail('Invalid customer email.');
  }
  if (typeof order_id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(order_id)) {
    fail('Invalid server-owned order reference.');
  }
  let url;
  try { url = new URL(return_url); } catch { fail('Invalid return URL.'); }
  if (url.origin !== 'https://altapurelabs.com' || url.username || url.password || url.hash ||
      url.pathname !== '/invoice.html' || url.searchParams.get('id') !== order_id ||
      [...url.searchParams.keys()].some(k => k !== 'id') || url.searchParams.getAll('id').length !== 1) {
    fail('Unapproved return URL.');
  }
  return { method: 'POST', url: API_ORIGIN + '/api-create-payment-link',
    body: { amount: amount_cents / 100, currency, customer_email: email,
      provider, description: 'AltaPure invoice ' + order_id,
      woo_order_id: order_id, woo_store_url: 'https://altapurelabs.com', payment_url: url.href } };
}

function paymentStatusUrl(id) {
  return API_ORIGIN + '/api-get-payment-status?link_id=' + encodeURIComponent(linkId(id));
}

module.exports = { API_ORIGIN, MAX_BODY_BYTES, toCents, verifySignature,
  parseWebhook, validateCompletion, buildPaymentRequest, paymentStatusUrl };
