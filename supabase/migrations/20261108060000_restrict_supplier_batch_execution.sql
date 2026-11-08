-- Restrict the SECURITY DEFINER supplier-batch RPC to its verified
-- server-side backend caller. Preserve the existing explicit EXECUTE grant
-- to postgres; postgres also remains the function owner.
REVOKE EXECUTE
ON FUNCTION public.create_supplier_batch(uuid, text, uuid[])
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.create_supplier_batch(uuid, text, uuid[])
TO service_role;

-- Every application relation in the function body is already schema-qualified.
-- Keep only trusted built-ins and the temporary schema on the function path.
ALTER FUNCTION public.create_supplier_batch(uuid, text, uuid[])
SET search_path = pg_catalog, pg_temp;
