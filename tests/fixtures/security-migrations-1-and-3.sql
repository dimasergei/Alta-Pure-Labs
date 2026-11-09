-- Disposable PostgreSQL 17 integration test for migrations 1 and 3.
-- Run only against an empty throwaway database as postgres:
-- psql -X -v ON_ERROR_STOP=1 -f tests/fixtures/security-migrations-1-and-3.sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb
LANGUAGE sql STABLE AS $$ SELECT current_setting('request.jwt.claims', true)::jsonb $$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.jwt() TO authenticated, service_role;

CREATE TABLE public.order_status_notifications(id uuid PRIMARY KEY);
CREATE TABLE public.suppliers(id uuid PRIMARY KEY);
CREATE TABLE public.supplier_batches(id uuid PRIMARY KEY);
CREATE TABLE public.supplier_batch_items(id uuid PRIMARY KEY);
ALTER TABLE public.order_status_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_batch_items ENABLE ROW LEVEL SECURITY;
GRANT ALL PRIVILEGES ON TABLE
  public.order_status_notifications, public.suppliers,
  public.supplier_batches, public.supplier_batch_items
TO anon, authenticated, service_role;

CREATE TABLE public.store_orders(
  id uuid PRIMARY KEY,
  customer_email text NOT NULL,
  order_number text NOT NULL,
  internal_admin_notes text
);
CREATE TABLE public.store_order_items(
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES public.store_orders(id),
  product_name text NOT NULL,
  internal_supplier_cost integer
);
ALTER TABLE public.store_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY customer_read_own_store_orders ON public.store_orders FOR SELECT TO authenticated
USING(lower(customer_email)=lower(coalesce(auth.jwt()->>'email','')));
CREATE POLICY customer_read_own_store_order_items ON public.store_order_items FOR SELECT TO authenticated
USING(exists(select 1 from public.store_orders where store_orders.id=store_order_items.order_id and lower(store_orders.customer_email)=lower(coalesce(auth.jwt()->>'email',''))));

CREATE TEMP TABLE before_acl AS
SELECT c.relname, a.grantee, a.grantor, a.privilege_type, a.is_grantable
FROM pg_class c
JOIN pg_namespace n ON n.oid=c.relnamespace
CROSS JOIN LATERAL aclexplode(c.relacl) a
WHERE n.nspname='public'
  AND c.relname IN ('order_status_notifications','suppliers','supplier_batches','supplier_batch_items')
  AND a.grantee IN ('anon'::regrole::oid,'authenticated'::regrole::oid);

CREATE TEMP TABLE before_policies AS
SELECT p.polname, c.relname, pg_get_expr(p.polqual,p.polrelid) AS using_expression
FROM pg_policy p
JOIN pg_class c ON c.oid=p.polrelid
WHERE p.polname IN ('customer_read_own_store_orders','customer_read_own_store_order_items');

\i supabase/migrations/20261108100000_revoke_internal_table_browser_privileges.sql

DO $$
DECLARE t text; priv text;
BEGIN
  FOREACH t IN ARRAY ARRAY['order_status_notifications','suppliers','supplier_batches','supplier_batch_items'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid=format('public.%I',t)::regclass) THEN
      RAISE EXCEPTION 'RLS disabled on %', t;
    END IF;
    FOREACH priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] LOOP
      IF has_table_privilege('anon',format('public.%I',t),priv) THEN RAISE EXCEPTION 'anon retains % on %',priv,t; END IF;
      IF has_table_privilege('authenticated',format('public.%I',t),priv) THEN RAISE EXCEPTION 'authenticated retains % on %',priv,t; END IF;
    END LOOP;
    IF NOT has_table_privilege('service_role',format('public.%I',t),'SELECT,INSERT,UPDATE,DELETE') THEN
      RAISE EXCEPTION 'service_role lost required access on %',t;
    END IF;
    IF NOT has_table_privilege('postgres',format('public.%I',t),'SELECT,INSERT,UPDATE,DELETE') THEN
      RAISE EXCEPTION 'postgres lost owner access on %',t;
    END IF;
  END LOOP;
END $$;

-- Exercise actual service_role DML against each protected internal table.
SET ROLE service_role;
INSERT INTO public.order_status_notifications(id) VALUES ('00000000-0000-4000-8000-000000000001');
UPDATE public.order_status_notifications SET id='00000000-0000-4000-8000-000000000002';
DELETE FROM public.order_status_notifications;
INSERT INTO public.suppliers(id) VALUES ('00000000-0000-4000-8000-000000000003');
UPDATE public.suppliers SET id='00000000-0000-4000-8000-000000000004';
DELETE FROM public.suppliers;
INSERT INTO public.supplier_batches(id) VALUES ('00000000-0000-4000-8000-000000000005');
UPDATE public.supplier_batches SET id='00000000-0000-4000-8000-000000000006';
DELETE FROM public.supplier_batches;
INSERT INTO public.supplier_batch_items(id) VALUES ('00000000-0000-4000-8000-000000000007');
UPDATE public.supplier_batch_items SET id='00000000-0000-4000-8000-000000000008';
DELETE FROM public.supplier_batch_items;
RESET ROLE;

\i supabase/rollback/20261108100000_revoke_internal_table_browser_privileges.rollback.sql

DO $$
BEGIN
  IF EXISTS (
    (SELECT * FROM before_acl EXCEPT
     SELECT c.relname,a.grantee,a.grantor,a.privilege_type,a.is_grantable
     FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     CROSS JOIN LATERAL aclexplode(c.relacl) a
     WHERE n.nspname='public' AND c.relname IN
       ('order_status_notifications','suppliers','supplier_batches','supplier_batch_items')
       AND a.grantee IN ('anon'::regrole::oid,'authenticated'::regrole::oid))
    UNION ALL
    (SELECT c.relname,a.grantee,a.grantor,a.privilege_type,a.is_grantable
     FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     CROSS JOIN LATERAL aclexplode(c.relacl) a
     WHERE n.nspname='public' AND c.relname IN
       ('order_status_notifications','suppliers','supplier_batches','supplier_batch_items')
       AND a.grantee IN ('anon'::regrole::oid,'authenticated'::regrole::oid)
     EXCEPT SELECT * FROM before_acl)
  ) THEN RAISE EXCEPTION 'migration 1 rollback did not restore exact ACL'; END IF;
END $$;

\i supabase/migrations/20261108120000_drop_dormant_customer_order_policies.sql

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polname IN
    ('customer_read_own_store_orders','customer_read_own_store_order_items')) THEN
    RAISE EXCEPTION 'migration 3 left a customer policy behind';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.store_orders'::regclass) OR
     NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.store_order_items'::regclass) THEN
    RAISE EXCEPTION 'migration 3 disabled RLS';
  END IF;
END $$;

\i supabase/rollback/20261108120000_drop_dormant_customer_order_policies.rollback.sql

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM before_policies b
    LEFT JOIN pg_policy p ON p.polname=b.polname
    JOIN pg_class c ON c.oid=p.polrelid
    WHERE p.oid IS NULL OR c.relname<>b.relname
       OR pg_get_expr(p.polqual,p.polrelid) IS DISTINCT FROM b.using_expression
  ) THEN RAISE EXCEPTION 'migration 3 rollback did not restore exact policy predicates'; END IF;
END $$;

SELECT 'security migrations 1 and 3 integration checks passed' AS result;
