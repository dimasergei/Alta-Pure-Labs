'use strict';
// New checkout policy only. Historical invoices retain their original payment route.
const checkout = require('../config/checkout.json');
const VERSION = checkout.payments.version;
const CRYPTO_BPS = checkout.payments.crypto_discount_bps;

function kind(method) {
  if (method?.kind === 'interac' || method?.provider_key === 'interac') {
    return method.kind === 'interac' && method.currency === 'CAD' && !method.native_provider && method.provider_key === 'interac' ? 'interac' : null;
  }
  if (method?.native_provider === 'rampex' && method.rampex_provider === 'hosted') return 'card';
  if (method?.native_provider === 'polygon_usdc') return 'crypto';
  return null;
}

function publicMethod(method) {
  const paymentKind = kind(method);
  return {
    id: method.id, label: paymentKind === 'interac' ? 'Interac e-Transfer' : paymentKind === 'card' ? 'Card' : 'Crypto',
    kind: method.kind, currency: method.currency, native_provider: method.native_provider,
    provider_key: method.provider_key, sale_scope: method.sale_scope || 'goods',
    payment_kind: paymentKind, countries: [...method.countries],
    display_order: paymentKind === 'interac' ? 3 : paymentKind === 'card' ? 1 : 2,
    ...(paymentKind === 'interac' ? {manual_transfer: true, payment_currency: 'CAD', mode: 'direct_transfer'}
      : paymentKind === 'card' ? {rampex_provider: 'hosted'} : {crypto_discount_bps: CRYPTO_BPS})
  };
}

function choices(methods) {
  return ['card', 'crypto', 'interac'].map(key => {
    const method = methods.find(value => kind(value) === key);
    return {
      key, name: key === 'interac' ? 'Interac e-Transfer' : key === 'card' ? 'Card' : 'Crypto',
      status: method ? 'available' : 'setup_pending',
      method_id: method?.id || null, countries: method?.countries || [],
      description: key === 'interac'
        ? 'Pay by Interac e-Transfer in CAD. Your exact CAD total and receiving instructions are shown at checkout. Your order is confirmed for fulfillment after the payment reaches our bank account.'
        : key === 'card'
        ? 'Pay through secure card-to-crypto checkout. The provider displays its fees, conversion rate and final charge before payment. Available cards and digital wallets depend on your country, device and provider eligibility.'
        : method
          ? 'Pay USDC directly on Polygon from a compatible browser wallet. You need USDC and enough POL for network gas. The exact authorization and recipient are shown before you sign; payment is confirmed on chain before fulfillment.'
          : 'Direct USDC on Polygon is being configured. No wallet transfer is requested until the receiving address and on-chain payment confirmation are verified.',
      ...(key === 'crypto' ? {discount_bps: CRYPTO_BPS, discount_policy: 'Save an extra 5% on merchandise after any applied coupon. Shipping, tax and fees are excluded. A remaining Crypto payment is required.'}
        : key === 'interac' ? {manual_transfer: true, payment_currency: 'CAD', mode: 'direct_transfer'} : {})
    };
  });
}

function applyDiscount(pricing, method, {suppressForBalance = false} = {}) {
  const eligible = kind(method) === 'crypto';
  const useCrypto = eligible && !suppressForBalance;
  pricing.payment_discount_version = VERSION;
  pricing.crypto_discount_eligible = eligible;
  pricing.crypto_discount_suppressed_for_balance = eligible && suppressForBalance;
  pricing.crypto_discount_cents = 0;
  const baseSource=pricing.quantity_discount_cents>0?(pricing.membership_discount_cents>0||pricing.coupon_discount_cents>0?'mixed':'quantity'):pricing.membership_discount_cents>0?'membership':pricing.coupon_discount_cents>0?'coupon':'none';
  pricing.discount_source = baseSource;
  if (!useCrypto) {
    pricing.lines = pricing.lines.map(line => ({...line, crypto_discount_cents: 0}));
    return pricing;
  }
  // Coupon savings are already rounded and allocated. Apply the additional
  // Crypto discount to the remaining merchandise, preserving every earlier cent.
  const netMerchandise = pricing.subtotal_cents - pricing.discount_cents;
  const netLines = pricing.lines.map(line => line.gross_cents - line.discount_cents);
  const savings = Math.round(netMerchandise * CRYPTO_BPS / 10000);
  const discounts = netLines.map(amount => Math.floor(amount * CRYPTO_BPS / 10000));
  const pennies = savings - discounts.reduce((sum, amount) => sum + amount, 0);
  const ranked = netLines.map((amount, index) => ({index, remainder: amount * CRYPTO_BPS % 10000}))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let index = 0; index < pennies; index++) discounts[ranked[index].index]++;
  pricing.lines = pricing.lines.map((line, index) => ({...line,
    discount_cents: line.discount_cents + discounts[index], crypto_discount_cents: discounts[index],
    discount_bps: line.discount_bps + (10000 - line.discount_bps) * CRYPTO_BPS / 10000,
    discount_reason: line.membership_discount_cents>0 ? line.discount_reason+'_crypto_direct' : line.coupon_discount_cents>0 ? 'coupon_blackfriday15_crypto_direct' : line.quantity_discount_cents>0 ? line.discount_reason+'_crypto_direct' : 'crypto_direct',
    line_total_cents: netLines[index] - discounts[index]
  }));
  pricing.discount_cents += savings;
  pricing.crypto_discount_cents = savings;
  pricing.discount_source = baseSource==='none'?'crypto':baseSource+'_crypto';
  return pricing;
}

module.exports = {VERSION, CRYPTO_BPS, kind, publicMethod, choices, applyDiscount};
