'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PAYMENT_RAILS,
  skuKey,
  evaluateShipping,
  evaluatePaymentRail
} = require('../lib/commerce-eligibility');

const NOW = new Date('2026-11-09T12:00:00.000Z');
const CART = [
  { product_id: 'bpc-157', variant_size: '10mg', quantity: 1 }
];
const OTHER = { product_id: 'bac-3', variant_size: '3 mL', quantity: 2 };
function shippingRequest(items = CART) {
  return {
    items,
    destination_country: 'US',
    destination_region_or_state: 'NY',
    fulfillment_origin_country: 'US',
    fulfillment_site: 'warehouse-1',
    shipping_service: 'ground-approved'
  };
}
function shippingLane(overrides = {}) {
  return {
    sku_key: 'bpc-157-10mg',
    destination_country: 'US',
    destination_region_or_state: 'NY',
    fulfillment_origin_country: 'US',
    fulfillment_site: 'warehouse-1',
    shipping_service: 'ground-approved',
    decision: 'APPROVED',
    regulatory_review_reference: 'internal-evidence/regulatory-review-001',
    authorization_or_exemption_reference: 'internal-evidence/lawful-route-001',
    carrier_written_acceptance_reference: 'internal-evidence/carrier-001',
    exporter_of_record: 'documented-exporter',
    importer_of_record: 'documented-importer',
    reviewer: 'qualified-reviewer',
    review_date: '2026-11-01',
    recheck_date: '2027-01-01',
    ...overrides
  };
}
function paymentRequest(items = CART) {
  return {
    items,
    rail: 'card',
    provider_id: 'provider-1',
    customer_country: 'US',
    currency: 'USD',
    shipping_allowed: true
  };
}
function railApproval(overrides = {}) {
  return {
    rail: 'card',
    provider_id: 'provider-1',
    customer_country: 'US',
    currency: 'USD',
    decision: 'APPROVED',
    acquiring_bank_name: 'documented-bank',
    written_bank_approval_reference: 'internal-evidence/acquirer-sku-approval-001',
    executed_merchant_agreement_reference: 'internal-evidence/contract-001',
    approved_sku_keys: ['bpc-157-10mg'],
    reviewer: 'qualified-reviewer',
    review_date: '2026-11-01',
    recheck_date: '2027-01-01',
    ...overrides
  };
}

test('SKU keys are deterministic for all catalog size formats', () => {
  assert.equal(skuKey('bpc-157', '10mg'), 'bpc-157-10mg');
  assert.equal(skuKey('bpc-tb-500', '10mg/10mg'), 'bpc-tb-500-10mg-10mg');
  assert.equal(skuKey('bac-3', '3 mL'), 'bac-3-3-ml');
  assert.equal(skuKey('needles', '10pk'), 'needles-10pk');
  assert.equal(skuKey('*', '10mg'), null);
});

test('shipping is denied with no approvals or missing dimensions', () => {
  assert.equal(evaluateShipping(shippingRequest(), [], NOW).allowed, false);
  assert.equal(evaluateShipping(shippingRequest(), null, NOW).allowed, false);
  assert.equal(evaluateShipping({ ...shippingRequest(), fulfillment_site: '' }, [shippingLane()], NOW).allowed, false);
  assert.equal(evaluateShipping({ ...shippingRequest(), destination_country: '*' }, [shippingLane()], NOW).allowed, false);
});

test('shipping requires the exact SKU, country, region, origin, site and service', () => {
  assert.equal(evaluateShipping(shippingRequest(), [shippingLane()], NOW).allowed, true);
  const changes = [
    { destination_country: 'CA' },
    { destination_region_or_state: 'FL' },
    { fulfillment_origin_country: 'CA' },
    { fulfillment_site: 'other-warehouse' },
    { shipping_service: 'priority' }
  ];
  for (const change of changes) {
    assert.equal(evaluateShipping({ ...shippingRequest(), ...change }, [shippingLane()], NOW).allowed, false);
  }
});

test('shipping denies incomplete, pending, expired and duplicate lane records', () => {
  const variants = [
    { decision: 'HOLD' },
    { carrier_written_acceptance_reference: '' },
    { authorization_or_exemption_reference: '' },
    { importer_of_record: '' },
    { reviewer: '' },
    { review_date: '2027-01-01' },
    { recheck_date: '2026-11-01' }
  ];
  for (const v of variants) {
    assert.equal(evaluateShipping(shippingRequest(), [shippingLane(v)], NOW).allowed, false);
  }
  assert.equal(evaluateShipping(shippingRequest(), [shippingLane(), shippingLane()], NOW).allowed, false);
});

test('one unapproved line denies the whole cart, including BAC Water or needles', () => {
  const cart = [CART[0], OTHER];
  assert.equal(evaluateShipping(shippingRequest(cart), [shippingLane()], NOW).allowed, false);
  assert.equal(evaluateShipping(shippingRequest(cart), [
    shippingLane(), shippingLane({ sku_key: 'bac-3-3-ml' })
  ], NOW).allowed, true);
});

test('invalid or duplicate cart lines are rejected before evaluating any lane', () => {
  assert.equal(evaluateShipping(shippingRequest([]), [shippingLane()], NOW).allowed, false);
  assert.equal(evaluateShipping(shippingRequest([CART[0], CART[0]]), [shippingLane()], NOW).allowed, false);
  assert.equal(evaluateShipping(shippingRequest([{ ...CART[0], quantity: 0 }]), [shippingLane()], NOW).allowed, false);
});

test('payment rail registry includes requested methods, none approved by default', () => {
  assert.deepEqual(PAYMENT_RAILS, ['card','ach','wire','zelle','venmo','cash_app','interac','btc']);
  for (const rail of PAYMENT_RAILS) {
    assert.equal(evaluatePaymentRail({ ...paymentRequest(), rail }, [], NOW).allowed, false);
  }
});

test('payment requires shipping approval, signed contract and bank SKU approval', () => {
  assert.equal(evaluatePaymentRail(paymentRequest(), [railApproval()], NOW).allowed, true);
  assert.equal(evaluatePaymentRail({ ...paymentRequest(), shipping_allowed: false }, [railApproval()], NOW).allowed, false);
  assert.equal(evaluatePaymentRail(paymentRequest(), [railApproval({ executed_merchant_agreement_reference: '' })], NOW).allowed, false);
  assert.equal(evaluatePaymentRail(paymentRequest(), [railApproval({ written_bank_approval_reference: '' })], NOW).allowed, false);
});

test('payment denies different countries, rails, currencies, products and duplicate approvals', () => {
  for (const p of [
    { customer_country: 'CA' }, { currency: 'CAD' }, { rail: 'btc' }, { provider_id: 'other' }
  ]) {
    assert.equal(evaluatePaymentRail({ ...paymentRequest(), ...p }, [railApproval()], NOW).allowed, false);
  }
  assert.equal(evaluatePaymentRail(paymentRequest([OTHER]), [railApproval()], NOW).allowed, false);
  assert.equal(evaluatePaymentRail(paymentRequest(), [railApproval(), railApproval()], NOW).allowed, false);
  assert.equal(evaluatePaymentRail(paymentRequest(), [railApproval({ recheck_date: '2026-11-01' })], NOW).allowed, false);
});
