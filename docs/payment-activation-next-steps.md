# Payment activation and remaining operating inputs

Reviewed November 10, 2026 against deployed main `9d6725c03777e6fd1dd3c4cebad35b71ba63099b` and the customer's open NeuroLabs checkout. This updates the pre-integration backlog; it does not certify merchant approval or real payment settlement.

## What is already installed

NMI Payment Component and REST v5, PayerURL server-created invoices and signed callbacks, durable attempts, duplicate-charge protection, reconciliation, full NMI refunds, private gateway administration and customer payment pages are deployed. The recorded native migration is `20261110164316_native_gateway_checkout`; do not apply the earlier filename again.

Manual invoice pricing/acceptance, prepaid nonrenewing passes, server-side member/volume discounts, transactional invoice email and its signed retry worker are also installed. Existing Stripe history and manual fulfillment remain intact.

Production inspection found no configured receiving routes, gateway accounts or native attempts. No live card or crypto activation is established. There are two supplier records but no loaded inventory lots or quality documents; records alone do not establish stock or fulfillment readiness.

## Updated NeuroLabs comparison

The signed-in payment step was inspected without submitting an order, entering payment details, linking a bank or accepting checkout terms. Its original selected bank method was restored. Customer information and merchant keys are intentionally omitted.

| Observed checkout choice | Direct technical evidence | AltaPure consequence |
| --- | --- | --- |
| Credit/Debit Card | `payment_method=nmi`; NMI Collect.js is loaded | Existing NMI adapter is the corresponding path. AltaPure uses the currently recommended Component/v5 integration. |
| Apple Pay / Google Pay | Both buttons render; NMI wallet asset is present | Buttons still require account, domain and eligible-device testing. Rendering is not evidence of successful payment. |
| All Credit/Debit Cards | `payment_method=noramp_platform`; description says secure redirect after order review | This is an additional provider route, not proof that PayerURL supplies the card option. NoRamp account eligibility and exact platform must be confirmed before integration. |
| Same-Day Bank Payment | `payment_method=linkmoney`; customer-bank linking description | Link Money is a separate pay-by-bank integration. Relay receiving instructions alone cannot reproduce this flow. |
| PayerURL | WooCommerce PayerURL script loaded, but no crypto payment choice in this checkout | Installed script does not prove crypto is currently offered or usable for this customer/order. |

NeuroLabs also showed shipping/delivery steps, a final summary and consent controls. Its discounts, protection fee, delivery promises and loyalty offers are its own commercial terms. They are not AltaPure defaults. The public checkout does not disclose its NMI acquiring bank or prove sales volume.

## Practical order of work

1. Complete the existing card-processor review. Ask for a decision on the exact catalog, Canadian entity, merchant/settlement identity, countries, currencies and annual passes. Confirm NMI Component/v5 support, sandbox access and full fees before a paid application or contract. An approved hosted invoice can use the existing hosted-provider route while native account testing finishes.
2. Create an owner-controlled NMI sandbox through https://guide.nmi.com/app/magic-login?mode=signup. NMI's free testing environment is available before live approval. Owner completes signup/terms. Keep test keys and fake data isolated from production. Enable sandbox processing only in that isolated test environment.
3. Configure and test the actual account using `native-gateway-activation.md`. Store keys only in protected hosting settings. Verify sale, decline, authentication/wallet behavior, callback replay, timeout reconciliation and full refund. Configure Apple Pay's provider-issued verification file/domain registration before offering it.
4. If crypto is wanted, the owner completes https://dash.payerurl.com/register. The observed form requires an email, Telegram emergency contact and a password. The owner chooses the receiving/custody arrangement and approves applicable fees. Confirm the adapter protocol and callback amount unit with that account; do not guess or substitute another PayerURL API contract.
5. Configure bank-confirmed Interac/transfer instructions in `/admin-payments.html`. The missing information is exact registered receiving name, permitted business use and incoming-payment instructions. Knowing a support/receiving email does not establish the bank account's registered payee or Autodeposit status. Never request an online-banking password.
6. Once the account passes testing, register its approved route in `/admin-gateways.html`. Perform a separately owner-authorized low-value live payment/refund and reconcile the actual settlement. Verify customer confirmation delivery and manual fulfillment acknowledgment/tracking.

