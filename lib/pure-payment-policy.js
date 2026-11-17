'use strict';
// New checkout policy only. Historical invoices retain their original payment route.
const checkout = require('../config/checkout.json');
const VERSION = 'pure-payments-2026-11-v1';
const CRYPTO_BPS = 500;

function kind(method) {
  if (method?.native_provider === 'rampex' && method.rampex_provider === 'hosted') return 'card';
  if (method?.native_provider === 'polygon_usdc') return 'crypto';
  return null;
}

function publicMethod(method) {
  const paymentKind = kind(method);
  return {
    id: method.id, label: paymentKind === 'card' ? 'Card' : 'Crypto',
    kind: method.kind, currency: method.currency, native_provider: method.native_provider,
    provider_key: method.provider_key, sale_scope: 'goods',
    payment_kind: paymentKind, countries: [...method.countries],
    display_order: paymentKind === 'card' ? 1 : 2,
    ...(paymentKind === 'card' ? {rampex_provider: 'hosted'} : {crypto_discount_bps: CRYPTO_BPS})
  };
}

function choices(methods) {
  return ['card', 'crypto'].map(key => {
    const method = methods.find(value => kind(value) === key);
    return {
      key, name: key === 'card' ? 'Card' : 'Crypto',
      status: method ? 'available' : 'setup_pending',
      method_id: method?.id || null, countries: method?.countries || [],
      description: key === 'card'
        ? 'Pay through secure card-to-crypto checkout. The provider displays its fees, conversion rate and final charge before payment. Available cards and digital wallets depend on your country, device and provider eligibility.'
        : method
          ? 'Pay USDC directly on Polygon from a compatible browser wallet. You need USDC and enough POL for network gas. The exact authorization and recipient are shown before you sign; payment is confirmed on chain before fulfillment.'
          : 'Direct USDC on Polygon is being configured. No wallet transfer is requested until the receiving address and on-chain payment confirmation are verified.',
      ...(key === 'crypto' ? {discount_bps: CRYPTO_BPS, discount_policy: 'Best single discount: 5% crypto or an entered valid coupon. Discounts do not combine.'} : {})
    };
  });
}

function applyDiscount(pricing, method, {suppressForBalance = false} = {}) {
  const eligible = kind(method) === 'crypto';
  const couponBps = pricing.coupon_code ? checkout.promotions.coupon_discount_bps : 0;
  const useCrypto = eligible && !suppressForBalance && CRYPTO_BPS > couponBps;
  pricing.payment_discount_version = VERSION;
  pricing.crypto_discount_eligible = eligible;
  pricing.crypto_discount_suppressed_for_balance = eligible && suppressForBalance;
  pricing.crypto_discount_cents = 0;
  pricing.discount_source = pricing.coupon_code ? 'coupon' : 'none';
  if (!useCrypto) {
    pricing.lines = pricing.lines.map(line => ({...line, crypto_discount_cents: 0}));
    return pricing;
  }
  const savings = Math.round(pricing.subtotal_cents * CRYPTO_BPS / 10000);
  const discounts = pricing.lines.map(line => Math.floor(line.gross_cents * CRYPTO_BPS / 10000));
  const pennies = savings - discounts.reduce((sum, amount) => sum + amount, 0);
  const ranked = pricing.lines.map((line, index) => ({index, remainder: line.gross_cents * CRYPTO_BPS % 10000}))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let index = 0; index < pennies; index++) discounts[ranked[index].index]++;
  pricing.lines = pricing.lines.map((line, index) => ({...line,
    discount_cents: discounts[index], crypto_discount_cents: discounts[index],
    coupon_discount_cents: 0, discount_bps: CRYPTO_BPS, discount_reason: 'crypto_direct',
    line_total_cents: line.gross_cents - discounts[index]
  }));
  pricing.discount_cents = savings;
  pricing.crypto_discount_cents = savings;
  pricing.coupon_discount_cents = 0;
  pricing.discount_source = 'crypto';
  return pricing;
}

module.exports = {VERSION, CRYPTO_BPS, kind, publicMethod, choices, applyDiscount};
