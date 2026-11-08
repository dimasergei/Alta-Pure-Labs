# Read-only PostgreSQL catalog inspection

## Scope and security

The manual workflow runs only from `main`, uses the `schema-export-readonly` GitHub environment, and executes fixed SQL in `scripts/export_schema.py`. It has no workflow inputs for SQL, schema names, or filters. The exporter reads PostgreSQL catalogs only; it never queries application tables for rows and does not export authentication records, password hashes, credentials, or connection strings.

Routine and view definitions are included for review and may contain hard-coded secrets. The credential-pattern scan is precautionary and cannot guarantee detection of every secret or sensitive literal. Review the decrypted file securely before sharing.

A PostgreSQL login is not a query sandbox: it can issue arbitrary SQL within its effective privileges. PostgreSQL commonly grants function EXECUTE to PUBLIC by default. Review every callable SECURITY DEFINER function across all non-system schemas before enabling login. Inspect memberships and effective database/schema/table/column/function privileges; an unreviewed callable definer function is a stop condition.

Metadata includes schema inventory/owners/ACLs; relations and view definitions; columns/types/defaults/column ACLs; constraints; indexes; RLS flags and policies; routine definitions, owners, settings, ACLs and effective execution; triggers; types; extensions; role attributes/memberships; default ACLs; database ACLs and effective privileges; and dependency descriptions. All visible non-system schemas are included, not only public. Provider-hidden internals, role password verifiers, external provider settings and cluster secrets are not exported.

## Tests

CI provisions a fresh PostgreSQL 16 service, loads only `tests/fixtures/schema-inspection.sql`, and tests metadata, defaults, constraints, indexes, RLS/policies, and callable/non-callable SECURITY DEFINER routines. It verifies the inspection role has neither table nor column SELECT. No production credentials or data are used.

## Production setup — not performed

### 1. Provisioning (administrator only)

Run in the target database as an authorized administrator. This creates a non-login role and grants only CONNECT; it does not grant schema, table, sequence or function privileges.

```sql
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='schema_inspector') THEN
    RAISE EXCEPTION 'schema_inspector already exists; inspect it before changing it';
  END IF;
END
$$;
CREATE ROLE schema_inspector NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS NOINHERIT CONNECTION LIMIT 1;
GRANT CONNECT ON DATABASE postgres TO schema_inspector;
ALTER ROLE schema_inspector SET default_transaction_read_only = on;
ALTER ROLE schema_inspector SET statement_timeout = '60s';
ALTER ROLE schema_inspector SET lock_timeout = '5s';
ALTER ROLE schema_inspector SET search_path = pg_catalog;
```

Replace database name `postgres` only if the target database differs. No application schema USAGE or table SELECT grants are required. The read-only default is defense-in-depth, not a hard SQL sandbox.

### 2. Preflight (administrator, before login)

Role attributes and memberships:

```sql
SELECT rolname,rolcanlogin,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls
FROM pg_catalog.pg_roles WHERE rolname='schema_inspector';
SELECT granted.rolname granted_role,m.admin_option
FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles granted ON granted.oid=m.roleid
JOIN pg_catalog.pg_roles member ON member.oid=m.member WHERE member.rolname='schema_inspector';
```

Effective table and column SELECT across all non-system schemas (must return zero rows):

```sql
SELECT n.nspname,c.relname,c.relkind,
 has_table_privilege('schema_inspector',c.oid,'SELECT') table_select,a.attname column_with_select
FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
 AND has_column_privilege('schema_inspector',c.oid,a.attnum,'SELECT')
WHERE n.nspname<>'information_schema' AND n.nspname !~ '^pg_(catalog|toast|temp)(_|$)'
 AND c.relkind IN ('r','p','v','m','f')
 AND (has_table_privilege('schema_inspector',c.oid,'SELECT') OR a.attname IS NOT NULL)
ORDER BY 1,2,5;
```

Schema/database access and callable SECURITY DEFINER routines across all non-system schemas:

```sql
SELECT n.nspname,has_schema_privilege('schema_inspector',n.oid,'USAGE') can_use,
 has_schema_privilege('schema_inspector',n.oid,'CREATE') can_create
FROM pg_catalog.pg_namespace n WHERE n.nspname<>'information_schema' AND n.nspname !~ '^pg_(catalog|toast|temp)(_|$)' ORDER BY 1;
SELECT datname,has_database_privilege('schema_inspector',oid,'CONNECT') can_connect,
 has_database_privilege('schema_inspector',oid,'CREATE') can_create,
 has_database_privilege('schema_inspector',oid,'TEMP') can_temp FROM pg_catalog.pg_database ORDER BY 1;
SELECT n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) arguments,
 pg_get_userbyid(p.proowner) owner_name,p.proacl,p.proconfig,
 has_function_privilege('schema_inspector',p.oid,'EXECUTE') can_execute
FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
WHERE p.prosecdef AND n.nspname<>'information_schema' AND n.nspname !~ '^pg_(catalog|toast|temp)(_|$)' ORDER BY 1,2;
```

Review every executable definer function's definition, owner, ACL, settings/search_path and dependencies. Also review all other callable routines in the export. Resolve unexpected memberships, SELECT, schema CREATE, database CREATE/TEMP, or unreviewed function access before proceeding. This is deliberately not a public-only check; it includes visible auth/storage/extensions and project-specific schemas.

### 3. Login activation (separate action, only after preflight approval)

Generate a unique random password in a password manager and set it through the provider's secure role/password interface. Do not put it in chat, source control, SQL files, or shell history. If using a protected SQL editor, replace the placeholder privately:

```sql
ALTER ROLE schema_inspector LOGIN PASSWORD 'ENTER_NEW_RANDOM_PASSWORD_PRIVATELY';
```

Never commit or paste a real password into repository files.

### 4. GitHub secrets and manual run

In Settings → Environments → `schema-export-readonly`, configure:
- `SUPABASE_READONLY_DB_URL`: connection URL for the dedicated inspection role.
- `SCHEMA_EXPORT_PASSPHRASE`: separate random passphrase of at least 24 characters.

Keep required reviewers enabled where available. Do not use a service-role credential. After provisioning and preflight approval, manually run Actions → Manual read-only schema inspection on `main`. Only the encrypted one-day artifact is uploaded. The workflow uses GPG AES-256 and passes the passphrase through stdin/file descriptor, never as a command-line argument. Plaintext and temporary password files are removed on success and failure.

### 5. Decryption

On a trusted local machine with GnuPG:

```sh
read -s -p "Schema export passphrase: " SCHEMA_EXPORT_PASSPHRASE
echo
printf '%s' "$SCHEMA_EXPORT_PASSPHRASE" |
 gpg --batch --pinentry-mode loopback --passphrase-fd 0 \
 --decrypt --output application-catalog.json application-catalog.json.gpg
unset SCHEMA_EXPORT_PASSPHRASE
```

Inspect the decrypted JSON for sensitive literals before sharing it. Do not use online decryption services. Pattern screening is not a guarantee of safety.
