# Lotus fulfillment — Manage Order integration contract

Status: implementation specification; **not enabled**. This file does not change runtime behavior.

## Invariants
- Existing storefront HTML, checkout, payment flow, catalog and customer experience remain unchanged.
- Existing admin order table, columns, rows, filters, buttons, and page layout remain unchanged.
- All new supplier information/actions are confined to the existing **Manage Order** detail interface.
- Every order remains visible in the existing orders dashboard regardless of supplier eligibility.
- Never submit an unpaid, cancelled, refunded, or archived order.
- Never split a mixed order; if any item is unmapped, unavailable or unsupported, route the entire order to manual fulfillment.
- Do not create supplier orders as a consequence of opening Manage Order or rendering a page.
- Do not send supplier payments or purchase shipping labels automatically.
- Do not change the existing supplier-batch system, notifications or unrelated order fields.

## Eligibility
For a confirmed paid order, all must hold:
1. Destination is supported by Lotus's API: US state, DC, AA/AE/AP, PR or VI with valid ZIP; no Canada or other international destinations.
2. Every item variant is explicitly mapped to a Lotus product ID and supported pack size.
3. All requested quantities are available according to a fresh Lotus quote; a stock hint alone is insufficient.
4. No existing Lotus supplier order/reference exists; no manual-fulfillment override is set.
5. The feature flag is enabled, and the configured key is the appropriate environment mode.

Any failed check produces a per-order manual-fulfillment reason, not a rejected customer order.

## Order state and idempotency
- Record the local order first. Confirm payment before supplier submission.
- Use a durable fulfillment record keyed by local order ID and supplier, with a unique supplier reference.
- Lock/claim the fulfillment job atomically before calling Lotus.
- Use the *same* reference for retries and reconcile with GET /orders?reference=... after ambiguous timeouts.
- Quote before POST /orders, pass expected_owed, and handle 409 price_changed, reference_conflict, stock shortage and other failures explicitly.
- No duplicate order on webhook retry, worker retry, dashboard refresh or administrator click.
- Supplier API credentials are server-side only and never exposed to the dashboard.

## Manage Order (existing modal only)
- Existing order and item details remain intact.
- Display eligibility and reason, supplier SKU mapping, stock/quote status, supplier order number, settlement, label, tracking, last sync, and last error.
- For manual orders allow recording selected supplier, notes, tracking carrier/number, and fulfillment progress using existing order update semantics.
- Any explicit submission/retry/cancellation action requires a deliberate admin click and a server-side recheck.
- If auto-submission is enabled for paid eligible orders, its queue job is server-side and not dependent on an admin opening the order.

## Lotus-specific limitations
- Current documented API supports US addresses only.
- Paying Lotus is performed in the Lotus partner portal.
- Shipping labels are purchased/attached separately; tracking can be polled from Lotus.
- Supplier portal shop setup steps are not prerequisites for AltaPure's separate storefront API integration.

## Verification before deployment
- Unit tests: all eligibility branches; mixed orders; unsupported countries; stock/quote failure; unmapped variants.
- Integration tests with mocked Lotus API: paid/unpaid, idempotent retry, timeout reconciliation, price conflict, 401/403, 422, 429, 5xx, cancellation, tracking sync.
- UI regression: existing order table and storefront remain byte-for-byte unchanged; new controls only in Manage Order.
- Production deployment requires explicit review of code diff, tests, mapping, migration and rollout flags. No real orders or payments in tests.
