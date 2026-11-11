# Payment activation: current checkpoint

Reviewed 11 November 2026. This replaces the earlier manual-invoice-only intake. Recheck provider and production state before a later activation.

## Deployed and verified

- Production application commit: `31f0444d840ca64e5a64a48b5df3a04ef492a519`, deployment `dpl_1D6dfAaHZQVG8gGePZJuxGgiYVt1`, at https://altapurelabs.com.
- Direct customer checkout calculates catalog prices, BOGO, coupons, membership/volume discounts, points and store credit on the server. Account pages and historical orders are retained. Fulfillment remains manual.
- Checkout version is `checkout-2026-11-v2`. Standard US delivery is USD 25 per order. Bank transfer adds 5% off eligible merchandise after other discounts. See `config/checkout.json`, `lib/checkout-promotions.js` and `docs/reference-storefront-release.md` for exact behavior.
- The public checkout configuration returns only US domestic wire in USD. Interac details are retained but its CAD route is inactive in the USD checkout. Receiving details remain private.
- The promotion-version migration `20261111071846_checkout_promotion_version` is already applied. Do not reapply an older filename. No new migration was required for the read-only provider diagnostic.
- PR #76 passed all six CI workflows; 267 unit tests passed locally. The private diagnostic script is excluded from public output. Production home and checkout configuration returned HTTP 200; the private script URL returned 404.

## Merchant identity and completed setup

The operating merchant is XYZ Holdings LLC, the owner's New Mexico LLC. The Ontario corporation owns it; the owner resides in Canada. Do not revert to an assumed Canadian operating entity or the superseded Northline name.

PeptideApprove/Tagada store: `store_aaf82802c630`. The owner authorized the existing Polygon USDC payout wallet ending `745a50` and creation of the CRM API key. Both are saved. The sensitive key is stored only in Vercel Production; never put it in source, frontend code, screenshots or logs. `TAGADA_STORE_ID` is configured and `TAGADA_ENABLED` remains false.

From Vercel, authentication, store, processors and payment-setup reads returned HTTP 200. The earlier 403 occurred in a separate testing environment; it is not evidence that the account or key is invalid. Run `node scripts/check-tagada-readiness.cjs` manually in the authorized hosting environment for redacted, read-only checks. It does not enable payments or create sessions.

## Current provider status

| Route | Verified state | Still required |
| --- | --- | --- |
| PeptideApprove card-to-crypto | Wallet saved, MoonPay selected, pooled settlement shown, integration disabled | Supported exact-total checkout, confirmed on-ramp eligibility, callback/reconciliation integration, payment/refund tests |
| PeptideApprove conventional cards | No active card processor; sandbox and blank-key NMI configurations disabled | Approved live processor configuration and testing |
| Native Apple Pay | Integration and checkout-domain registration configured | Working wallet sheet and successful payment through an approved processor |
| Native Google Pay | Provider configuration sandboxed | Working test sheet, production configuration/approval and payment test |
| PeptidePay, a separate provider | Native adapter and signed webhook simulator tested; activation pending | Provider rate/activation confirmation and real provider session/payment tests |
| Native NMI | Isolated sandbox sale, decline, query and full refund passed | Live credentials, callback/wallet testing and authorized live acceptance test |
| PayerURL | Adapter retained; reported account login error unresolved | Working account, actual credentials and invoice/callback tests |

Robert's existing thread proposes card-to-crypto at 8.5% with first-payment buyer ID verification. This does not establish a completed charge, wallet payment or settlement. Activation questions, the production API-auth correction and exact-total requirements were already sent in the same thread. Check for a reply before duplicate outreach or another application.

### Application status discovered in the activation email

The PeptideApprove reminder links to the existing TagadaPay merchant application. Its application list showed exactly one **draft**, at **step 1 of 6 (Business)**; it was not submitted or under review. Do not describe this as merely awaiting approval. The saved CRM/store setup is separate from this merchant application.

Resumed that existing draft and filled the verified LLC name, United States / New Mexico registration, registered-agent address, published support contact details, website, disclosed research catalog, foreign corporate ownership and conservative USD 2,000 first-month projection. The form confirms progress is saved automatically. No duplicate application, contract acceptance or submission was performed.

