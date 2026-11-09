# Enterprise schema integration map — read-only production inspection

Inspection date: 2026-11-09. Source: read-only `information_schema` queries on connected AltaPure Labs Supabase project. **No SQL changes were executed.** This is a migration design artifact, not an implementation.

## Existing production tables and fields relevant to enterprise expansion

- `public.store_orders`: UUID order ID, order number, customer email, payment/fulfillment statuses, USD-cent financial totals, shipping country/address, carrier and tracking number, paid/shipped timestamps, archived/priority and internal status history, legacy Stripe session/payment-intent references.
- `public.store_order_items`: UUID line ID/order ID, product ID, name, variant size, quantity, unit price, supplier SKU/name, lot number and fulfillment notes.
- `public.suppliers`: UUID, supplier name/contact/email/notes, active status and timestamps.
- `public.supplier_batches`: UUID, supplier ID, name, status, timestamps and archive timestamp.
- `public.supplier_batch_items`: UUID, batch ID, order/line ID, product/variant/quantity, supplier SKU/name, lot number, fulfillment notes and timestamp.
- `public.store_payment_events`, `public.order_status_notifications`, `public.supplier_batch_audit`, `public.store_checkout_rate_limits` exist; column detail not included in this read.

## Non-destructive extension strategy

**Preserve all existing order, payment, supplier and notification tables** and foreign-key identities. Do not migrate or delete historic Stripe data. Use separate, versioned enterprise tables and join to existing UUIDs.

Proposed internal tables (names subject to disposable-DB verification):
1. `enterprise_supplier_skus` (supplier UUID FK, exact catalog SKU key, supplier SKU, strength/composition confirmation, provenance).
2. `enterprise_inventory_lots` (supplier UUID, SKU, lot, fulfillment site, quality status, counts, COA verification reference).
3. `enterprise_inventory_events` (immutable lot receipt, reservation, release, damage, shipment, recall; unique source idempotency key).
4. `enterprise_quality_documents` (lot FK, lab/report metadata, restricted file pointer, reviewer, approval/withdrawal).
5. `enterprise_public_coas` (approved published document metadata, lot linkage, independent verification URL).
6. `enterprise_shipment_events` (order UUID FK, external carrier event ID, normalized status, signature verification and occurred-at).
7. `enterprise_promotion_rules` and `enterprise_redemptions` (reviewed price policies, per-customer constraints and usage).
8. `enterprise_membership_entitlements`, `enterprise_subscription_cycles`, `enterprise_rewards_events` (account identity, ledger, lifecycle).
9. `enterprise_shipping_lane_approvals`, `enterprise_provider_approvals` (SKU/country/carrier/provider scope, evidence, expiry).

## Security requirements

- Prefer an unexposed internal schema; grant only narrowly scoped backend privileges. Never grant `anon` or `authenticated` direct access to supplier wholesale prices, quality evidence, payments or inventory adjustments.
- Enable RLS even on private tables as defense in depth. Avoid `SECURITY DEFINER` functions in `public`; any necessary privileged function must be separately audited, use an explicit search path and have restricted execution.
- All event writes use idempotency keys and atomic database transactions. A JavaScript simulation is not an inventory reservation.
- Public COA publishing must require verified lot evidence, document review and withdrawal handling. Never allow a browser to mark a report verified.
- Existing customer order access remains governed by the current authenticated server API; do not expose raw order/tracking lookups to anonymous users.
- Do not turn on new shipping destinations or payment rails from table entries alone; approval evidence must be independently verified.

## Migration implementation order

1. Create a disposable PostgreSQL 17 fixture matching the existing tables and relevant grants/policies.
2. Generate migrations with the installed Supabase CLI `migration new` command and test clean up/down behavior on the fixture. Review current Supabase changelog and documentation.
3. Test grants/RLS as `anon`, `authenticated`, `service_role` and `postgres`; verify browser roles cannot read supplier costs or write lot status.
4. Test concurrency: two simultaneous reservations of the last available unit must yield exactly one success. Test duplicate webhook and carrier event replay.
5. Only then apply production migrations in independently reversible stages with preflight backup and post-apply read-back checks.
6. Connect admin UI and public COA read model only after permission tests pass; keep checkout paused.

**Status:** No enterprise tables created, no customer/order data changed, and no new permissions granted.
