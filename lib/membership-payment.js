'use strict';

// These paid-term checkout contracts are immutable. Historical membership
// requests and future checkout versions must never inherit payment permission.
const USD_VERSION = 'checkout-2026-11-v8';
const CAD_VERSION = 'checkout-interac-cad-2026-11-v2';
const CONVERSION_VERSION = 'conversion-2026-11-v3';
const PLANS = Object.freeze({
  vip: Object.freeze({name: 'PURE WHITE', monthly: 1999, annual: 19190}),
  elite: Object.freeze({name: 'PURE BLACK', monthly: 9999, annual: 95990})
});
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const zero = value => value === undefined || value === null || value === 0;
const empty = value => value === undefined || value === null || value === '';
const forbiddenBenefits = value => ['membership_gift', 'referral', 'referral_discount', 'bulk_tier', 'delivery_tax']
  .some(key => value[key] !== undefined && value[key] !== null);
const noDiscounts = value => ['coupon_discount_cents', 'crypto_discount_cents', 'membership_discount_cents',
  'payment_discount_cents', 'bank_discount_cents', 'bogo_free_units', 'free_qty', 'paid_qty', 'earned_points']
  .every(key => zero(value[key]));

function membershipDetails(invoice) {
  if (!object(invoice) || invoice.kind !== 'membership' || !Object.hasOwn(PLANS, invoice.plan)) return null;
  const request = invoice.request_data, pricing = invoice.pricing, plan = PLANS[invoice.plan];
  if (!object(request) || !object(pricing) || !object(request.checkout)) return null;
  const period = request.billing_period;
  if (!['monthly', 'annual'].includes(period)) return null;
  const cad = invoice.currency === 'CAD';
  if ((!cad && invoice.currency !== 'USD') || invoice.checkout_version !== (cad ? CAD_VERSION : USD_VERSION)
    || pricing.checkout_version !== invoice.checkout_version || pricing.currency !== invoice.currency
    || pricing.billing_period !== period || pricing.conversion_version !== CONVERSION_VERSION
    || pricing.billing_mode !== 'prepaid' || pricing.automatic_renewal !== false
    || request.checkout.version !== USD_VERSION) return null;
  if (['subscription', 'research_builder', 'bulk_order', 'automatic_renewal']
      .some(key => request[key] !== undefined && request[key] !== false)
    || request.research_builder_mode !== undefined
    || !empty(request.checkout.coupon) || request.checkout.points !== 0 || request.checkout.credit_cents !== 0
    || !empty(pricing.coupon_code) || !empty(invoice.membership_invoice_id)
    || ['discount_cents', 'shipping_cents', 'tax_cents', 'points_redeemed', 'credit_redeemed_cents', 'earned_points']
      .some(key => invoice[key] !== 0)
    || pricing.discount_cents !== 0 || pricing.redeemed_points !== 0 || pricing.credit_cents !== 0
    || !noDiscounts(pricing) || forbiddenBenefits(pricing)) return null;
  const fx = pricing.fx_ppm;
  if (!Number.isSafeInteger(fx) || fx < 100000 || fx > 10000000 || (!cad && fx !== 1000000)) return null;
  if (cad && (request.address?.country !== 'CA' || !object(pricing.fx) || pricing.fx.fx_ppm !== fx
    || pricing.fx.source !== 'Bank of Canada' || pricing.fx.series !== 'FXUSDCAD')) return null;
  const amount = Math.round(plan[period] * fx / 1000000);
  if (invoice.subtotal_cents !== amount || invoice.total_cents !== amount || pricing.subtotal_cents !== amount
    || !Array.isArray(request.items) || request.items.length !== 1
    || !Array.isArray(pricing.lines) || pricing.lines.length !== 1) return null;
  const item = request.items[0], line = pricing.lines[0];
  const canonical = {id: 'membership-' + invoice.plan, name: plan.name + ' — ' + period + ' prepaid membership',
    size: period, qty: 1, unit_price_usd_cents: plan[period]};
  if (!object(item) || !object(line) || Object.keys(item).length !== Object.keys(canonical).length
    || Object.entries(canonical).some(([key, value]) => item[key] !== value || line[key] !== value)
    || line.unit_price_cents !== amount || line.gross_cents !== amount || line.line_total_cents !== amount
    || line.discount_cents !== 0 || line.discount_bps !== 0 || line.discount_reason !== 'none'
    || !noDiscounts(line) || forbiddenBenefits(line)) return null;
  return {plan: invoice.plan, name: plan.name, period, months: period === 'monthly' ? 1 : 12,
    amount_cents: amount, currency: invoice.currency, automatic_renewal: false};
}

function isMembershipInvoice(invoice) { return membershipDetails(invoice) !== null; }

function supportsMembershipPayment(invoice, accountOrMethod) {
  if (!isMembershipInvoice(invoice) || !object(accountOrMethod)) return false;
  const account = accountOrMethod, method = account.method || account;
  if (method.active !== true || !['membership', 'both'].includes(method.sale_scope) || method.currency !== invoice.currency
    || method.id !== invoice.method_id) return false;
  if (invoice.currency === 'CAD') return method.kind === 'interac' && method.provider_key === 'interac'
    && !method.native_provider && !account.provider;
  if (!account.method || method.kind !== 'hosted_link' || method.provider_key !== 'custom'
    || account.method_id !== invoice.method_id || account.mode !== 'live' || account.provider !== method.native_provider
    || !Array.isArray(account.countries) || !account.countries.includes(invoice.request_data.address?.country)) return false;
  return account.provider === 'polygon_usdc'
    || account.provider === 'rampex' && account.rampex_provider === 'hosted';
}

function allowsPayment(invoice, accountOrMethod) {
  return invoice?.kind === 'goods' || supportsMembershipPayment(invoice, accountOrMethod);
}

module.exports = {USD_VERSION, CAD_VERSION, CONVERSION_VERSION, membershipDetails, isMembershipInvoice,
  supportsMembershipPayment, allowsPayment};
