# Named payment options and prioritization

## Scope
Adds Interac, bank transfer, PayPal Business invoices, Stripe-hosted invoices, Bitcoin via BTCPay Server, NOWPayments crypto invoices, and a generic approved specialist-provider slot. These are functioning configuration and hosted-invoice handoff paths, not claims that merchant accounts have been opened or API acquiring activated. The existing native-card capability remains false until a native adapter is actually connected.

All unconfigured options are clearly marked Setup pending. Configured inactive routes show Disabled. Only active, applicable routes appear as customer preferences. A request is not payment authorization; the owner still issues and the customer accepts the exact final invoice. The final invoice snapshots the chosen provider and payment details. Reordering methods does not change historical invoices.

## Owner workflow
Open `/admin-payments.html` and Receiving methods. Each provider has a setup card. Select a provider to populate its mechanism, default invoice host and instructions. Enter the actual beneficiary and receiving details, record the product-policy eligibility basis or required provider approval, choose products/annual passes/both, then save. Enable only a genuinely usable route. No secret API keys, banking passwords or wallet recovery material belong in these fields.

Lower priority numbers appear first. The specialist-provider default is5 so it can become preferred after approval; Interac10, bank20, PayPal30, Stripe40, BTCPay50, NOWPayments60. Each configured USD/CAD account has its own priority. Pausing prevents new selection and invoice acceptance; it does not cancel external provider invoices already issued. Cancel those in the provider when necessary.

## What each option needs
- Interac: bank-registered CAD receiving email and exact payee.
- Bank transfer: business bank incoming-transfer instructions and beneficiary; separate entry for each receiving currency/account.
- PayPal: an eligible business account; a separate exact-amount PayPal invoice. Personal transfers, PayPal.Me and friends-and-family are not used. Legacy business-invoice fragment URLs are supported.
- Stripe: an eligible activated account and a live Stripe-hosted invoice. This does not re-enable the old retired Stripe checkout. Test URLs and generic reusable payment links are rejected.
- BTCPay: the owner's running HTTPS BTCPay instance, synchronized and configured with a receiving wallet. Use an exact invoice checkout `/i/...`. This release does not provision a node, wallet or paid hosting. The provider determines crypto amount/network/expiry; wait for settlement and review exceptions.
- NOWPayments: eligible account and configured receiving/payout setup with the exact hosted invoice URL. This is crypto invoicing, not approval-free fiat/card acquiring. Fiat conversion and card on-ramp are separate services.
- Priority processor: an approved provider, exact hosted-payment hostname and exact invoice link.

For crypto, the USD/CAD amount is the invoice accounting value, not a representation that a bank received fiat. Verify the provider's settled invoice and transaction reference, including network/fees/partial or late-payment exceptions, before recording receipt. No blockchain or provider webhook verification is introduced by this release.

## Customer interface
`/payment-options.html` lists installed choices and current availability from the backend. The footer and cart link to it. In the account invoice form, customers can choose among currently enabled routes. The backend validates the choice and derives provider/name/currency from its own record. The chosen preference is displayed to staff but is not an irreversible payment routing instruction. A disabled or unknown preference is rejected rather than silently routed elsewhere.

## Preservation
No receiving account or processor credentials are seeded. No card is charged. No account contract, fees or personal guarantee is accepted. Pricing, annual pass terms, funds-verification logic, supplier fulfillment and transactional notification behavior are retained. Existing financial tests still apply; new tests cover exact provider hosts, malicious URL forms, scope restrictions, public redaction, priorities, snapshots and preference ownership.

## Official sources reviewed
- https://developer.paypal.com/invoicing/about/ — hosted business invoices.
- https://www.paypal.com/ca/legalhub/paypal/acceptableuse-full — actual catalog eligibility and preapproval categories.
- https://docs.stripe.com/invoicing/hosted-invoice-page — unique hosted invoice URLs.
- https://support.stripe.com/questions/prohibited-and-restricted-businesses-faqs — research-peptide eligibility is conditional; not every case requires prior approval, but account/product/buyer controls still apply.
- https://docs.btcpayserver.org/Users/invoices/ — invoice expiry, settlement and exceptions.
- https://nowpayments.io/invoices — hosted crypto invoice option.

Adding provider support is not underwriting approval or proof of real payment settlement. Live account activation and the first authorized funds-receipt test remain separate.
