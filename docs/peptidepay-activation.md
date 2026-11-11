# PeptidePay activation — 11 November 2026

This adapter extends the existing reviewed-invoice system. It does not activate a merchant account or replace NMI, bank transfer, PayerURL or historical Stripe handling.

## Observed account blocker

The owner's dashboard says **Account pending activation** until its rate is confirmed. The webhook URL was blank when inspected. The provider's official documentation describes card-to-crypto payments to a merchant wallet, no on-chain sandbox, and a signed webhook simulator. These are not ordinary USD merchant card settlements. The support inquiry remains open; no fees or agreement were accepted.

## Implemented flow

- Only an authenticated owner of an accepted, unexpired invoice can start checkout. Amount/currency come from that invoice and require display confirmation plus the crypto-conversion disclosure.
- A durable attempt is claimed before the provider request. Its UUID is the provider idempotency key and order reference. A duplicate customer click returns the existing attempt.
- The returned session ID, settlement address and exact allowlisted HTTPS URL are bound atomically before redirect. A session cannot be reused on another invoice or rebound to an existing attempt.
- Callback: `https://altapurelabs.com/api/checkout?native=peptidepay-webhook`.
- HMAC-SHA256 authenticates the exact raw bytes and timestamp with a five-minute tolerance. Malformed/stale signatures fail. Signed test/unknown callbacks acknowledge receipt without marking an invoice paid.
- Known callbacks must match the stored session/order/address and the exact original amount/currency. A separate authenticated session lookup must confirm paid state, transaction hash and timestamp. Browser returns cannot mark paid.
- Confirmed payments reuse the existing idempotent receipt/notification outbox. Supplier fulfillment stays manual. Admin reconciliation queries the original session without creating another one. Missing/uncertain sessions stay blocked for provider reconciliation.
- PeptidePay has no refund API. Coordinate the refund destination, asset and network with the customer/provider, have the owner perform it, verify completion, then record it through the payment desk. Never automatically send a refund to a shared on-ramp source address.

## Private environment configuration

Existing `PEPTIDEPAY_API_KEY` and `PEPTIDEPAY_WEBHOOK_SECRET` stay server-side. The callback can verify a no-funds simulator delivery with the secret alone. It cannot turn an unmatched simulator event into a real order.

Before any live route can be used, configure:

- `PEPTIDEPAY_API_KEY`: the actual `sk_live_` key; test keys are rejected for collection.
- `PEPTIDEPAY_WEBHOOK_SECRET`: the account's signing secret.
- `PEPTIDEPAY_WALLET_ADDRESS`: the exact owner-controlled receiving address, verified in the account.
- `PEPTIDEPAY_CURRENCIES`: approved invoice currencies, currently USD and/or CAD.
- `PEPTIDEPAY_MODE=live`.
- `PEPTIDEPAY_VERIFIED=true` only after provider account activation, accepted commercial terms, exact merchant/catalog eligibility, upstream merchant-payment authorization, test/live isolation and real settlement/refund testing are verified.
- `PEPTIDEPAY_ENABLED=true` only for explicit live activation after those checks.

Then create the approved goods-only route in `/admin-gateways.html` with actual payee, country scope and evidence reference. No route is seeded by the migration. Wallet flags for NMI do not grant PeptidePay wallet eligibility; its own provider/device determines availability. Do not advertise Apple/Google Pay until the actual path succeeds.

## Remaining provider checks

Confirm the rate and activation requirement; explain discrepancies between generic docs and the account; confirm the supported merchant-wallet payment use; confirm simulator payloads and inability to change live session settlement. Run the signed no-funds callback test before a user-completed live test. Test successful payment, abandoned/expired checkout, retries, reconciliation and the provider's customer refund procedure. No tiny real payment is automatically initiated by this implementation.

Sources: https://www.peptide-pay.com/docs ; https://www.peptide-pay.com/terms ; authenticated owner account settings.
