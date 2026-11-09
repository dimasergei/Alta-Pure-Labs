# Atomic inventory reservation — candidate implementation

This change adds a **disposable-database-tested** SQL function, not an active production reservation endpoint.

- `enterprise_reserve_inventory(lot_id, quantity, idempotency_key, actor_reference)` conditionally increments `reserved` on one released, reviewed lot only when sufficient unreserved, undamaged stock exists.
- A corresponding append-only inventory event is inserted in the **same PostgreSQL transaction**. An event-key conflict or other exception rolls back the reservation increment.
- The function uses `SECURITY INVOKER`; `anon` and `authenticated` are denied EXECUTE. `service_role` is the intended server-side caller.
- The SQL tests reject quarantined lots, overselling and duplicate idempotency keys, and verify browser-role execution restrictions. The CI fixture also tests the function using an isolated service role.
- No supplier stock is imported, no customer order is created, and the function cannot enable checkout, shipping or quality release.

## Production prerequisites

1. Verify concurrency with two simultaneous **database sessions** attempting to reserve the last unit. The current fixture tests conditional updates and rollback but does **not yet demonstrate a simultaneous-session race**.
2. Review permissions and existing migrations; apply only a versioned production migration after concurrency tests pass.
3. Add an authenticated backend order-allocation service that verifies actual SKU, customer type, destination, payment-provider scope, supplier eligibility and shipping route **before** any reservation.
4. Add a safe release/cancel path with idempotency and reconciliation, plus audit and exception handling.

The production inventory tables remain empty. Checkout remains paused.