## Existing processor threads

Gmail was rechecked before any further outreach. RFG is obtaining written NMI, fee, Relay and sandbox answers. Its no-cost pre-check belongs to the existing file. MOBOPAY requested a phone call. PeptideApprove has no approval reply. No new duplicate application or outreach was sent during this follow-up.

The RFG pre-check requires truthful processing history and projections. Do not infer those from test orders. A public marketing eligibility statement is not written approval of this merchant.

## Additional benchmark providers

Link Money's official quickstart requires merchant-portal access and server-side client credentials. Confirm Canadian seller eligibility, the actual catalog, USD settlement, buyer-bank coverage, fees and sandbox access before commissioning this additional adapter. It has separate sessions, webhooks and refund handling; it is not enabled by the NMI or PayerURL keys.

NoRamp's `noramp.dev` onboarding requires approval, an agreement and hosted identity/bank verification before credentials. Its restricted-product guide excludes needles and other categories present in some research catalogs. Its `noramp.io` policy is stricter and excludes consumer-style research sales and injection supplies. These public documents differ; the exact platform, contracting entity and written SKU scope need clarification. Do not remove product names from payment descriptions, conceal supplies or reroute disallowed goods to imitate another merchant's setup. Neither account approval nor a compatible non-Stripe processing arrangement has been established for AltaPure.

## Inputs for an operational business

| Area | Owner/provider input still required | Existing workflow |
| --- | --- | --- |
| Merchant account | Written acceptance and account-specific keys, approved scope and settlement details | Native NMI/PayerURL or approved hosted invoice |
| Interac | Exact registered recipient, CAD receiving address, business-use permission and Autodeposit/instruction confirmation | Manual verified receipt |
| Relay/bank | Bank-issued beneficiary, account currency and incoming ACH/wire instructions; legal title match | Private receiving-method configuration |
| Supply and quality | Real availability, costs, origin, lot identifiers, authentic reports and supplier fulfillment terms | Owner review and manual fulfillment; no invented stock/COA |
| Delivery/tax | Actual service/quote, destination eligibility and applicable tax/duty instructions | Final reviewed invoice before payment |
| Commercial hosting | Owner-authorized hosting plan suitable for commercial use | Team was observed on Vercel Hobby; billing approval remains owner-controlled |
| Acceptance | Authorized live payment/refund, email delivery, supplier handoff, tracking and settlement evidence | Existing audit/payment records; no dummy production financial records |

The current checkout remains request → owner review → final invoice → customer acceptance → payment → manual fulfillment. Automatic cart charging like the benchmark requires authoritative shipping/tax and supply rules first. Manual supplier handling itself can remain after instant checkout is introduced.

Nonrenewing VIP/Elite passes and published volume discounts are implemented. Product subscriptions, points, gift cards, spendable store credit, BOGO and partner commissions are not offered; their absence does not justify promising unimplemented benefits or copying the competitor's obligations.

## Primary sources inspected

- https://neurolabsresearch.com/checkout/ — visible payment choices and DOM identifiers.
- https://support.nmi.com/hc/en-gb/articles/34312649393681-Getting-Started-with-the-NMI-Payment-Gateway — free sandbox signup.
- https://docs.nmi.com/docs/payment-component — Component recommendation and wallet domain setup.
- https://payerurl.com/ and https://dash.payerurl.com/register — account entry and receiving-plan choices; advertised prices are not accepted terms.
- https://developer.link.money/quickstart/ — merchant access, sessions and credentials.
- https://noramp.dev/merchant-onboarding and https://noramp.dev/docs/restricted-products.md — approval path and restricted catalog.
- https://noramp.io/policy/research-use-only — separately published RUO eligibility policy.
- https://vercel.com/docs/plans/hobby — non-commercial personal-use restriction.

No private account credentials or customer checkout data belong in this document.
