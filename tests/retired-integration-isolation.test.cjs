'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const paymentPolicy = require('../lib/pure-payment-policy');
const { describe } = require('../lib/gateway-public');
const gateway = require('../lib/gateway-config');

const common = { active: true, kind: 'hosted_link', currency: 'USD', countries: ['US', 'CA'], sale_scope: 'goods' };
const card = { ...common, id: 'rampex-card', native_provider: 'rampex', rampex_provider: 'hosted' };
const crypto = { ...common, id: 'pure-crypto', native_provider: 'polygon_usdc' };
const interac = { ...common, id: 'interac', kind: 'interac', currency: 'CAD', native_provider: null, provider_key: 'interac', countries: ['CA'] };
const bankTransfer = { ...common, id: 'bank-transfer', kind: 'bank_transfer', native_provider: null, provider_key: 'bank_transfer' };
const retired = [
  { ...common, id: 'old-peptidepay', native_provider: 'peptidepay' },
  { ...common, id: 'old-tagada', native_provider: 'tagada' }
];

test('retired gateway methods never appear in the current PURE checkout method list', () => {
  const result = describe([card, crypto, interac, bankTransfer, ...retired]);
  assert.deepEqual(result.payment_options.map(option => option.key), ['card', 'crypto', 'interac']);
  assert.deepEqual(result.payment_methods.map(method => method.id), ['rampex-card', 'pure-crypto', 'interac']);
  assert.equal(result.card_to_crypto_connected, true);
  assert.equal(result.collection_mode, 'verified_card_crypto_or_interac');
});

test('PURE payment policy stays separate from legacy Stripe and retired providers', () => {
  assert.equal(paymentPolicy.kind(card), 'card');
  assert.equal(paymentPolicy.kind(crypto), 'crypto');
  assert.equal(paymentPolicy.kind(interac), 'interac');
  assert.equal(paymentPolicy.kind(bankTransfer), null);
  assert.equal(paymentPolicy.kind({ ...card, id: 'rampex-stripe-legacy-rail', rampex_provider: 'stripe' }), null);
  for (const method of retired) assert.equal(paymentPolicy.kind(method), null);
});

test('removing PeptidePay environment keys leaves its legacy gateway unready', () => {
  const status = gateway.configuration('peptidepay', {});
  assert.equal(status.enabled, false);
  assert.equal(status.ready, false);
  assert.equal(status.provider, 'peptidepay');
});

test('developer environment template cannot accidentally commit production credentials', () => {
  const root = path.join(__dirname, '..');
  const ignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  assert.match(ignore, /^\.env$/m);
  assert.match(ignore, /^\.env\.\*$/m);
  assert.match(ignore, /^!\.env\.example$/m);
  assert.match(ignore, /^\.vercel\/$/m);
  const example = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
  for (const key of ['RAMPEX_ENABLED', 'POLYGON_USDC_ENABLED', 'SUPABASE_URL', 'RESEND_API_KEY', 'SHIPPO_API_TOKEN']) {
    assert.match(example, new RegExp('^' + key + '=$', 'm'));
  }
  for (const key of ['TAGADA_API_KEY', 'LOTUS_PARTNER_API_KEY', 'PEPTIDEPAY_API_KEY']) {
    assert.doesNotMatch(example, new RegExp('^' + key + '=','m'));
  }
});

test('cleanup script is syntactically valid and never lists active payment keys for deletion', () => {
  const { spawnSync } = require('node:child_process');
  const script = path.join(__dirname, '..', 'scripts', 'retire-vercel-env-safe.sh');
  const check = spawnSync('bash', ['-n', script], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr || 'Invalid bash script');
  const source = fs.readFileSync(script, 'utf8');
  const removedNames = source.split('retired_production=(')[1]?.split(')')[0] || '';
  assert.match(removedNames, /PEPTIDEPAY_WEBHOOK_SECRET/);
  assert.match(removedNames, /LOTUS_PARTNER_API_KEY/);
  assert.match(removedNames, /TAGADA_API_KEY/);
  for (const key of ['RAMPEX_API_KEY', 'RAMPEX_WEBHOOK_SECRET', 'POLYGON_USDC_RECIPIENT', 'SUPABASE_SERVICE_ROLE_KEY']) {
    assert.doesNotMatch(removedNames, new RegExp(key));
  }
});
