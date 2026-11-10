# Manual payment launch — owner-operated, no supplier automation

## What this release implements
Customers request a priced invoice for their cart or a prepaid membership. The owner reviews the destination, available supply, delivery/tax amounts and actual receiving method, previews the final total, issues the invoice and shares its private account link. The customer accepts the final invoice and sees its receiving instructions. The owner independently verifies the completed bank/provider transaction, records the receipt, and manually fulfills the goods. No supplier connector, automated stock import, stored-card mandate or auto-renewing subscription is needed for this workflow.

This software does **not** open a bank account, obtain merchant underwriting, create a cryptocurrency wallet, or fabricate a receiving address. All receiving methods start absent. No processor or bank account is represented as connected until the owner configures a real permitted route. Recording payment/refund is reconciliation, not movement of funds.

## Owner's immediate setup
Open `/admin-payments.html`, sign in using the existing admin password, and choose Receiving methods.

- Business bank transfer: enter the bank-issued incoming-payment instructions, exact beneficiary and USD or CAD settlement currency.
- Business Interac: enter the actual registered business receiving email/payee and CAD. The support email must not be assumed to be an Interac destination.
- Approved hosted invoice: enter the exact provider payment hostname and verified beneficiary. For each customer invoice, create the matching invoice in that provider's account, then paste its HTTPS payment link and confirm its amount/currency. This supports an already-approved card or crypto processor's hosted invoice; it is not a native gateway or webhook integration.

Use public receiving details only. Do not enter online-banking passwords, payment-card numbers, API secrets, wallet private keys or recovery phrases. These settings are private database records, excluded from public static files and GitHub. Their instructions are shown only to the authenticated invoice owner after final acceptance, and only while the invoice/method remains payable.

## Launch commercial decisions
Owner delegated commercial judgment. Implemented terms version `launch-2026-11-v1`:
- Member: free account.
- VIP: US$49 for 365 days; 5% merchandise discount.
- Elite: US$99 for 365 days; 10% merchandise discount.
- Passes start only after verified receipt, expire after365 days and never automatically renew.
- Same exact product/size: 10–24 units get5%; 25+ get10%.
- Apply the highest single eligible member/volume discount per line, never stack.
- No discount on pass fees, shipping or taxes; no promised free shipping/gifts.
- No launch points, cashback, gift-card balances, product auto-renewals or affiliate payout commitments. These are not silently promised by account tabs.
- Unused passes:14-day refund request window, statutory rights preserved. Used-pass adjustments require manual review.

The public page `/commercial-terms.html` states the exact offer, invoice process and limitations. CAD invoices lock an owner-reviewed fixed conversion rate; display FX elsewhere is not the amount to pay.

## Order handling
Manual invoices are in their own durable order queue, separate from historical Stripe orders. States: requested -> issued -> accepted -> paid -> processing -> shipped -> delivered. Unpaid invoices can be voided. Full external refunds can be recorded; they revoke any corresponding membership. Partial refunds and complex adjustments are direct support work, not represented by the full-refund button.

A verified customer account is required. Customer identity is obtained from the validated session, never a browser-supplied customer ID. Requests snapshot authoritative catalog names/sizes/prices. Staff issues a final invoice only with a verified receiving method and explicit per-order review of fulfillment, shipping and tax. Default expiry24 hours. Customers do not self-mark a payment paid. Staff verifies funds in its bank/provider before recording the exact amount, currency and unique transaction reference. Replayed receipt commands cannot double-grant a pass. Discounts are calculated by the server from active database entitlements, not editable customer metadata.

Invoices are not emailed automatically by this release. Copy the customer account link and send it through your existing support channel. No background bank polling or provider webhook is claimed. Shared admin password remains the current authentication model, with distinct server-generated audit references; it is not individual staff authentication.

## Actual processor onboarding findings
Both prior merchant inquiries were found in connected Gmail Sent; no approval reply was found during this review. The live public entry pages were inspected without creating accounts or submitting contracts:
- PeptideApprove: `https://app.peptideapprove.com/sign-up` begins with email verification. Canadian eligibility was not established by the sign-up screen. Public marketing approval timelines remain subject to complete underwriting; no same-night approval promise.
- PeptidePayCanada points to `https://boardvia.com/`; the entry form includes Canada and a custom-site option. It requires real business address, phone, website, email and expected volume. A country option does not establish acceptance of the catalog or owner.
- RFG: `https://rfgspecialty.com/peptides`; existing inquiry sent to its published contact.

Do not invent processing history, substitute a personal friends-and-family account, conceal SKUs or agree to undisclosed reserves/fees. Binding merchant onboarding, owner identity/banking documents and exact settlement details remain with the actual business/provider. No Zelle, Venmo, Cash App, direct BTC wallet or native new-card gateway was activated by this release.

## Test and release evidence
Application unit tests, real disposable PostgreSQL lifecycle tests and isolated browser checks cover request/issue/accept, stable pricing, payment amount/currency matching, duplicate receipts, membership grant/refund reversal, manual fulfillment transitions and private receiving details. Production smoke checks must be read-only unless the owner expressly provides a real receiving route and approves a live transaction. Test-bank destinations and fixture receipts must never be created in production.

Rollback keeps the additive commerce tables and any real invoices; do not drop financial history to revert a frontend release. Historical Stripe handlers and old orders remain unchanged.
