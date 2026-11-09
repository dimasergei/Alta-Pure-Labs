# Commerce eligibility integration plan

**Current implementation status:** Planning primitives only. `lib/commerce-eligibility.js` is an isolated pure module. No live checkout, Stripe webhook, account, payment, shipping-rate, order or Supabase behavior calls these functions yet.

The existing `api/checkout.js` creates Stripe Checkout Sessions in **USD**, collects shipping addresses from **US only**, and requires a flat **$25** shipping rate. The current customer-facing currency selector estimates prices in CAD, EUR, GBP and AUD; it does not change checkout settlement or enable other payment rails.

## Pre-activation requirements

1. Finish the 84-variant SKU register. Every requested shipping lane must have a documented lawful basis; default to DENY. Exact key: SKU + destination country/region + fulfillment origin/site + shipping service.
2. Obtain provider contracts and SKU-level written bank underwriting, with allowed customer countries and payment rails, from the actual acquiring bank or authorized platform. Provider sales pages alone do not satisfy this.
3. Confirm the business's legal seller of record, supplier/manufacturer identities, fulfillment origin, exporter/importer of record, customs documentation, packaging/temperature constraints and carrier acceptance.
4. Finalize real shipping prices and which party charges the customer. Do not reuse the US $25 flat rate for other countries.
5. Design a new payment-provider adapter **after** a provider is selected: signed provider webhooks, replay/idempotency controls, customer payment authorization, refund/dispute handling, order/payment event reconciliation, source-of-truth statuses and audit logging.
6. Review legacy Stripe orders, disputes and refund obligations before retiring Stripe. Do not simply delete keys/endpoints or orphan existing customer history.
7. Stage with sandbox credentials and non-production accounts. Validate account sign-in, order totals, destination/product checks and notifications, then obtain separate approval for production cutover.

## Fail-closed rules implemented for later use

- `skuKey()` derives exact internal SKU keys from *server-validated* `product_id` and `variant_size`, using the same naming convention as the SKU register.
- `evaluateShipping()` denies unless every product is covered by one uniquely matching approved lane and that lane has current dated review, written carrier acceptance, origin/import/export information and a regulatory evidence reference.
- `evaluatePaymentRail()` denies unless shipping is already approved, the requested customer payment method/country/currency and the full basket are covered by one uniquely matching provider approval, and bank + executed agreement references are present.
- No wildcards, missing dates, duplicate lane entries, expired evidence or partial-cart approvals are accepted.
- The module has no network access or credential reads and does not perform any payment or shipping action.

These are internal guardrails, **not proof of authorization**. The existence of a reference string or an `APPROVED` field alone does not establish legal correctness; the supporting documents must be validated and managed in a controlled evidence store.

## Intentional non-changes

- No modifications to `api/checkout.js`, `checkout.js`, `api/stripe-webhook.js` or `lib/backend.js`.
- No database migrations or security policy changes.
- No environment-variable, credential, production-payment or shipping configuration changes.
- No new product or destination was enabled.
- No merchant account, provider application, customer order or test payment was created.

**Next code milestone after evidence and acquiring contract:** create a real server-side order-eligibility decision before session/payment initiation. Require destination selection before payment; derive allowed checkout methods and shipping services from signed-off exact-scope records rather than browser input, and implement the approved provider's sandbox flow.
