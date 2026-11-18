# PURE memberships and Research Builder

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

## Research Builder

One-time mode accepts four distinct injectable compounds, one unit each, with current catalog prices and eligible ordinary checkout benefits. It adds those selections to the existing cart without discarding unrelated items.

The monthly mode is a **non-purchasable preview** of the recovered 40% offer, three-paid-cycle minimum, BAC Water inclusion, and US express shipping. No existing integration has a verified recurring mandate/renewal path. The UI does not create a subscription, collect a recurring consent, schedule deliveries, or apply the subscription discount to a one-time order. Historical subscription records remain readable; renewal and mutation guards stay closed.

Connecting real recurring billing requires a separately verified processor capability, explicit recurring consent and cancellation rules, idempotent renewal receipts, failed-payment handling, and subscription lifecycle tests. Changing a config boolean alone cannot enable it.

## Database and deployment

`20261118173524_pure_membership_checkout.sql` adds the order membership reference and priority flag, validates v8 USD / v2 CAD checkout independently, and opens only the supported prepaid paths. Public mutation RPCs remain restricted to `service_role`; helpers and preserved legacy functions are private.

The migration preserves the exact installed v7 USD / v1 CAD goods contracts so the current deployment can continue during rollout and a code rollback. It aborts if those installed function definitions no longer contain the expected contract versions. Existing orders, balances, subscription history, and fulfillment assignments are retained. Approved active payment methods expand from products to products plus prepaid memberships; receiving destinations and provider activation are unchanged.

## Verification

- `npm run build`: generated routes, assets, policy styling, checkout and storefront regressions.
- `npm run test:account-dom`: account, shared navigation, checkout, catalog, and partner interactions.
- `node tests/pure-customer-pages-audit.cjs`: every published customer page's resources, local destinations, navigation, titles, viewport metadata, IDs, and paid tier names.
- `npm test`: server and DOM behavior, including membership fees, provider guards, account states, builder routing, and admin scope controls.
- `tests/membership-financial-sql.test.cjs`: executed PostgreSQL behavior using PGlite. The repository pins `@electric-sql/pglite` 0.5.16 as a development dependency; verify zero skipped financial tests. `PGLITE_MODULE` or `NODE_PATH` can point to an isolated installation when necessary. Covers fee combinations, source/receipt proof, discounts, rounding, CAD USD-basis earnings, snapshots, refunds, monthly credit, fulfillment, legacy compatibility, and grants.

Browser visual verification is separate from DOM/static assertions. Do not infer a completed mobile/desktop walkthrough from the automated test results or make a live payment merely to verify layout.
