# Inventory, COA and supplier integration — production design

The first inventory ledger is a **pure tested model**, not a live stock database, and it cannot authorize a sale. Its lot states are quarantine, released, hold, recalled and depleted. It supports nonnegative counts, reservations, returns of reserved stock and stock reconciliation, with all unknown or duplicate lot inputs rejected.

## Production database plan

Design a private `commerce_ops` schema for supplier offers, supplier SKU crosswalks, lot records, inventory adjustments, lot reservations, quality evidence, fulfillment locations, shipping services and shipment events. Keep internal wholesale prices and supplier contacts outside public tables and static assets. Add a public read-only **verified COA publication** projection only after authentic lot documents are reviewed.

- `supplier_profiles`: internal supplier identity, contract status and operational terms.
- `supplier_sku_crosswalks`: exact formulation, strength and vendor SKU with evidence.
- `inventory_lots`: SKU, supplier, manufacturer lot, warehouse, quality status, expiry, provenance.
- `inventory_events`: append-only receipt, damage, adjustment, reservation, release, shipment and recall records with idempotency keys.
- `quality_evidence`: immutable document metadata, lab identity, lot, test scope and independent verification reference.
- `coa_publications`: approved public documents with reviewer, publication and withdrawal audit.
- `fulfillment_orders`, `shipment_events`: external supplier acknowledgements and carrier events, not customer payment events.

## Security and consistency

- No `anon` or `authenticated` direct privileges on internal supplier/inventory tables. Keep service-only access on a non-exposed schema; enable RLS as defense in depth.
- Do not use user-controlled metadata for staff authorization. Server endpoints must authenticate and authorize admin roles independently.
- Inventory reservation must use one database transaction with row-level locking or a conditional atomic update, plus unique idempotency keys. The pure JavaScript model is **not concurrency-safe** and must never be used as the authoritative allocator.
- Require verified lot-specific evidence before quality release; do not trust a string field named `evidence_reference` as proof. Quarantine all imports by default.
- Every shipment requires a separately reviewed SKU, destination, origin and carrier lane; product availability is not permission to sell or ship.
- Keep historic Stripe webhook/event handling intact while checkout remains paused.
- Add migrations in a separate PR and test against a disposable database. No production schema modification in this branch.

## External dependencies

The suppliers must provide current SKU mapping, actual inventory/lot identifiers, COAs, manufacturing origin and warehouse/carrier terms. Do not assume a supplier API exists. Start with a verified manual import format and advance to API/CSV automation only if supported and authorized.

## References

- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/database/postgres/roles
