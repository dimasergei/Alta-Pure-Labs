# NMI + PayerURL native gateway activation

## What changed
The accepted-invoice flow now has native collection, not just an external link field:
- NMI Payment Component 1.1.1 (pinned official CDN bundle with verified SHA-384 integrity) tokenizes cards. The server calls REST v5 sale with the saved invoice amount/currency and a durable attempt UUID as order reference.
- Optional NMI 3-D Secure and Apple/Google Pay component options are wired but off unless explicitly configured for the actual merchant account. Wallet/domain approval is not invented.
- NMI callbacks authenticate the original raw body, check merchant identity/test mode, then fetch the transaction from the authenticated v5 API. Exact order, amount and currency must match before the invoice is marked paid.
- PayerURL creates its crypto invoice server-side using the official linked Node/form protocol. Redirect hosts are constrained. Its signed callback must confirm the exact fiat amount/currency; browser returns do not change payment state.
- Native payment application reuses the transactional receipt/membership/outbox system: paid pass activates once; a verified full NMI refund revokes it. Partial/external refunds or ambiguous outcomes are review items, not silently interpreted as full refunds.
- Started/uncertain attempts block a second charge and conflicting manual status updates. No automatic sale retry is issued after transport uncertainty. Reconciliation uses the original provider record.

This is native payment collection for a final, owner-reviewed invoice. It does not replace manual supply/destination/shipping/tax review with an instant cart quote engine. Supplier fulfillment remains manual as requested.

## Private controls and customer page
- /admin-gateways.html: credential-presence diagnostics, approved route registration, recent attempts, reconciliation and explicitly authorized full NMI refund.
- /admin-payments.html: existing invoice review and issue. Select the native route; the server creates the internal /pay.html?invoice=... URL. No provider-created URL is needed for NMI/PayerURL native routes.
- /pay.html?invoice=<UUID>: authenticated customer's payment UI. Only the owner of an accepted, current invoice may pay.
- No gateway key, card token or wallet private key is stored in the public repository. Tokens are ephemeral and never sent to database functions or logs.

## NMI environment values — owner/provider supplies actual values securely
Set these in Vercel's protected project environment, not chat or GitHub:
- NMI_API_KEY: merchant REST private key.
- NMI_TOKENIZATION_KEY: public tokenization key from the same account/environment.
- NMI_WEBHOOK_KEY: signing key for the registered callback.
- NMI_MERCHANT_ID: exact merchant ID used in webhook merchant.id.
- NMI_MODE: sandbox for isolated preview testing; live only after the real account passes acceptance.
- NMI_CURRENCIES: comma-separated actual supported/approved USD and/or CAD.
- NMI_ENABLED: false until account-specific tests are complete; true is an explicit activation.
- NMI_3DS_ENABLED, NMI_APPLE_PAY_ENABLED, NMI_GOOGLE_PAY_ENABLED: false unless supported, configured and tested. Apple Pay domain verification remains a merchant/provider step.

NMI webhook: https://altapurelabs.com/api/checkout?native=nmi-webhook
Subscribe to transaction.sale success/failure/unknown, transaction.refund.success and transaction.void.success. Unmatched external events do not attach to arbitrary orders. Reconciliation must use the original transaction and the same merchant identity. Processor approval is separate from possession of an API key.

The application uses https://sandbox.nmi.com/api/v5/payments for sandbox and https://secure.nmi.com/api/v5/payments for live. Production refuses sandbox activation; database sandbox results never grant a paid live entitlement. Test against an isolated preview database with fake identities, not production customers.

## PayerURL environment values — no undocumented API mixing
- PAYERURL_PUBLIC_KEY and PAYERURL_SECRET_KEY from the owner's account, securely stored server-side.
- PAYERURL_PROTOCOL=node-form-v1 only after confirming the account uses the protocol linked from the provider's Node integration guide: api-v2.payerurl.com/api/payment, HMAC-signed form fields, request amount in minor units.
- PAYERURL_CALLBACK_UNIT=major or minor, based on the provider's confirmed meaning of confirm_rcv_amnt. It is mandatory; the integration does not guess or infer the unit from order size.
- PAYERURL_CHECKOUT_HOST: actual provider-returned HTTPS checkout hostname under payerurl.com, confirmed for the account. No arbitrary redirect host.
- PAYERURL_CURRENCIES: actual approved USD/CAD invoice currencies.
- PAYERURL_MODE=live and PAYERURL_ENABLED=true only after account/wallet/network and signed callback testing.

PayerURL notify URL: https://altapurelabs.com/api/checkout?native=payerurl-webhook
No private wallet key or recovery phrase is needed by AltaPure. The owner configures the receiving wallet/network in PayerURL. The separate API-reference site describes a different header/amount protocol; do not combine it with this adapter. No PayerURL refund API or unverified status-query endpoint is invented. Use provider-signed callback recovery and explicit support reconciliation for uncertain crypto sessions.

