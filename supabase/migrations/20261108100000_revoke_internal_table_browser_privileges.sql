-- Migration 1: remove direct browser-role privileges from internal tables.
-- RLS remains enabled. service_role and postgres grants are untouched.
BEGIN;

REVOKE ALL PRIVILEGES ON TABLE
  public.order_status_notifications,
  public.suppliers,
  public.supplier_batches,
  public.supplier_batch_items
FROM anon, authenticated;

COMMIT;
