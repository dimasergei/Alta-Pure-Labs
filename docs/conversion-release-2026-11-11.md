# Checkout conversion release — November 11, 2026

## Payment activation finding

The production checkout was inspected before edits: deployment
`dpl_1D6dfAaHZQVG8gGePZJuxGgiYVt1` was READY at application commit
`31f0444d840ca64e5a64a48b5df3a04ef492a519`. Main was
`488916729653d76e00d40204d984e2c24a8d5e1e`; the earlier native gateway and subsequent
checkout PRs were already merged. Supabase had zero gateway accounts, zero open
commerce orders and zero active memberships. No pending migration was assumed applied.

PeptidePay still displayed pending activation/rate confirmation. PeptideApprove
showed both its sandbox and NMI processor inactive. Gmail contained no newer
activation reply from Robert or PeptidePay. The existing application still needed
provider clarification/documentation; a configured payout wallet is not a live
card processor. No live charge, wallet authorization or order was submitted.

The release preserves those activation gates. It does not enable a sandbox route,
reactivate Stripe, alter bank account details, or advertise an untested wallet.
Card and instant Apple/Google Pay testing must resume when the provider actually
enables an account for the disclosed catalog. Verify exact amount/currency,
callback authentication, replay protection, settlement and a full refund before
activation. See `native-gateway-activation.md` and the existing processor records.

## Shipped application changes

- Cart: server-calculated merchandise discounts, shipping and estimated total;
  coupon entry carried to checkout; add-ons using real catalog items; free-US-
  shipping progress. Signed-in membership benefits are included in the estimate.
- Free standard US shipping at $250 after discounts, or with a paid membership,
  is enforced in both application and database pricing. Other orders retain $25
  standard shipping. Fulfillment stays manual.
- Bank option: “Same-day bank transfer (5% off products)”, with bank-cutoff and fee
  qualification. Relay's incoming domestic wire documentation says same-business-
  day receipt is typical before the sender's cutoff; this is not an instant ACH guarantee.
- Alta GOLD: $19.99/month or $191.90/year; 5 points/$ and 5% member pricing.
  ATLA PLATINUM: $99.99/month or $959.90/year; 10 points/$ and 10% member pricing.
  Free accounts earn 2.5 points/$. The best member, volume or BOGO line discount
  applies before coupons and bank savings. Annual prices save 20%, rounded to cents.
- Memberships are prepaid calendar terms, activated on verified payment. No
  automatic recurring card charge is created. Old purchases keep recorded prices
  and dates; v1/v2 checkout data remains supported for rollback and reconciliation.
- Partners enroll immediately after verified sign-in and explicit terms acceptance.
  A signed 30-day referral cookie, unique code, link and private dashboard are supplied.
  New-customer codes give 20% off; commissions are 20% first / 10% repeat on eligible
  net paid merchandise. Actual NeuroLabs account rates were 20% / 10%, while its
  public page advertised “up to 40%”. Self-referrals and historical paid customers
  cannot receive a first-order referral discount.
- Commission entries are unique per order, wait until delivery plus 30 days, and
  reverse on refunds. Paid refunds offset future payouts. Owner-recorded external
  payouts require an exact eligible balance and stable reference. No funds are
  moved by `/admin-partners.html`; the minimum payout is $100.

## Comparison boundaries and remaining differences

Reviewed NeuroLabs cart, checkout, membership monthly/annual selection, partner
program and the signed-in partner dashboard. Existing storefront template tests
also cover home, catalog, product variants, research builder, bulk, COAs, contact,
rewards and tracking. This is not a claim that every private or conditional
NeuroLabs state has been reproduced.

Unavailable or not included in this release: approved instant Apple/Google Pay,
automatic membership renewal, guaranteed express/priority supplier service,
PLATINUM monthly restricted $50 credit or free reconstruction-water gifts,
multiple custom partner codes, a multi-level partner network, click analytics,
shipping protection, and automatic partner bank payouts. These are not displayed
as working benefits. Product photos were explicitly deferred and are unchanged.

## Supplier integration finding

Lotus replied with its signup and API documentation; the owner said they applied.
No Lotus API key was configured. The server adapter supports authenticated catalog
and nonbinding quotes, exact product/pack mapping, deterministic order payloads and
safe tracking interpretation. It deliberately has no live order submission path.

To finish the supplier connection:

1. Lotus enables the partner account/API; owner stores `LOTUS_PARTNER_API_KEY`
   securely in the deployment environment (test key first).
2. Read the actual partner catalog and map every Alta product **and dosage** to a
   supplier product ID and supported vial pack. Never guess mappings or round quantities.
3. Test quote accuracy, identical-reference replay, conflict handling and cancellation
   with Lotus. Test orders can still be shipped; do not attach labels/pay them casually.
4. Add the durable handoff queue only after verified provider testing and supplier
   terms. Live POST /orders creates stock holds and an amount owed to the supplier.
5. The current Lotus workflow separately needs a paid supplier balance and a valid
   Pirate Ship label. It cancels unpaid orders after 48 hours. V1 has no webhooks;
   poll orders and mark shipped only with `status=shipped` and `shipped_at`, not just
   a tracking number or supplier `status=paid`.
6. Attach actual lot-specific COAs when assigned; supplier documentation is not proof
   that a future Alta order uses that lot. Manual supplier invoices remain supported.

## Validation and release sequence

Local validation: 273 unit tests, production build checks, four isolated DOM suites,
and PostgreSQL-compatible lifecycle fixtures including all prior native gateways,
balances, membership periods, partner attribution, duplicate first-order attempts,
payout idempotency, paid refund offsets, historical-customer exclusion and role grants.
Real PostgreSQL CI also runs the existing concurrent balance-spend check.

Apply `20261111163930_conversion_memberships_partners.sql` before deploying checkout
v3. The migration creates empty partner tables, secured service-only functions and
triggers; it does not create customer records, seed commissions, rewrite historical
orders, activate a gateway or change receiving details. Keep the previous production
deployment available for rollback; its v1/v2 checkout remains accepted by the migration.

References: https://partners.lotuspeptide.com/api/documentation,
https://neurolabsresearch.com/memberships/,
https://neurolabsresearch.com/partner-program/,
https://neurolabsresearch.com/partner-dashboard/,
https://relayfi.com/hc/en-us/articles/11638732752020-Receiving-a-domestic-wire/.
