# Shipment tracking — verified event integration plan

This module implements a deterministic state machine for shipment events. It does not connect to a carrier, create a label, book shipping, access customer orders or send notifications.

## Workflow

1. A qualified fulfillment provider acknowledges an approved order and a shipment record is created server-side.
2. Carrier/fulfillment webhooks are authenticated, signatures and source IDs validated, and raw events stored with idempotency keys.
3. A durable queue normalizes events into accepted, label created, in transit, out for delivery, delivered, exception, returned or cancelled.
4. The state machine rejects duplicate, forged, out-of-order and invalid transitions.
5. A customer can see only shipments associated with their authenticated order; never expose tracking by predictable order number alone.
6. Notifications use an outbox with retries, consent rules and delivery audit.

## Unfinished

- Carrier integration and signed event validation.
- Supplier fulfillment acknowledgements, shipping labels and route-specific authorization.
- Authenticated customer tracking API and account UI.
- Database transactions, event replay, out-of-order reconciliation and retention policies.
- Real shipping rates and international carrier contracts.

The pure JavaScript `verified:true` flag is only an input contract. It is **not proof of a valid carrier signature** and must never be set from browser input. All shipping routes remain denied unless separately approved. No shipment or customer message was created.
