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
function membershipItem(plan, period = 'monthly') {
  if (!config.memberships_enabled || !['vip', 'elite'].includes(plan)) throw Object.assign(Error('Choose PURE WHITE or PURE BLACK.'), {status:400});
  const term = billingPeriod(period), details = config.plans[plan];
  return {id:'membership-'+plan, name:details.name+' — '+term+' prepaid membership', size:term, qty:1,
    unit_price_usd_cents:details[term+'_cents']};
}
function shipping(merchandise, membership) {
  return planFor(membership).free_shipping || merchandise >= config.free_shipping_threshold_cents ? 0 : checkout.shipping_cents;
}
function earnings(paidMerchandise, membership) {
  return Math.floor(Math.max(0, paidMerchandise) * planFor(membership).points_per_dollar / 100);
}
function bankLabel(method) {
  return method.kind === 'bank_transfer' ? 'Same-day bank transfer' : method.label;
}
module.exports = {config, planFor, billingPeriod, membershipItem, shipping, earnings, bankLabel};
