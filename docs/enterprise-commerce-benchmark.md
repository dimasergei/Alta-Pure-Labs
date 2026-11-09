# AltaPure Labs — enterprise commerce benchmark and implementation architecture

**Benchmark:** https://neurolabsresearch.com/  
**Research date:** 2026-11-09  
**Scope:** Public-facing site only; no checkout, purchases, accounts, or private endpoints accessed.  
**Design constraint:** Preserve AltaPure Labs' existing visual identity, product photography, typography, colors and responsive design. Replicate useful *behavioral patterns*, not competitor source code, logos, product claims, copyrighted text, images or exact visual trade dress.

## Evidence and limitations

- This is a public-surface competitive feature inventory, **not** an audit of the competitor's internal infrastructure. We cannot verify its actual payment processor, shipping software, CRM, fulfillment ERP, supplier contracts, database, fraud system, email/SMS providers or inventory source without direct evidence.
- Published purity, laboratory testing, same-day dispatch, worldwide shipping, free shipping, payment-method and promotional claims are statements on the competitor's website. They are not independently verified operational or legal authorizations.
- Public pages show inconsistent promotional statements: the homepage advertises BOGO + 10%, bulk page title says 40%/50% but body currently says 50%/60%, and shipping cutoffs differ by section (3 PM CT versus 1 PM PST). AltaPure must have one authoritative promotion/shipping rules engine and no conflicting marketing copy.
- Any reference to research-use-only products does **not** prove that sale, advertising, payment acceptance, import or export is lawful. Never use competitor behavior as regulatory permission.

## Public feature inventory (verified from website pages)

| Capability | Observed behavior | Public source |
|---|---|---|
| Global navigation/search | Product, Research Builder, Bulk Orders, Memberships, COAs, Contact; global compound and help search | https://neurolabsresearch.com/ |
| Catalog | Search, category filters, sorting, variant ranges, stock statuses, add-to-cart | https://neurolabsresearch.com/shop/ |
| Campaigns | BOGO offer, 10% promotion, first-order signup discount, cart thresholds for free shipping/gifts | https://neurolabsresearch.com/ |
| Research Builder | Four compounds per monthly shipment, three initial deliveries, displayed 40% discount, separate builder cart | https://neurolabsresearch.com/research-builder/ |
| Bulk ordering | Per-product minimum of 10 units, strengths combined, higher tier at 50, separate checkout, no coupon/member stacking | https://neurolabsresearch.com/bulk-orders/ |
| Memberships | Free, VIP ($19.99/month), Elite ($99.99/month), annual pricing, discounts, points multipliers, shipping and credit perks | https://neurolabsresearch.com/memberships/ |
| Affiliates | Partner registration, attribution window, first-order and recurring commission, payout threshold | https://neurolabsresearch.com/partner-program/ |
| COA library | Searchable batch reports, lab name, date, report ID, previous lots, external verification links; public page advertises 44 reports / 24 compounds | https://neurolabsresearch.com/coas/ |
| Tracking | Order ID + billing email lookup | https://neurolabsresearch.com/track-order/ |
| Shipping | Domestic/international shipping claims, UPS standard/express, free-shipping promotions, tracking, damage claims | https://neurolabsresearch.com/shipping-policy/ |
| Customer capture | First-order email signup, optional SMS consent, age gate, opt-in copy | https://neurolabsresearch.com/ |
| Payments | Homepage FAQ claims major cards and Apple Pay; actual acquiring processor/merchant account not verified | https://neurolabsresearch.com/ |

## AltaPure current baseline (confirmed in repository)

- Static branded storefront and 46 product records / 84 sellable variants.
- Customer Supabase Auth with email/password and Google OAuth, account pages, customer orders.
- Admin orders, supplier batches, suppliers and notifications.
- Currency selector USD/CAD/EUR/GBP/AUD (display estimates) and English/French/Spanish for primary shopping UI.
- Checkout currently **paused**: production `CHECKOUT_ENABLED=false`; read-only `/api/checkout-status` exposes availability. Existing Stripe event history/webhooks remain for historical transactions.
- Server-side commerce-eligibility *planning primitives* exist, but are not yet connected to payment or fulfillment. No product, destination or alternative payment rail is approved by the planning documents.
- Current shipping policy correctly describes the paused U.S.-only legacy checkout, not worldwide fulfillment.

