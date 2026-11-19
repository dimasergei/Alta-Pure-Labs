# PURE monthly invoice checkout — November 19, 2026

## Payment model
- AUTO-STACK™ monthly is a four-injectable-compound bundle. Each month is a new, customer-authorized paid goods invoice.
- Exact product/strength choice is validated against the live catalog. Per-line savings are 40% (4,000 basis points), rounded down to cents independently per line. Quantity is one unit per compound.
- US express shipping and one BAC Water 3mL item are included. No further coupon, membership, crypto, points or store-credit discount stacks on this invoice.
- Supported payment methods are the existing approved Rampex **hosted Card** route and Polygon USDC **Crypto**, USD, with verified payment callbacks. There is no off-session card mandate, automatic charge, or saved payment credential.
- The visible **Automatic card billing** option is intentionally disabled until a verified recurring-capable card processor becomes available. Existing payment methods remain active.
- A monthly payment creates one paid cycle and one ordinary fulfillable goods order. Each further period needs a new invoice and customer action. The account offers Pay next month, Edit selections, and Cancel plan.
- Changes to selections affect future invoices; previously paid invoice lines and charges are immutable. Canceling stops the plan from accepting new linked invoices; it does not refund past payments or cancel already-paid fulfillment.
- PURE WHITE/BLACK paid memberships remain one-month or one-year upfront purchases. Annual price covers 12 months. No automatic renewal or unattended card charges are invented.

## Storage / release
- Forward migration `20261119170000_pure_manual_stack_cycle_invoices.sql` adds `pure_stack_plans`, `pure_stack_cycles`, strict validated monthly pricing, included BAC fulfillment, and idempotent verified-paid invoice recording.
- Existing `research_subscriptions` legacy records and prepaid membership SQL stay unchanged.
- Tables are RLS-enabled and service-role-only. Customer plan actions require a verified bearer token, owner filter, explicit action and origin validation.
- Production backend migration must be applied **before** deploying code enabling checkout.
- Test `npm run build`, focused monthly pricing / checkout / account and membership tests, plus database schema advisors and test readback.
- Do not simulate or submit a real card, Crypto transfer or charge as a deployment test.

## Further payment capability
- True automatic renewal requires a provider-approved customer consent, reusable mandate/token, signed renewal events, idempotent settlements, failure handling and cancellation API.
- Enable no automatic-card option until the processor contract and live merchant account eligibility are verified.