The form's required Registration number field expects the LLC's EIN. It remains blank because no verified EIN value was supplied or found in the connected correspondence. Continue was attempted and correctly stopped with a required-field error. The optional tax classification and incorporation date were also left blank rather than guessed. The owner should enter the EIN directly in the saved application; later steps and any identity/document/signature requirements remain unverified until this step can advance. Confirm with Robert whether this acquiring application is needed for his proposed card-to-crypto route.

The separate PeptidePay dashboard was also rechecked and still explicitly says **Account pending activation**, with zero payments. Re-ran its dashboard's no-funds test webhook: HTTP 200, HMAC signature verified, test event ignored, and `live_payment_applied: false`. This confirms endpoint delivery and signature handling, not a successful card payment. Its provider activation must be resolved independently; completing the TagadaPay form does not activate PeptidePay.

## Preview findings and completed fix

The existing pre-launch funnel `funnelv2_1b3e4623eb85` was opened through the portal's Preview workflow, with `draft=true` and staging in its URL. No real card, buyer contact details, purchase submission or live charge was entered. The provider created a preview session; this is not a real paid order or revenue.

Two 10 mL BAC Water items initially showed USD 36 plus stale USD 15 shipping, total USD 51. The storefront's calculation without coupon, membership, points or credit is USD 36 minus USD 18 BOGO plus USD 25 shipping, total USD 43.

Updated existing provider shipping rate `sr_b10e43deb849` to **Standard US delivery, USD 25**, with the storefront's existing manual-fulfillment estimate and US-only scope. Reopened the saved rate and reloaded the preview to verify persistence. The preview now shows USD 25 shipping but totals USD 61 because BOGO is absent. No new shipping service, supplier commitment or fulfillment guarantee was introduced.

Google Pay rendered, but clicking and keyboard activation did not produce an observable payment sheet. The test did not pass. No charge/refund was attempted.

There are no saved provider promotions. Its BOGO editor selects a purchased product and a reward product; do not assume this reproduces a discount on units already in the cart. An exploratory unsaved promotion was discarded. Do not globally halve prices or add duplicate free units to make one test total match.

## Remaining implementation and acceptance sequence

1. Obtain the supported card-to-crypto server-side session/redirect contract: exact payable total after discounts and credit, stable external order reference, currency, return URLs and no-funds test procedure. The public catalog-based session API alone does not establish this contract.
2. Implement the Tagada adapter and durable attempt binding against that contract. NMI and PeptidePay are different protocols; their callbacks and secrets cannot be reused. No Tagada payment-fulfillment webhook is registered yet.
3. Implement/test authenticated status retrieval, signed raw-body callbacks, exact order/amount/currency checks, replay handling, timeouts, cancellation and refunds. Credits, points, membership activation, confirmation email and fulfillment eligibility must follow a verified payment exactly once.
4. Compare the provider amount with the saved server quote for ordinary carts, odd/even BOGO quantities, coupon BOGO, membership savings, points, credit covering merchandise and shipping, and fully balance-funded orders. The demonstrated mismatch blocks substituting a direct provider link for the working checkout.
5. Validate cards and each wallet independently in the supported test environment. Rendering a button is insufficient. The card-to-crypto provider's wallets are distinct from native wallets connected to the disabled card flow.
6. After successful tests and actual live configuration, publish the tested route, register its approved account binding and enable the customer method. The owner completes any required low-value live payment or identity verification; verify refund and settlement separately. Preserve bank transfer, historical orders/Stripe handling and manual fulfillment.

No additional wallet or API-key input is needed from the owner at this checkpoint. The EIN is needed to advance the existing TagadaPay application. Provider activation, the unresolved integration contract and the remaining payment tests must not be presented as completed or merely a missing storefront button.

## References

- [Native NMI/PayerURL activation](native-gateway-activation.md)
- [PeptidePay activation](peptidepay-activation.md)
- [Storefront release and promotion semantics](reference-storefront-release.md)
- https://docs.tagada.io/developer-tools/api-hosts
- https://docs.tagada.io/api-reference/auth/test-authentication
- https://docs.tagada.io/api-reference/checkout/initialize-checkout-session
- https://help.tagada.io/en/articles/54-enable-tagada-crypto

Keep credentials, full payout/receiving information, buyer data and token-bearing preview URLs out of this document.
