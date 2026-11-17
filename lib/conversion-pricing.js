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
function membershipItem(){throw Object.assign(Error('Membership purchases are unavailable.'),{status:409});}
function shipping(merchandise, membership) {
  return merchandise >= config.free_shipping_threshold_cents ? 0 : checkout.shipping_cents;
}
function earnings(paidMerchandise, membership) {
  return 0;
}
function bankLabel(method) {
  return method.kind === 'bank_transfer' ? 'Same-day bank transfer' : method.label;
}
module.exports = {config, planFor, billingPeriod, membershipItem, shipping, earnings, bankLabel};
