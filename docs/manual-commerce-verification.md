# Manual commerce release verification

The owner authorized an expedited payment setup and manual supplier fulfillment, delegating commercial-program decisions. This release implements an owner-operated invoice workflow and nonrenewing annual memberships, not an instant card-processor approval.

## Executed checks
164 Node tests passed, including the complete earlier regression suite. The exact committed backend, customer/admin scripts, migration and test fixtures were compared byte-for-byte with tested sandbox files. The complete public build succeeded.

Real disposable PostgreSQL17 tests passed through request, final issue, customer acceptance, exact payment receipt, paid membership grant, replay, full refund and revocation, then goods payment, manual processing, shipment/tracking and delivery. Negative checks covered other-customer acceptance, mismatched amount/currency, duplicate external transaction references, stale edits, unpaid shipment, missing tracking, disabled receiving method and unauthorized direct writes.

Eight isolated browser test groups passed with zero JavaScript errors: published pricing/terms, signed-in invoice request, explicit receiving-method setup, total preview/issue, customer acceptance/instructions, recorded receipt and pass activation, cart entry/legal terms/mobile layout, and no-JavaScript-errors assertion. Browser auth/payment responses used isolated fixtures. No actual bank transfer, customer payment, production test invoice or fake receiving destination was created.

## Production migration
The tested additive SQL was applied to the confirmed AltaPure project. Supabase assigned remote version `20261110040926_manual_invoice_commerce`; the repository filename matches that version, with unchanged SQL blob `66134948867a9874759208af9747b5b38aa5c4f0`.

Read-only verification found five new RLS-enabled commerce tables, no direct browser reads, service_role reads but no direct INSERT/UPDATE/DELETE, and three service-only RPCs with fixed search_path. Receiving methods, invoices, receipts and memberships were all empty after migration. Historical order count remained19. No original order, supplier, inventory or Stripe-webhook behavior was migrated.

## Mandatory distinctions
Owner bank/Interac instructions or an approved provider invoice account still must be configured. No native card gateway, provider webhook, Zelle/Venmo/CashApp account, native BTC wallet, auto-renewal or rewards payout has been activated. Hosted invoice links work with an actual approved external provider and are reconciled manually. Invoice links are shared manually, and funds are confirmed in the actual bank/provider before staff records receipt.

Retain all financial records on a code rollback; do not drop the additive tables. The prior production release remains the rollback candidate. Final CI and production-deployment verification are recorded on the pull request.
