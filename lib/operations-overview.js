'use strict';
const COUNTS = Object.freeze([
  ['orders_total', 'store_orders', null],
  ['orders_paid', 'store_orders', ['payment_status', 'paid']],
  ['orders_unfulfilled', 'store_orders', ['fulfillment_status', 'unfulfilled']],
  ['orders_processing', 'store_orders', ['fulfillment_status', 'processing']],
  ['orders_shipped', 'store_orders', ['fulfillment_status', 'shipped']],
  ['orders_delivered', 'store_orders', ['fulfillment_status', 'delivered']],
  ['suppliers_total', 'suppliers', null],
  ['suppliers_active', 'suppliers', ['active', true]],
  ['supplier_batches_total', 'supplier_batches', null],
  ['notifications_total', 'order_status_notifications', null]
]);

function authorized(provided, expected) {
  if (typeof expected !== 'string' || expected.length < 32 ||
      typeof provided !== 'string' || provided.length > 4096) return false;
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

async function loadOverview(db) {
  const counts = {};
  for (const [key, table, filter] of COUNTS) {
    let query = db.from(table).select('*', { count: 'exact', head: true });
    if (filter) query = query.eq(filter[0], filter[1]);
    const result = await query;
    if (result.error || !Number.isSafeInteger(result.count) || result.count < 0) {
      throw new Error('Operational count unavailable: ' + key);
    }
    counts[key] = result.count;
  }
  return { counts, checkout_enabled: false, data_scope: 'live_counts', generated_at: new Date().toISOString() };
}


module.exports={COUNTS,loadOverview};
