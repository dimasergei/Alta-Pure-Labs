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

### Existing application: required documents

The existing TagadaPay application has advanced through Business, Representative, Processing and Bank to **Documents (step 5 of 6)**. It remains a draft, not a submitted or approved merchant account. The saved CRM/store setup is separate from this application.

The owner entered the EIN and incorporation date. Removed invisible copy/paste formatting from the EIN without changing its digits; the form accepted it. The owner completed the representative details. These inputs should not be requested again, and progression through the form is not proof that identity verification has passed.

Saved the previously disclosed startup forecast: USD 2,000 expected monthly card volume and USD 100 average captured order, with no verified live processing history. Historical chargeback/refund rates were not invented. The form's specific research-peptide category maps to MCC 5122 and is labelled wholesale; Robert was asked to confirm classification for the disclosed online retail catalog.

The owner entered XYZ Holdings LLC as the bank account holder. Completed the remaining bank fields using the previously supplied Relay details, and the application advanced. A bank-issued statement must still verify that the exact payout account is held by the applicant; the earlier receiving instructions named Northline Research. Draft form acceptance does not establish ownership or successful settlement.

The portal requires these uploads before submission:

- Proof of the owner's residence: a utility bill, bank statement or official letter showing the actual home address, because the owner resides outside the company's country.
- Business registration: the LLC's Articles of Organization or equivalent.
- Payout bank proof: a statement, official bank letter or online-banking screenshot for the exact account entered.

Proof of company address, signing authority and processing history are also offered; the latter two are explicitly optional. No document uploads or application submission were completed. The owner's existing Articles of Organization and EIN letter were located and read; no matching payout statement or residential proof was found in the searched connected records. The EIN letter is not a substitute for every required document.

A focused clarification was sent to Robert in the existing thread: whether this acquiring application is necessary for his proposed pooled-USDC card-to-crypto route or is a separate conventional merchant-account application, and which merchant classification applies. Check for his response before duplicate outreach. No fees, contracts or credit-check consent were accepted.

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

No additional wallet or API-key input is needed from the owner at this checkpoint. The three required document uploads are now the immediate application blocker; later identity/signature and provider approval steps remain unverified. Provider activation, the unresolved integration contract and the remaining payment tests must not be presented as completed or merely a missing storefront button.

## References

- [Native NMI/PayerURL activation](native-gateway-activation.md)
- [PeptidePay activation](peptidepay-activation.md)
- [Storefront release and promotion semantics](reference-storefront-release.md)
- https://docs.tagada.io/developer-tools/api-hosts
- https://docs.tagada.io/api-reference/auth/test-authentication
- https://docs.tagada.io/api-reference/checkout/initialize-checkout-session
- https://help.tagada.io/en/articles/54-enable-tagada-crypto

Keep credentials, full payout/receiving information, buyer data and token-bearing preview URLs out of this document.
