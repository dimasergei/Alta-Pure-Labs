'use strict';
const { createHash, timingSafeEqual } = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');

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

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!authorized(req.headers?.['x-admin-password'], process.env.ADMIN_ORDERS_PASSWORD)) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(503).json({ error: 'Operational overview unavailable.' });
  }
  try {
    const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } });
    const result = await loadOverview(db);
    // This is a monitoring response; never imply the checkout gate is enabled.
    result.checkout_enabled = process.env.CHECKOUT_ENABLED === 'true';
    return res.status(200).json(result);
  } catch (error) {
    console.error('Operational overview query failed', { name: error.name });
    return res.status(503).json({ error: 'Operational overview unavailable.' });
  }
}
module.exports = handler;
module.exports.authorized = authorized;
module.exports.loadOverview = loadOverview;
