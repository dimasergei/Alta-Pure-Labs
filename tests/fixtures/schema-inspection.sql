CREATE ROLE schema_inspector LOGIN PASSWORD 'fixture-only-password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT CONNECT ON DATABASE postgres TO schema_inspector;
CREATE SCHEMA app_private;
CREATE TABLE app_private.customer_records (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 email text NOT NULL DEFAULT 'fixture@example.invalid',
 status text NOT NULL DEFAULT 'new',
 CONSTRAINT customer_status_check CHECK (status IN ('new','active'))
);
CREATE INDEX customer_records_status_idx ON app_private.customer_records(status);
ALTER TABLE app_private.customer_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.customer_records FORCE ROW LEVEL SECURITY;
CREATE POLICY customer_self_policy ON app_private.customer_records FOR SELECT TO schema_inspector USING (id=0);
REVOKE ALL ON ALL TABLES IN SCHEMA app_private FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA app_private FROM schema_inspector;
GRANT USAGE ON SCHEMA app_private TO schema_inspector;
CREATE FUNCTION app_private.reviewed_definer() RETURNS text LANGUAGE sql SECURITY DEFINER
 SET search_path=pg_catalog,app_private AS $$ SELECT 'metadata-only-fixture'::text $$;
REVOKE ALL ON FUNCTION app_private.reviewed_definer() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.reviewed_definer() TO schema_inspector;
CREATE FUNCTION app_private.private_definer() RETURNS text LANGUAGE sql SECURITY DEFINER
 SET search_path=pg_catalog,app_private AS $$ SELECT 'not-executable'::text $$;
REVOKE ALL ON FUNCTION app_private.private_definer() FROM PUBLIC;
