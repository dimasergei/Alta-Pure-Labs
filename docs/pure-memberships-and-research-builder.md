# PURE memberships and Auto-Stack™

## Public experience

The shared desktop/mobile navigation, homepage, account navigation, and checkout link to the restored programs. Paid tier IDs remain `vip` and `elite` for database compatibility; their customer-facing names are PURE WHITE and PURE BLACK.

| Benefit | PURE WHITE | PURE BLACK |
| --- | --- | --- |
| One-month prepaid term | US$19.99 | US$99.99 |
| One-year prepaid term | US$191.90 | US$959.90 |
| Merchandise discount | 5% | 10% |
| Points per eligible US$1 | 5 | 10 |
| US standard/express shipping | Included | Included |
| Priority fulfillment | Normal paid option | Included |
| Complimentary BAC Water | — | One 3 mL vial per paid goods order |
| Monthly account credit | — | US$50 after a qualifying US$150 merchandise order |

The better of the member discount or a valid coupon applies. Eligible Crypto savings are applied afterward. Membership fees cannot receive discounts, points, credits, shipping charges, or earned rewards. International and next-day delivery retain their normal prices.

The monthly credit threshold uses merchandise after discounts and before redemptions. It is future USD account credit, once per UTC calendar month. CAD earnings and qualification use the validated underlying USD merchandise value. USD balances cannot be redeemed against a CAD payment.

## Payment and entitlement boundaries

- Memberships are **prepaid terms without automatic renewal**. An account with an active term cannot purchase another until that term expires.
- Current routes are hosted Rampex and Polygon USDC for USD, and the existing Canadian Interac checkout for a fixed CAD amount. Current method scope, account configuration, country, pricing contract, and receipt are checked.
- A paid source invoice, matching customer/tier, exact payment receipt, and supported pricing version are required for membership activation. One month/year is measured from verified payment, with exact dates shown in the account.
- Unpaid, expired-but-unresolved, and legacy pending membership purchases are surfaced for continuation, cancellation, or support review. They do not activate benefits or permit another uncertain purchase.
- A full verified membership refund revokes that entitlement. Goods checkout snapshots the membership at acceptance; natural expiry does not remove benefits during its normal 24-hour payment window. Revocation before payment requires reconciliation.
- BLACK gift and priority handling use the paid order's stored entitlement and the generic manual fulfillment queue. No supplier dispatch is added.
- A refunded qualifying goods order reverses its US$50 reward when sufficient credit remains. If the reward has already been spent, `platinum_credit_reconciliation_required` records the need for manual reconciliation. The original monthly grant key remains reserved to prevent duplicate awards.

## Auto-Stack™

Auto-Stack™ is the customer-facing brand. The existing `/research-builder` and `/research-checkout` URLs, API parameters, schema names, contract versions, and saved-selection keys remain unchanged.

One-time mode accepts four distinct injectable compounds, one unit each, with current catalog prices and eligible ordinary checkout benefits. It adds those selections to the existing cart without discarding unrelated items.

The monthly mode is a **non-purchasable preview** of the 40% offer, BAC Water inclusion, and US express shipping. The proposed monthly subscription continues until canceled, with no minimum deliveries. Customers can edit future selections anytime without waiting for the first shipment, and cancel anytime to stop future renewals. The monthly selector displays **40% off** while the availability notice continues to explain that enrollment is unavailable.

Auto-Stack™ terms `research-builder-2026-11-v3` set `minimum_paid_cycles` and `cancel_after_paid_cycles` to `0`, and `change_after_first_shipment` to `false`. No existing integration has a verified recurring mandate/renewal path, so `automatic_renewal` and `subscription_available` remain `false`. The UI does not create a subscription, collect a recurring consent, schedule deliveries, or apply the subscription discount to a one-time order. Historical subscription records remain readable with their paid-cycle count, recorded dates, and delivery history; the UI does not turn their stored legacy minimum into a new purchase requirement. Renewal and mutation guards stay closed, and account cards direct existing customers to support for changes or cancellation.

Connecting real recurring billing requires a separately verified processor capability, explicit recurring consent and cancellation rules, idempotent renewal receipts, failed-payment handling, and subscription lifecycle tests. Changing a config boolean alone cannot enable it.

The original subscription migration, `supabase/migrations/20261115090000_research_subscriptions.sql`, still defaults `minimum_paid_cycles` to `3` and constrains it to `3`; its provider field permits only `null` or `nmi`. No schema change is part of the v3 preview update. Before actual enrollment is enabled, add a forward migration for the revised terms and verified provider while preserving historical records. Implement accepted recurring consent, cycle-to-order mapping, editable snapshots for future orders, cancellation of future renewals, and idempotent activation from verified payments. The new public terms fields alone do not implement subscription edits, cancellation, or automatic charges.