## Register a gateway route after configuration/testing
In /admin-gateways.html, enter the exact registered payee, customer-facing label, supported currency, approved sales scope (goods/passes/both), approved countries and review reference. The stored identity tag binds the route to its configured provider account and mode. No route is seeded or automatically enabled by deployment. Changes to actual merchant identity/currency use a new route. Existing transfer/hosted fallback methods are preserved.

The server still derives every item and discount from the saved invoice. The customer's amount/currency fields only confirm that the display is current; they never set a charge amount. Receipts are recorded only from verified adapter outcomes. A recorded card sale can be pending settlement; it is not proof the bank payout has arrived.

## Acceptance work that still needs real provider access
1. NMI merchant sandbox: successful sale, decline, 3DS result, wallet/device behavior, event replay, timeout/reconciliation and full refund. Confirm actual response/order fields match the documented schema.
2. PayerURL account: confirm protocol and amount units, exact redirect host, configured receiving wallet/network, signed complete/underpayment/cancel callbacks and duplicate notification behavior.
3. Owner-authorized low-value live payment, customer email delivery and refund/reconciliation. These are not established by mocks, CI or HTML screenshots.
4. Confirm legal/catalog/country scope and fees with the processor. No account agreement or fee is accepted by this code release.

## Provider outreach completed
Specific NMI Component/v5, wallet, sandbox, Canadian-entity and Relay-settlement questions were sent in the existing RFG, PeptideApprove and MOBOPAY threads. RFG described a potential program, but did not approve AltaPure or identify NMI. Its quote included an ambiguous $1,295 plus $1,500 line and separate review fees; clarification was requested, without authorizing charges. Those statements are not merchant approval.

## Sources inspected November 10, 2026
NMI official Payment Component, frontend guide, v5 sale/query/refund schema, webhook signatures and transaction-event examples:
https://docs.nmi.com/docs/payment-component
https://docs.nmi.com/docs/integration-guide-implement-frontend
https://docs.nmi.com/reference/create-sale-v5
https://docs.nmi.com/reference/get-payment-v5
https://docs.nmi.com/reference/refund-payment-v5
https://docs.nmi.com/reference/overview
https://docs.nmi.com/reference/transaction-events
PayerURL Node integration and its linked MIT SDK protocol:
https://payerurl.com/payerurl-api-integration-using-nodejs/
https://github.com/muhitmonsur/crypto-payment-gateway-binance-api
No competitor merchant key, account or private checkout session is used.

## Rollback
Keep gateway accounts, attempts, receipts and events. Disable native provider flags before rolling back code. Never clear an unknown attempt just to try the card again. Reconcile in the actual provider first. Existing invoice notification recovery and legacy Stripe obligations are unchanged.

## Release verification resumed November 10, 2026
- PR #58 was still open at implementation head `8f2fca6a8ae9776ac2f884d3ee0f3855eba68a27`; all six CI workflows passed. Production was still `4174c3c47d03c43256d0f2db5776b6b5362652fc`, deployment `dpl_86ngkSH8W5wGRhaZUZaEggpWGmFd` (READY).
- Production already had `20261110164316_native_gateway_checkout`. Its recorded SQL matches this migration apart from a trailing blank line; all four deployed function bodies match. The repository filename and disposable fixture now use that exact recorded version. Do not reapply the former `20261110160106` filename.
- Verified the three gateway tables have RLS, no anon/authenticated SELECT, service-role SELECT only, restricted mutation RPCs, the invoice-status guard and the single-attempt/transaction unique indexes. No native route or attempt existed. This verification created no production records.
- Tightened NMI refund matching to require the original sale transaction AND order reference. Added signed-callback regression coverage and fixed malformed multibyte PayerURL account signatures to fail with 401.
- Run the full source test suite **before** the build, as CI does. The build generates and replaces tracked frontend sources; old source-layout assertions do not describe the built storefront. Run native tests again after the full build. Do not commit generated storefront changes from a verification build.
- Local browser checks used the actual built payment/admin assets with isolated fake auth, API and component fixtures. Checked disabled/unknown payment blocking, consent, confirmed response, crypto form, private setup diagnostics and logout. These are not real gateway tests; mobile, actual wallets and 3DS still require provider acceptance testing.
- Vercel has no NMI/PayerURL credentials or activation flags. This release cannot activate either gateway without actual account configuration and an approved route.
- Existing email threads were checked without sending duplicates. RFG is awaiting written NMI/fee/Relay/sandbox answers and added a 1% payout fee to its indicative quote. MOBOPAY requested a call at 1-844-411-1011 ext 101. PeptideApprove has no reply in the thread; no PayerURL account email was found.
