'use strict';

/**
 * Pure, fail-closed planning checks for a future payment-provider migration.
 *
 * NOT CONNECTED TO LIVE CHECKOUT. Existing checkout and Stripe handling remain
 * unchanged. Callers must validate items against the server-side catalog first.
 * This module does not constitute legal or processor authorization.
 */
const PAYMENT_RAILS = Object.freeze([
  'card', 'ach', 'wire', 'zelle', 'venmo', 'cash_app', 'interac', 'btc'
]);

function nonempty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function exact(value) {
  return nonempty(value) && !value.includes('*') && !value.includes('?');
}

function isCountry(value) {
  return typeof value === 'string' && /^[A-Z]{2}$/.test(value);
}

function isoDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(value + 'T00:00:00.000Z');
  return Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value ? null : parsed;
}

function approvalIsCurrent(approval, now) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) return false;
  const review = isoDay(approval.review_date);
  const recheck = isoDay(approval.recheck_date);
  return !!review && !!recheck && review.getTime() <= now.getTime() &&
    recheck.getTime() > now.getTime();
}

function skuKey(productId, variantSize) {
  if (!exact(productId) || !exact(variantSize)) return null;
  if (!/^[a-z0-9-]+$/.test(productId)) return null;
  const normalizedVariant = variantSize.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return normalizedVariant ? productId + '-' + normalizedVariant : null;
}

function itemsToKeys(items) {
  if (!Array.isArray(items) || !items.length || items.length > 100) return null;
  const seen = new Set();
  for (const item of items) {
    if (!item || !Number.isSafeInteger(item.quantity) || item.quantity < 1 ||
        item.quantity > 100) return null;
    const key = skuKey(item.product_id, item.variant_size);
    if (!key || seen.has(key)) return null;
    seen.add(key);
  }
  return [...seen];
}

function deny(reason, skuKeys) {
  return { allowed: false, reason, skuKeys: skuKeys || [] };
}

/**
 * Requires a distinct, completed approval for each SKU and exact shipping
 * lane. Empty/duplicate/conflicting rows, unapproved statuses, missing
 * evidence, and expired reviews must all fail closed.
 *
 * Lane fields follow compliance/shipping-lane-register-template.csv.
 */
function evaluateShipping(request, lanes, now = new Date()) {
  if (!request || typeof request !== 'object') return deny('INVALID_REQUEST');
  const keys = itemsToKeys(request.items);
  if (!keys) return deny('INVALID_ITEMS');

  const country = request.destination_country;
  const region = request.destination_region_or_state || '';
  const origin = request.fulfillment_origin_country;
  const site = request.fulfillment_site;
  const service = request.shipping_service;

  if (!isCountry(country) || (region && !exact(region)) ||
      !isCountry(origin) || !exact(site) || !exact(service)) {
    return deny('INCOMPLETE_LANE', keys);
  }
  if (!Array.isArray(lanes)) return deny('NO_LANES', keys);

  for (const key of keys) {
    const matches = lanes.filter(row =>
      row && row.sku_key === key &&
      row.destination_country === country &&
      (row.destination_region_or_state || '') === region &&
      row.fulfillment_origin_country === origin &&
      row.fulfillment_site === site &&
      row.shipping_service === service
    );
    if (matches.length !== 1) return deny('LANE_NOT_UNIQUELY_APPROVED', [key]);
    const row = matches[0];
    if (row.decision !== 'APPROVED' ||
        !exact(row.regulatory_review_reference) ||
        !exact(row.authorization_or_exemption_reference) ||
        !exact(row.carrier_written_acceptance_reference) ||
        !exact(row.exporter_of_record) ||
        !exact(row.importer_of_record) ||
        !exact(row.reviewer) || !approvalIsCurrent(row, now)) {
      return deny('LANE_NOT_APPROVED', [key]);
    }
  }
  return { allowed: true, reason: 'ALL_LANES_APPROVED', skuKeys: keys };
}

/**
 * Independent of shipping: every payment rail requires an actual signed
 * provider contract and written underwriting for the exact catalog.
 * Vendor claims or technical API support are not authorization.
 */
function evaluatePaymentRail(request, approvals, now = new Date()) {
  if (!request || typeof request !== 'object') return deny('INVALID_REQUEST');
  const keys = itemsToKeys(request.items);
  if (!keys) return deny('INVALID_ITEMS');
  if (!PAYMENT_RAILS.includes(request.rail) ||
      !exact(request.provider_id) || !isCountry(request.customer_country) ||
      typeof request.currency !== 'string' ||
      !/^[A-Z]{3}$/.test(request.currency)) {
    return deny('INCOMPLETE_PAYMENT_SCOPE', keys);
  }
  if (request.shipping_allowed !== true) return deny('SHIPPING_NOT_APPROVED', keys);
  if (!Array.isArray(approvals)) return deny('NO_PROVIDER_APPROVALS', keys);

  const matches = approvals.filter(row =>
    row && row.rail === request.rail &&
    row.provider_id === request.provider_id &&
    row.customer_country === request.customer_country &&
    row.currency === request.currency
  );
  if (matches.length !== 1) return deny('PAYMENT_SCOPE_NOT_UNIQUELY_APPROVED', keys);
  const row = matches[0];
  if (row.decision !== 'APPROVED' ||
      !exact(row.acquiring_bank_name) ||
      !exact(row.written_bank_approval_reference) ||
      !exact(row.executed_merchant_agreement_reference) ||
      !exact(row.reviewer) || !approvalIsCurrent(row, now) ||
      !Array.isArray(row.approved_sku_keys) ||
      !keys.every(key => row.approved_sku_keys.includes(key))) {
    return deny('PAYMENT_SCOPE_NOT_APPROVED', keys);
  }
  return { allowed: true, reason: 'RAIL_AND_CATALOG_APPROVED', skuKeys: keys };
}

module.exports = {
  PAYMENT_RAILS,
  skuKey,
  itemsToKeys,
  evaluateShipping,
  evaluatePaymentRail
};
