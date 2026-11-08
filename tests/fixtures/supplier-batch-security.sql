-- Isolated fixture for the supplier-batch permission integration test.
-- This runs against a dedicated disposable PostgreSQL service in CI.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'schema_inspector') THEN
    CREATE ROLE schema_inspector NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, schema_inspector;

CREATE TABLE public.suppliers (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true
);
CREATE TABLE public.store_orders (
  id uuid PRIMARY KEY,
  order_number text NOT NULL,
  fulfillment_status text NOT NULL,
  payment_status text NOT NULL,
  archived boolean NOT NULL DEFAULT false
);
CREATE TABLE public.store_order_items (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES public.store_orders(id),
  product_id uuid,
  product_name text NOT NULL,
  variant_size text,
  quantity integer NOT NULL,
  supplier_sku text,
  supplier_name text,
  lot_number text,
  fulfillment_notes text
);
CREATE TABLE public.supplier_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id),
  name text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.supplier_batch_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.supplier_batches(id),
  order_id uuid NOT NULL REFERENCES public.store_orders(id),
  order_item_id uuid NOT NULL REFERENCES public.store_order_items(id),
  product_name text NOT NULL,
  variant_size text,
  quantity integer NOT NULL,
  supplier_sku text,
  supplier_name text,
  lot_number text,
  fulfillment_notes text
);
