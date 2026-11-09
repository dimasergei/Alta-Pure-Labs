# Reservation cancellation: transaction-safe foundation

This candidate SQL function cancels an **entire existing reservation event**. It does not cancel a paid order, refund a payment, restock shipped units or authorize a shipment.

The backend service role supplies the original reservation-event UUID, a unique idempotency key and an actor reference. The function locks the associated lot row, rejects a second cancellation of the same reservation, decrements the reserved count and inserts an immutable release event within one transaction. If insertion fails, the decrement rolls back. A partial unique index on release-event references reinforces the once-only invariant.

## Activation limits

- **No automatic cancellation:** a separate authenticated service must verify the order, supplier allocation, payment status and whether the reserved units have already shipped.
- **No partial cancellations:** a future implementation must track remaining quantities per reservation and handle partial shipment before partial release can be safe.
- **No release of recalled lots for sale:** releasing a reservation reduces the reserved count but never changes quality status, product eligibility or checkout availability.
- **No anonymous execution:** browser roles cannot execute this function.
- **No production invocation during rollout:** disposable PostgreSQL tests use fixture reservations only.
- Verify all migration history, production privileges and idempotency behavior before connecting the function to real orders.

Checkout stays paused. Supplier inventory and quality evidence remain unavailable until authentic records are provided.
