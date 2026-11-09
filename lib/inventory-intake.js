'use strict';

/**
 * Validate a proposed supplier inventory import without touching the database.
 * This function never releases lots or enables product sales. The caller must
 * supply verified supplier UUIDs and exact catalog SKU keys from server data.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SKU = /^[a-z0-9][a-z0-9-]{1,119}$/;
function text(value,limit) {
  return typeof value === 'string' && value.trim().length > 0 &&
    value.trim().length <= limit ? value.trim() : null;
}
function normalizeInventoryIntake(rows, context) {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 500 ||
      !context || !Array.isArray(context.supplierIds) ||
      !Array.isArray(context.catalogSkuKeys)) {
    return { valid: false, error: 'INVALID_BATCH', accepted: [], rejected: [] };
  }
  const suppliers = new Set(context.supplierIds.filter(x => UUID.test(x)));
  const skus = new Set(context.catalogSkuKeys.filter(x => SKU.test(x)));
  const seen = new Set(), accepted = [], rejected = [];
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const supplier = text(row?.supplier_id,36);
    const sku = text(row?.sku_key,120);
    const lot = text(row?.lot_number,120);
    const site = text(row?.fulfillment_site,120);
    const reference = text(row?.supplier_evidence_reference,200);
    const count = row?.on_hand;
    const key = JSON.stringify([supplier,sku,lot,site]);
    let reason = null;
    if (!supplier || !suppliers.has(supplier)) reason = 'UNKNOWN_SUPPLIER';
    else if (!sku || !skus.has(sku)) reason = 'UNKNOWN_SKU';
    else if (!lot || !site || !reference) reason = 'MISSING_PROVENANCE';
    else if (!Number.isSafeInteger(count) || count < 0 || count > 1000000) reason = 'INVALID_QUANTITY';
    else if (row.composition_confirmed !== true || row.strength_confirmed !== true)
      reason = 'UNCONFIRMED_COMPOSITION';
    else if (seen.has(key)) reason = 'DUPLICATE_LOT';
    if (reason) {
      rejected.push({ index, reason });
      continue;
    }
    seen.add(key);
    accepted.push({
      supplier_id: supplier, sku_key: sku, lot_number: lot,
      fulfillment_site: site, on_hand: count, reserved: 0, damaged: 0,
      status: 'quarantine', evidence_reference: reference,
      reviewed_by: null, reviewed_at: null
    });
  }
  return { valid: rejected.length === 0, accepted, rejected };
}
module.exports = { normalizeInventoryIntake };
