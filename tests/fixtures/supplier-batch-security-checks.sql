DO $$
DECLARE
  v_signature regprocedure :=
    'public.create_supplier_batch(uuid,text,uuid[])'::regprocedure;
  v_result jsonb;
BEGIN
  IF has_function_privilege('anon', v_signature, 'EXECUTE') THEN
    RAISE EXCEPTION 'anon unexpectedly has EXECUTE';
  END IF;
  IF has_function_privilege('authenticated', v_signature, 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated unexpectedly has EXECUTE';
  END IF;
  IF has_function_privilege('schema_inspector', v_signature, 'EXECUTE') THEN
    RAISE EXCEPTION 'schema_inspector unexpectedly has EXECUTE';
  END IF;
  IF NOT has_function_privilege('service_role', v_signature, 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role is missing EXECUTE';
  END IF;
  IF NOT has_function_privilege('postgres', v_signature, 'EXECUTE') THEN
    RAISE EXCEPTION 'function owner lost inherent EXECUTE';
  END IF;
  IF (SELECT rolcanlogin FROM pg_roles WHERE rolname = 'schema_inspector') THEN
    RAISE EXCEPTION 'schema_inspector must remain NOLOGIN';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid = v_signature
      AND p.proconfig @> ARRAY['search_path=pg_catalog, pg_temp']
  ) THEN
    RAISE EXCEPTION 'function search_path was not hardened';
  END IF;
END
$$;

INSERT INTO public.suppliers(id, name, active)
VALUES ('10000000-0000-4000-8000-000000000001', 'Fixture supplier', true);
INSERT INTO public.store_orders(
  id, order_number, fulfillment_status, payment_status, archived
) VALUES (
  '20000000-0000-4000-8000-000000000001',
  'FIXTURE-ORDER-1', 'unfulfilled', 'paid', false
);
INSERT INTO public.store_order_items(
  id, order_id, product_id, product_name, variant_size, quantity,
  supplier_sku, supplier_name, lot_number, fulfillment_notes
) VALUES (
  '30000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  'Fixture product', '10mg', 1, 'FIX-SKU', 'Fixture supplier', NULL, NULL
);

SET ROLE service_role;
SELECT public.create_supplier_batch(
  '10000000-0000-4000-8000-000000000001',
  'Fixture batch',
  ARRAY['20000000-0000-4000-8000-000000000001']::uuid[]
);
RESET ROLE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.supplier_batches
    WHERE name = 'Fixture batch' AND status = 'draft'
  ) THEN
    RAISE EXCEPTION 'service_role supplier-batch creation failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.supplier_batch_items
    WHERE product_name = 'Fixture product' AND quantity = 1
  ) THEN
    RAISE EXCEPTION 'supplier-batch item creation failed';
  END IF;
END
$$;