## Recommended product modules, in implementation order

### 1. Commerce core and source of truth

Create explicit product, SKU/variant, price-book, inventory, supplier-offer, customer, order, payment, shipment, batch/lot and COA entities. Separate merchandising status from compliance/eligibility status. Version all price changes and marketing copy. Define event types and idempotent audit history. Do not infer inventory from a supplier price sheet.

Minimum models:
- `catalog_products`, `catalog_variants`, `product_claims`, `price_books`, `price_book_entries`
- `supplier_accounts`, `supplier_offers`, `supplier_stock_snapshots`, `supplier_sku_mappings`
- `inventory_lots`, `quality_documents`, `coa_publications`, `sku_regulatory_decisions`
- `fulfillment_sites`, `shipping_services`, `shipping_lane_approvals`, `shipping_quotes`
- `payment_providers`, `provider_approval_scopes`, `payment_attempts`, `payment_events`
- `promotions`, `promotion_rules`, `promotion_redemptions`, `customer_entitlements`
- `memberships`, `membership_plans`, `subscriptions`, `subscription_cycles`
- `reward_ledgers`, `store_credit_ledgers`, `referrals`, `commission_ledgers`
- `shipment_events`, `returns`, `disputes`, `audit_events`

These are proposed logical entities, not existing tables. Design migrations separately and test on disposable DB before any production change.

### 2. Unified promotions engine

Implement one deterministic, server-authoritative pricing pipeline:
1. Validate exact SKU and quantity from the server catalog.
2. Verify product, customer type and destination eligibility.
3. Resolve active base price book and any permitted sale price.
4. Apply one compatible promotion group (coupon, BOGO, bulk, member or referral) according to explicit precedence and stacking policy.
5. Apply reward/credit balances with immutable ledger transactions.
6. Quote eligible shipping services and taxes/duties as applicable.
7. Recalculate on server at checkout; do not trust browser totals.

Admin: campaign creation, eligibility, start/end, per-customer usage, margin guard, stacking matrix, simulation and audit log. Do not copy competitor's discount percentages as defaults; they may be economically unsustainable.

### 3. Customer account, membership, rewards and referrals

Use the existing Supabase Auth account identity. Add:
- Membership entitlements, subscription state, cancel/renewal rules and lifecycle notices.
- Reward points as an immutable earned/redeemed/reversed ledger.
- Store credit as a liability ledger with expiry/eligibility controls, not a mutable balance field.
- Affiliate codes, attribution windows, returns/chargeback reversal, fraud controls, tax/payment identity verification and approval workflow.
- A unified account dashboard: orders, shipments, COAs, membership, rewards, credits, subscriptions, referrals, preferences and support.

Keep financial and recurring billing features behind provider and legal approvals. No automatic billing until an authorized payment partner supports it.

### 4. Batch-level COA library

Use supplier-supplied verified COAs with lot identifiers. Public COA pages should support:
- Search by product, strength, batch/lot, laboratory and report date.
- Document metadata, test methods, specifications and actual results, issuer and independent verification URL.
- Historical lot revisions and a tamper-evident publication audit.
- Product-page links to available matching COAs; order-detail link to the *actual shipped lot* only after allocation.
- Unavailable/missing COA state; never fabricate a report, purity percentage, accreditation or independent test.

### 5. Multi-supplier routing and fulfillment

Build an adapter contract for each of 99 Purity, Your Peptide Brand and PeptideDropship, subject to their actual integration options. Manual/CSV/API adapters must all produce normalized offer, inventory, order acknowledgement, shipment and exception events. No automatic supplier order until approved.

Routing requires:
- Exact product composition and strength match (no unapproved substitution).
- Current inventory and price confirmation.
- Verified product and jurisdiction eligibility, origin and carrier.
- Supplier onboarding/quality acceptance and SLA.
- Total landed cost, handling, shipping, duties, FX and return costs.
- Fallback only to another **independently approved** supplier and lane.

