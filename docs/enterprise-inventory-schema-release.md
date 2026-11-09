# Enterprise inventory and quality database — release gate

This branch introduces a **disposable PostgreSQL test fixture**, not an automatically applied production migration. The SQL is in `tests/fixtures/enterprise-inventory-schema.sql` and its security/constraint tests are in `tests/fixtures/enterprise-inventory-schema-checks.sql`. GitHub CI executes the fixture on a disposable PostgreSQL 17 service.

## Proposed tables

- `public.enterprise_inventory_lots`: supplier UUID foreign key, exact SKU, lot and site, quarantine-by-default quality status, nonnegative stock/reserved/damaged counts, unique supplier+SKU+lot+site, release evidence and reviewer.
- `public.enterprise_quality_documents`: lot-bound report metadata and private storage object key. Publication requires verified status and recorded review. No public URL or fake COA generated.
- `public.enterprise_inventory_events`: append-only inventory event log with unique idempotency keys, actor reference and positive quantities. `service_role` has SELECT/INSERT but no UPDATE/DELETE.

Every table has RLS enabled and all direct privileges revoked from `anon` and `authenticated`. Only `service_role` is granted necessary server-side access. **These privileges are not sufficient by themselves for safe inventory allocation:** a separate transactional reservation implementation with concurrency tests is still required.

## Before production application

1. Review production schema grants, existing suppliers UUIDs and Supabase migration history.
2. Generate the production migration using a supported Supabase CLI version and reconcile it with the repository's manual production migration workflow. Do not add an arbitrary timestamp migration file or apply the same schema twice.
3. Verify the SQL on a disposable PostgreSQL database with the CI security and constraint suite, then run production preflight backup and apply one versioned migration.
4. Read back RLS/grants/constraints and verify service-role access; no browser access to supplier costs or inventory changes.
5. Build admin-only import, quality-review and inventory event APIs, then test atomic reservations with concurrent requests. Do not let an inventory row authorize a sale or shipment.
6. COA publication additionally requires authentic supplier documents, lab verification and a documented approval workflow.

**No production SQL is run by this PR.** No supplier record, inventory lot, order, payment, or customer data is created in production.