## Requested renewal model and connection blocker

The requested recurring model is explicit, but **is not activated by this release**:

| Offering | Required renewal behavior |
| --- | --- |
| Auto-Stack™ | Renew monthly until canceled; no minimum deliveries; changes apply to future unpaid orders |
| PURE WHITE / PURE BLACK monthly | Renew every calendar month until canceled |
| PURE WHITE / PURE BLACK annual | Renew every calendar year until canceled |

Already-paid membership terms must not be enrolled automatically. A new recurring enrollment needs the customer's agreement to the amount or pricing rule, interval, and future charges. Cancellation stops future charges while retaining the current paid membership period and already-paid Auto-Stack™ order.

On November 18, 2026, the live configuration had Rampex hosted card payments, Polygon USDC, manual CAD Interac e-Transfer, and manual US bank transfers. No NMI or PayerURL account or environment configuration was present. There were no Auto-Stack™ subscription records. These are point-in-time observations, not a runtime capability check.

Rampex's [creator-tools article](https://rampex.io/insights/creator-tools-payment-gateway) advertises subscription billing. Its published [API documentation](https://rampex.io/api-docs), [FAQ](https://rampex.io/faq), [MCP documentation](https://rampex.io/mcp), public dashboard/settings code, and [official WooCommerce plugin](https://wordpress.org/plugins/rampex-io-payment-gateway/) did not expose a recurring mandate, reusable merchant payment token, off-session charge operation, or subscription update/cancel interface in this review. The current API operations and site adapters create individual payment sessions. This does not rule out a private Rampex capability; it leaves that capability unverified.

The external dependency is Rampex's actual recurring integration contract and confirmation that the merchant account is enabled for it: hosted consent/setup, mandate identifiers, monthly and annual schedules, variable future Auto-Stack™ amounts, update/cancel operations, idempotency, authenticated lifecycle events, failure handling, and a supported verification procedure. Scheduled payment links or reminders are not automatic collection. Do not enable availability flags or remove the unavailable-billing notice based on the marketing claim alone.

Once that contract is available, implement each renewal as one immutable billing period linked to one paid order and verified provider transaction. Duplicate events must not repeat fulfillment, credits, points, or membership coverage. Membership renewals need a narrow path that permits successive periods for the same subscription while preserving ordinary prepaid duplicate-purchase guards. Auto-Stack™ edits need a versioned future selection and price, with paid orders kept unchanged; cancellation and payment races need reconciliation. Test month-end and leap-year periods, failed payments, duplicate/out-of-order events, future-selection changes, cancellation, and refund isolation before enabling enrollment.

## Database and deployment

`20261118180549_pure_membership_checkout.sql` adds the order membership reference and priority flag, validates v8 USD / v2 CAD checkout independently, and opens only the supported prepaid paths. Public mutation RPCs remain restricted to `service_role`; helpers and preserved legacy functions are private.

The migration preserves the exact installed v7 USD / v1 CAD goods contracts so the current deployment can continue during rollout and a code rollback. It aborts if those installed function definitions no longer contain the expected contract versions. Existing orders, balances, subscription history, and fulfillment assignments are retained. Approved active payment methods expand from products to products plus prepaid memberships; receiving destinations and provider activation are unchanged.

## Verification

- `npm run build`: generated routes, assets, policy styling, checkout and storefront regressions, plus actual published-script startup tests for early/delayed COA responses, locale refreshes, and preserved program selections. Dedicated program clients own their DOM; the shared workspace renderer must preserve it.
- `npm run test:account-dom`: account, shared navigation, checkout, catalog, and partner interactions.
- `node tests/pure-customer-pages-audit.cjs`: every published customer page's resources, local destinations, navigation, titles, viewport metadata, IDs, and paid tier names.
- `npm test`: server and DOM behavior, including membership fees, provider guards, account states, builder routing, and admin scope controls.
- `tests/membership-financial-sql.test.cjs`: executed PostgreSQL behavior using PGlite. The repository pins `@electric-sql/pglite` 0.5.16 as a development dependency; verify zero skipped financial tests. `PGLITE_MODULE` or `NODE_PATH` can point to an isolated installation when necessary. Covers fee combinations, source/receipt proof, discounts, rounding, CAD USD-basis earnings, snapshots, refunds, monthly credit, fulfillment, legacy compatibility, and grants.

Browser visual verification is separate from DOM/static assertions. Do not infer a completed mobile/desktop walkthrough from the automated test results or make a live payment merely to verify layout.
