const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('proposed admin lifecycle migration preserves order records and audits batch deletion', () => {
  const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase/migrations/20261108120000_admin_dashboard_lifecycle_safety.sql'), 'utf8');
  assert.match(migration, /add column if not exists archived_at/);
  assert.match(migration, /supplier_batch_audit/);
  assert.match(migration, /prevent_duplicate_active_supplier_batch_item/);
  assert.match(migration, /admin_delete_supplier_batch/);
  assert.match(migration, /Only draft or canceled batches can be permanently deleted/);
  assert.match(migration, /delete from public\.supplier_batch_items/);
  assert.match(migration, /delete from public\.supplier_batches/);
  assert.doesNotMatch(migration, /delete from public\.store_orders/i);
});
