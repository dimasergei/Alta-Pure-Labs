# Rewards and store credit — implementation boundary

`lib/rewards-ledger.js` simulates append-only point and USD-cent store-credit entries. It rejects duplicate event IDs, negative balances, invalid reversals and mixed account/currency accounting. It is **not connected to Supabase, account UI, checkout or payments** and its result always has `spendable:false`.

Before activation:
- Define legally reviewed earning, redemption, expiry and refund reversal policies; determine whether store credit is a regulated stored-value liability in each operating country.
- Design a database-backed, immutable event ledger with row locking, idempotency, reconciliation and server-only posting rights. Do not compute financial liability from client events.
- Validate authorization from Supabase authenticated identity, never from user-controlled metadata. Customers may read only their own approved balance through a controlled API.
- Reconcile chargebacks, partial refunds, disputes, cancellations and memberships; prevent duplicate earning and self-referrals.
- Approve marketing and privacy consent, and do not award credits for products/transactions that are not permitted.
- Keep checkout paused until actual acquiring-bank and product/destination approval.

No rewards or credit have been issued, no member entitlements granted, and no money movement has occurred.
