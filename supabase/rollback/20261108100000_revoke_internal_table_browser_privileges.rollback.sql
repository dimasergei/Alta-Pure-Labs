-- Exact inverse of 20261108100000, generated from the captured
-- production ACL snapshot recorded in docs/security-acl-snapshot-20261108.md.
-- Snapshot: every listed privilege was granted by postgres, with no grant
-- option, to both anon and authenticated on each of the four tables.
BEGIN;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
ON TABLE
  public.order_status_notifications,
  public.suppliers,
  public.supplier_batches,
  public.supplier_batch_items
TO anon, authenticated;

COMMIT;
