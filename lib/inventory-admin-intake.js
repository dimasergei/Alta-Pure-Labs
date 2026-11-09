'use strict';
const { normalizeInventoryIntake } = require('./inventory-intake');
const { catalogSkuKeys } = require('./catalog-sku-keys');

async function inventoryIntake(db, rows, commit = false) {
  if (!Array.isArray(rows) || rows.length !== 1) {
    return { valid: false, error: 'ONE_LOT_PER_REQUEST', accepted: [], rejected: [], saved: false, can_sell: false };
  }
  const { data: suppliers, error: supplierError } = await db.from('suppliers')
    .select('id').eq('active', true).limit(200);
  if (supplierError || !Array.isArray(suppliers)) throw new Error('Supplier verification unavailable.');
  const result = normalizeInventoryIntake(rows, {
    supplierIds: suppliers.map(x => x.id),
    catalogSkuKeys: catalogSkuKeys()
  });
  if (!result.valid || !commit) return { ...result, saved: false, can_sell: false };
  const entry = result.accepted[0];
  // A submitted supplier statement is only intake provenance, not a reviewed COA.
  // Never grant a quality release, publish a report, or create an order.
  const { data, error } = await db.from('enterprise_inventory_lots')
    .insert({
      supplier_id: entry.supplier_id, sku_key: entry.sku_key,
      lot_number: entry.lot_number, fulfillment_site: entry.fulfillment_site,
      on_hand: entry.on_hand, reserved: 0, damaged: 0,
      status: 'quarantine', evidence_reference: entry.evidence_reference,
      reviewed_by: null, reviewed_at: null
    })
    .select('id,sku_key,lot_number,status').single();
  if (error) {
    if (error.code === '23505') return { valid: false, error: 'DUPLICATE_LOT', accepted: [], rejected: [{ index: 0, reason: 'DUPLICATE_LOT' }], saved: false, can_sell: false };
    throw new Error('Inventory import failed.');
  }
  return { valid: true, saved: true, can_sell: false, lot: data, accepted: [], rejected: [] };
}
module.exports = { inventoryIntake };
