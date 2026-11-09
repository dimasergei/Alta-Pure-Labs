'use strict';
/**
 * Admin-only inventory read model. Never exposes supplier contracts,
 * private COA storage keys, or product eligibility as a sale authorization.
 */
async function loadInventory(db) {
  const [lotsResult, docsResult] = await Promise.all([
    db.from('enterprise_inventory_lots')
      .select('id,supplier_id,sku_key,lot_number,fulfillment_site,status,on_hand,reserved,damaged,created_at,updated_at')
      .order('created_at', { ascending: false }).limit(100),
    db.from('enterprise_quality_documents')
      .select('id,lot_id,report_id,lab_name,status,publication_approved,created_at')
      .order('created_at', { ascending: false }).limit(100)
  ]);
  if (lotsResult.error || docsResult.error ||
      !Array.isArray(lotsResult.data) || !Array.isArray(docsResult.data)) {
    throw new Error('Inventory records unavailable.');
  }
  const lots = lotsResult.data.map(lot => ({
    ...lot,
    available_for_review: lot.status === 'released' ?
      Math.max(0,lot.on_hand-lot.reserved-lot.damaged) : 0,
    can_sell: false
  }));
  return {
    lots,
    quality_reports: docsResult.data,
    limited_to: 100,
    can_sell: false,
    generated_at: new Date().toISOString()
  };
}
module.exports = {loadInventory};
