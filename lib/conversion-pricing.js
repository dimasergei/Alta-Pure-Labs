'use strict';
const config = require('../config/conversion.json');
const checkout = require('../config/checkout.json');
function planFor(membership) {
  return config.plans[membership?.plan] || config.plans.member;
}
function billingPeriod(value = 'monthly') {
  if (!['monthly', 'annual'].includes(value)) throw Object.assign(Error('Choose monthly or annual membership.'), {status:400});
  return value;
}
function membershipItem(plan, period) {
  if (!['vip','elite'].includes(plan)) throw Object.assign(Error('Choose a paid membership.'), {status:400});
  period = billingPeriod(period);
  const p = config.plans[plan];
  return {id:'membership-'+plan, name:p.name, size:period === 'annual' ? 'Annual membership — no automatic renewal' : 'Monthly membership — no automatic renewal', qty:1, unit_price_usd_cents:p[period+'_cents']};
}
function shipping(merchandise, membership) {
  return membership && planFor(membership).free_shipping || merchandise >= config.free_shipping_threshold_cents ? 0 : checkout.shipping_cents;
}
function earnings(paidMerchandise, membership) {
  return Math.floor(Math.max(0, paidMerchandise) * planFor(membership).points_per_dollar / 100);
}
function bankLabel(method) {
  return method.kind === 'bank_transfer' ? 'Same-day bank transfer (5% off products)' : method.label;
}
module.exports = {config, planFor, billingPeriod, membershipItem, shipping, earnings, bankLabel};
