# Rampex order integration — staged, collection disabled

## Scope and state

Built on production commit 768b7b7ec566d2ceef6d14404aa731640ce0bdc0. The owner configured a MetaMask receiving address and saved the two Production Secrets. The preceding production connection check authenticated the API key successfully. This change does not establish catalog approval, a working card purchase, the exact fees, or receipt in the owner's wallet.

No production migration, payment link, payment, customer fixture, supplier job or notification was created while preparing this change. Automatic deployments remain disabled. This package requires a separately approved, narrowly scoped database migration before activation.

## Implementation

- Original server-calculated USD goods total and the existing authenticated invoice flow are retained.
- One explicit non-Stripe provider is stored per gateway and copied to its payment attempt. No mixed-provider checkout or automatic fallback.
- A database lock and unique active-sale constraint allow only one attempt to create a provider link. Timeout/ambiguous creation is held as unknown: never blindly retry or issue another link.
- Rampex link and trusted redirect are stored before returning the URL to the customer.
- HMAC-SHA256 signatures are checked over raw bytes before any database access. Explicit test events never create entitlements.
- Completed callbacks are matched to the stored account/link and independently checked with the authenticated Rampex status API. Amount, received amount, currency, order reference when present, completed state and transaction reference must agree. This implementation expects a positive USDC payout, and callbacks must report Polygon USDC with an outbound transaction reference. It does not independently verify on-chain delivery to the owner's wallet.
- One atomic finalization records payment through the existing invoice lifecycle. Replays do not dispatch a second confirmation. Extra deposits and expiration require review and cannot generate another entitlement.
- No automatic refunds: the provider has no documented refund API. Do not refund to an on-ramp deposit/source address automatically.
- RLS and service-role-only mutation boundaries remain intact. No new browser grants.

## Deployment and migration

1. Review and approve only `supabase/migrations/20261112211215_rampex_order_payment_mapping.sql`. It is a transaction adding provider constraints, link mapping columns, an index and five backend-only functions; it seeds no payment methods or orders. Do not run the broad main-branch pending migration workflow.
2. Apply the approved migration to the correct production project, record its migration history and verify `commerce_rampex_schema_version()` returns `rampex-v1`. Do not execute the fixture files in production.
3. Deploy the reviewed application commit with collection disabled. The existing webhook URL remains `https://altapurelabs.com/api/checkout?native=rampex-webhook` and its secret stays unchanged. Readiness reports authentication and whether the schema is present; it must not be interpreted as a successful payment test.
4. Obtain and record the specific Rampex/on-ramp authorization for the exact catalog and approved customer countries, fee terms and receiving network. Choose the exact non-Stripe provider ID. A public provider-status entry is not merchant/catalog approval.
5. In AltaPure Admin Gateways, configure Rampex, USD, Products only, payee, actual approval reference, approved countries and exact provider ID. First save inactive. API credentials stay in Production Secrets, not in this form or source.
6. `RAMPEX_ENABLED=true` (Production config) and a new deployment allow activation only after the preceding checks. Activate the reviewed gateway using the authenticated admin page. Do not reuse the legacy checkout/Stripe flags.
7. A separately approved controlled payment and payout observation are still necessary to establish live end-to-end operation. No live transaction is included in this package's test results. Preserve evidence and stop on discrepancies; no automatic replay or retry.

## Verification performed in isolation

333 Node tests passed; production build passed; four existing isolated DOM suites passed. Existing native gateway, draft receiving, PeptidePay, direct checkout, conversion, readiness and unified fulfillment PostgreSQL fixtures passed. The Rampex fixture checked exact amounts/currency/account, link rebinding, replay, conflicting transaction references and restricted privileges. Eight concurrent create requests produced one claimed attempt; eight simultaneous confirmations produced one paid transition and one approval event.

Commands (local disposable database only):

```sh
npm test
npm run build
npm run test:account-dom
# After the established SQL fixtures and this migration in a disposable local rampex_test DB:
psql -X -h 127.0.0.1 -p 55432 -U postgres -d rampex_test -v ON_ERROR_STOP=1 -f tests/fixtures/rampex-checks.sql
RAMPEX_DISPOSABLE_TEST=true python3 tests/fixtures/rampex-race.py
```

## Rollback and limitations

Keep collection disabled until activation is explicitly reviewed. Before any real Rampex payment exists, the prior deployment can be restored without removing additive columns/functions. After payments exist, stop new collection but retain the Rampex callback/reconciliation code to process pending payments; do not blindly roll back to the connection-only receiver. Key rotation changes the account identity hash, so reconcile outstanding attempts before rotation and configure a new route afterward.

The status API's transaction_hash is not assumed to be the outbound transaction; actual wallet receipt and total fees remain independently unverified. Customer countries and individual provider eligibility remain provider-dependent. Unknown link-creation outcomes require operator/provider reconciliation rather than automatic retry. Existing generic card/Apple Pay/Google Pay capability flags are not claimed for this card-to-crypto route.

Official API contract: https://rampex.io/api-docs (reviewed November 12, 2026).
