'use strict';

/**
 * Enterprise capability registry.
 * Planning metadata only. NOT a payment, shipping, sale, or feature-activation
 * switch. It must never be used to authorize checkout or shipments.
 */
const CAPABILITIES = Object.freeze([
  { id: 'catalog', title: 'Catalog and variants', stage: 'existing', requires: [] },
  { id: 'customer-accounts', title: 'Customer identity and orders', stage: 'existing', requires: ['catalog'] },
  { id: 'admin-operations', title: 'Orders, suppliers and notifications', stage: 'existing', requires: ['customer-accounts'] },
  { id: 'checkout-paused', title: 'Paused payment checkout', stage: 'existing', requires: ['catalog'] },
  { id: 'commerce-eligibility', title: 'Fail-closed eligibility primitives', stage: 'foundation', requires: ['catalog'] },
  { id: 'sku-evidence', title: 'Supplier and SKU evidence verification', stage: 'planned', requires: ['catalog'] },
  { id: 'batch-coa-library', title: 'Verified lot and COA library', stage: 'planned', requires: ['sku-evidence'] },
  { id: 'price-books', title: 'Versioned prices and promotion rules', stage: 'planned', requires: ['catalog'] },
  { id: 'bulk-ordering', title: 'Bulk price and quantity engine', stage: 'planned', requires: ['price-books', 'commerce-eligibility'] },
  { id: 'memberships', title: 'Membership entitlements', stage: 'planned', requires: ['customer-accounts', 'price-books'] },
  { id: 'rewards', title: 'Points and store-credit ledgers', stage: 'planned', requires: ['customer-accounts', 'memberships'] },
  { id: 'subscriptions', title: 'Research builder and recurring deliveries', stage: 'planned', requires: ['memberships', 'price-books', 'supplier-routing'] },
  { id: 'affiliates', title: 'Referral tracking and commission ledger', stage: 'planned', requires: ['customer-accounts', 'price-books'] },
  { id: 'supplier-routing', title: 'Multi-supplier routing and inventory', stage: 'planned', requires: ['sku-evidence', 'batch-coa-library'] },
  { id: 'shipment-tracking', title: 'Shipment event tracking and exceptions', stage: 'planned', requires: ['supplier-routing'] },
  { id: 'international-lanes', title: 'Country and carrier shipping lane review', stage: 'planned', requires: ['commerce-eligibility', 'sku-evidence', 'supplier-routing'] },
  { id: 'provider-adapters', title: 'Bank-approved payment-provider adapters', stage: 'blocked', requires: ['commerce-eligibility', 'international-lanes'] },
  { id: 'checkout-cutover', title: 'Payment and shipping cutover', stage: 'blocked', requires: ['provider-adapters', 'shipment-tracking'] },
  { id: 'analytics', title: 'Operational analytics and audit', stage: 'planned', requires: ['admin-operations', 'price-books'] }
]);

const VALID_STAGES = Object.freeze(['existing', 'foundation', 'planned', 'blocked']);

function validateCapabilities(capabilities = CAPABILITIES) {
  if (!Array.isArray(capabilities)) return { valid: false, error: 'NOT_ARRAY' };
  const byId = new Map();
  for (const c of capabilities) {
    if (!c || typeof c.id !== 'string' || !/^[a-z0-9-]+$/.test(c.id) ||
        typeof c.title !== 'string' || !c.title.trim() ||
        !VALID_STAGES.includes(c.stage) || !Array.isArray(c.requires) ||
        byId.has(c.id)) return { valid: false, error: 'INVALID_OR_DUPLICATE' };
    byId.set(c.id, c);
  }
  const visiting = new Set(), visited = new Set();
  function walk(id) {
    if (visiting.has(id)) return false;
    if (visited.has(id)) return true;
    const c = byId.get(id);
    if (!c) return false;
    visiting.add(id);
    for (const dep of c.requires) if (dep === id || !walk(dep)) return false;
    visiting.delete(id);
    visited.add(id);
    return true;
  }
  for (const id of byId.keys()) if (!walk(id)) return { valid: false, error: 'MISSING_DEPENDENCY_OR_CYCLE' };
  return { valid: true, count: byId.size };
}

function listCapabilities(stage) {
  return CAPABILITIES.filter(c => !stage || c.stage === stage)
    .map(c => ({ ...c, requires: [...c.requires] }));
}

module.exports = { CAPABILITIES, VALID_STAGES, validateCapabilities, listCapabilities };
