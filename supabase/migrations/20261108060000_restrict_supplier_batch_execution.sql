-- Restrict the SECURITY DEFINER supplier-batch RPC to its verified
-- server-side backend caller. The function owner (postgres) retains
-- inherent owner privileges; its redundant explicit ACL entry is removed.
REVOKE EXECUTE
ON FUNCTION public.create_supplier_batch(uuid, text, uuid[])
FROM PUBLIC, anon, authenticated, postgres;

GRANT EXECUTE
ON FUNCTION public.create_supplier_batch(uuid, text, uuid[])
TO service_role;

-- Every application relation in the function body is already schema-qualified.
-- Keep only trusted built-ins and the temporary schema on the function path.
ALTER FUNCTION public.create_supplier_batch(uuid, text, uuid[])
SET search_path = pg_catalog, pg_temp;