Admin: supplier scorecards, stock age, batch/lot traceability, allocation, order exception queues, shipment tracking, fulfillment SLA and reconciliation.

### 6. International commerce

Design for multiple countries but default to no sale/shipment:
- SKU × destination country/region × customer type × seller/importer/exporter × fulfillment origin/site × carrier service eligibility.
- Regulatory evidence versioning, review owner and expiry.
- Correct transaction currency and actual provider support, independent of display-only FX.
- Destination address validation, local shipping options, tax/duty determination and landed cost.
- Translation review of customer-facing legal policies and checkout disclosures.
- Block before payment when eligibility is absent. Do not treat a customer's RUO affirmation as an authorization.

### 7. Payment-provider adapters

Keep Stripe legacy webhook/order handling for historical transactions while checkout is paused. New adapters must be implemented only after written actual bank/processor acceptance of the exact catalog and customer geography:
- Signed server-side payment initiation, redirect or hosted fields as supported.
- Idempotent webhooks, replay protection, settlement reconciliation, refunds and disputes.
- Per-method country/currency restrictions.
- Distinguish customer payment rails from merchant payout rails.
- Provider-independent order state machine and audit events.

Never use a bank transfer, P2P method, crypto wallet, alternative merchant descriptor or business entity to evade underwriting restrictions.

### 8. Enterprise admin and analytics

Keep current AltaPure styling; extend existing admin navigation:
- Overview: GMV, gross margin, paid/refunded/disputed, fulfillment SLA, order exceptions.
- Catalog and price books; promotions; inventory and supplier offers.
- Compliance evidence and expiry; COAs and lot assignments.
- Orders, payments, shipments, returns, refunds, notifications.
- Customers, memberships, subscriptions, rewards, credit, affiliates.
- Support inbox, audit log, operational alerts and role-based access.
- CSV import/export with validation; later APIs and webhooks.

### 9. Performance, security and operations

- Desktop/mobile accessibility and browser QA.
- Audit logging, rate limits, fraud controls, bot protection and least-privilege database permissions.
- Queue/outbox for notifications and supplier handoffs with retry/dead-letter behavior.
- Observability: deployment health, errors, webhook lag, stock sync failures, fulfillment failures, reconciliation gaps.
- Backups, recovery tests, staging data isolation, privacy retention policies and vendor incident procedures.
- Feature flags and progressive rollout. No feature becomes an active checkout pathway merely by appearing in the UI.

## Implementation releases

| Release | Deliverable | Dependency / acceptance gate |
|---|---|---|
| R1 | Enterprise architecture, feature inventory, database design and read-only admin scaffolding | No production schema or checkout changes |
| R2 | COA library and verified batch metadata; product detail enhancements | Authentic supplier documents |
| R3 | Unified promotions/bulk calculator in preview; server-side unit tests | Margin and compatibility approval |
| R4 | Supplier adapter interfaces, manual import and fulfillment dashboards | Supplier contracts and verified SKU mapping |
| R5 | Membership/rewards/affiliate models and preview account screens | Payment/subscription and legal approvals before billing |
| R6 | Shipping lane rules and international quote architecture | Product/country/carrier approvals before enabling lanes |
| R7 | Approved provider adapter in sandbox and historical Stripe transition plan | Executed acquiring contract and approved SKU list |
| R8 | End-to-end staging QA, mobile, security, failure and recovery tests | Signed launch checklist and production approval |

## Immediate next implementation task

Create **R1** as a separate PR:
- Architecture decision record and table/entity relationships.
- Versioned feature registry with dependencies and statuses.
- Non-transactional admin scaffolding that does not imply eligibility.
- Disposable-database tests for future migrations, with no production SQL.
- Keep existing checkout paused and production payment/fulfillment settings unchanged.

## Benchmark URLs

- https://neurolabsresearch.com/
- https://neurolabsresearch.com/shop/
- https://neurolabsresearch.com/memberships/
- https://neurolabsresearch.com/research-builder/
- https://neurolabsresearch.com/bulk-orders/
- https://neurolabsresearch.com/coas/
- https://neurolabsresearch.com/partner-program/
- https://neurolabsresearch.com/track-order/
- https://neurolabsresearch.com/shipping-policy/
