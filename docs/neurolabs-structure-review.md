# NeuroLabs structure review and AltaPure implementation

Reviewed 11 November 2026 in the connected browser. This supplements the earlier [technology inspection](neurolabs-public-technology-audit.md). The findings below describe visible customer experiences, not verified private integrations or sales volume. No NeuroLabs order, payment, application or prize entry was submitted.

## Changes in this release

- One compact header: Products, Research Builder, Bulk Orders, Memberships, COAS, Contact Us, More. About and Categories are removed from navigation. Products retains the full catalog and its existing category filters.
- More opens on desktop hover and keyboard focus, and toggles on mobile tap. Arrow keys, Home/End, Escape, outside click, focus restoration and expanded-state announcements are supported.
- More contains the working AltaPure destinations: Partner Program, Track Order, Rewards & Credit and FAQ. Gift Cards and Spin the Wheel are not advertised as operating services.
- The account icon has a direct dropdown to the seven consolidated account areas. Membership and Partner render inside the account, as released in PR #69; tracking and historical orders stay under Orders.
- The homepage now leads directly from its hero to featured compounds, with Products and COAS as its main destinations. The redundant category landing section is removed. Existing category filtering stays on Products.
- Footer navigation is organized into Popular, Useful Links and Connect. All customer page shells use the same header. Checkout retains its focused header and its existing server-authoritative totals.
- AltaPure branding, catalog, exact variants, product images, prices, bank checkout, account balances, historical orders and manual fulfillment remain intact.

## Public workflow comparison

| Area and reference | Observed NeuroLabs experience | AltaPure status and remaining work |
|---|---|---|
| [Header and homepage](https://neurolabsresearch.com/) | Single row with primary pages and hover menus; hero, featured products, packaging/testing sections, FAQ and email capture. | Primary navigation and footer structure implemented. AltaPure uses its own assets, original copy and actual catalog. Packaging, eight-test-panel, purity, sale and dispatch claims require AltaPure evidence before use. |
| [Products](https://neurolabsresearch.com/shop/) | Search, sort and category filtering; product cards with images, prices, product links and cart controls. | Available. Category filters remain on Products. Existing saved-product, variant and comparison controls remain usable. Prices and discounts are not changed by this release. |
| [Product detail example](https://neurolabsresearch.com/product/nl-3rt/) | Variant selector, quantities, product documents, lab verification, related products, BOGO bundles, points, subscription offer, shipping countdown and card/wallet logos. | Exact-size AltaPure images/prices, cart, documents and research-use information exist. Provider logos, countdowns, BOGO and subscription claims must reflect working services. A visible Apple Pay button elsewhere on NeuroLabs does not identify its acquirer or prove AltaPure eligibility. |
| [COAs](https://neurolabsresearch.com/coas/) | Cards include compound/strength, lab, report ID, date, measured purity/net content, view/verify links and earlier reports. | AltaPure has 83 original supplier report records covering 45 of 84 catalog variants in `data/supplier-coas.json`; 39 variants still need an exact reference. These are not matched, fulfilled lots. Reports retain supplier/client attribution and are not represented as AltaPure lot-specific testing. Match the actual purchased supplier lot to each fulfilled order when supplied. |
| [Research Builder](https://neurolabsresearch.com/research-builder/) | Four compounds, monthly billing, three-delivery initial commitment, advertised 40% discount and bundled shipping/supply benefits. | Four-compound planning and saved lists exist. Recurring billing is not active. Completion requires an approved recurring-capable merchant, token storage, explicit consent, renewal scheduling, failed-payment handling, cancellation/skip/change flows, entitlements and per-cycle fulfillment. |
| [Bulk Orders](https://neurolabsresearch.com/bulk-orders/) | Quantity matrix; minimum ten units per product with strengths combined; advertised 50%/60% tiers and express shipping. | Quantity planning and ordering exist. Current AltaPure volume rules remain 5% at ten units and 10% at 25 units, subject to the server's best-discount rule. Copying larger discounts/free delivery requires actual unit-cost and fulfillment support. |
| [Memberships](https://neurolabsresearch.com/memberships/) | Free, VIP and Elite; monthly/annual choices, points multipliers, shipping benefits and monthly Elite credit. | Free account and nonrenewing 365-day VIP/Elite passes work through checkout, at current AltaPure terms. Recurring billing, monthly credit grants and new multipliers need ledger rules, refund/expiry handling and provider tests before activation. |
| [Checkout](https://neurolabsresearch.com/checkout/) | Shipping, delivery and payment stages; billing address option, summary, coupon, points and optional shipping protection. Apple Pay was visible. | AltaPure's direct checkout has address collection, a responsive summary, live methods and points/issued-credit controls. Bank transfer is available. Cards, Apple Pay and Google Pay remain dependent on actual merchant activation and successful provider testing. Shipping insurance cannot be offered without a real coverage/claims process. |
| [Account](https://neurolabsresearch.com/my-account/) | Overview, membership, subscriptions, points, credit, orders, profile and partner areas. | Seven consolidated AltaPure areas are already live: Overview, Orders, Membership, Rewards, Profile, Partner and Support. Name, phone, organization, addresses, confirmed email change and password recovery are supported. Existing Stripe history and assigned tracking are retained. No subscription tab promises an unavailable recurring service. |
| [Partner Program](https://neurolabsresearch.com/partner-program/) | Advertises up to 40% first-order commission, 10% later orders, 20% customer first-order discount, 30-day attribution, $100 minimum and monthly payouts. | Durable partner applications and the account form exist. A full affiliate system still needs signed program terms, attribution, referral codes, server-calculated commissions, refund/chargeback reversals, fraud controls, payout approval/reconciliation and partner statements. No automatic commission obligation is created by the current application form. |
| [Gift Cards](https://neurolabsresearch.com/gift-cards/) | $25–$1,000 amounts, self/gift choice, recipient details, scheduled email, code/PIN and partial redemption. | Issued store credit works; gift-card sales and gifting are not implemented. Add paid-only issuance, code/PIN security, gift liabilities, recipient claim, scheduled delivery, partial redemption, duplicate-webhook protection and refund/cancellation treatment before listing this in More. |
| [Track Order](https://neurolabsresearch.com/track-order/) | Public order-number and billing-email form. | AltaPure's Track Order path leads to authenticated Orders with carrier tracking. A future public lookup must add rate limiting and enumeration protection without exposing other customers' details. |
| [Spin the Wheel](https://neurolabsresearch.com/spin-and-save/) | Completed-order eligibility and one spin per order; discount, refund, shipping and no-win outcomes. | Not launched. Needs approved promotion rules and eligibility, an auditable server-side award record, one-time redemption and refund/abuse handling. A decorative wheel without those controls would create unsupported promises. |
| [Contact Us](https://neurolabsresearch.com/contact-us/) | Name, email, subject, message, optional attachment, order-support information and stated response time. | AltaPure has a durable inquiry form, email contact and account support requests. Do not promise NeuroLabs' 24-hour staffing response or add uploads without attachment security and an actual support process. |
| Promotions and email/SMS | BOGO, first-order email discount, cart gift thresholds, SMS consent and gift progress UI. | No new campaign, discount obligation, SMS enrollment or newsletter promise is activated. These need an authoritative pricing engine, eligible inventory and consent/unsubscribe records. |

## Exact supplier references still missing

The checked-in supplier report index identifies these 39 variants. A nearby strength or another supplier's lot is not an exact substitute. For needles, the appropriate supplier specification/conformity document may differ from a peptide assay COA. Final fulfillment still requires the actual supplied lot even for the 45 variants with reference reports.

| Product | Missing exact strength or size |
|---|---|
| Retatrutide | 30mg, 40mg, 60mg |
| Tirzepatide | 10mg, 20mg, 30mg, 40mg, 60mg |
| Semaglutide | 10mg, 20mg, 30mg |
| 5-Amino-1MQ | 10mg |
| TB-500 | 5mg |
| BPC/TB-500 | 15mg/15mg |
| KPV | 5mg |
| LL-37 | 5mg, 10mg |
| AHK-Cu | 50mg, 100mg |
| CJC-1295 W/DAC | 10mg |
| CJC/Ipamorelin | 10mg/10mg |
| Sermorelin | 5mg |
| Tesa/IPA | 5mg/5mg |
| Semax | 5mg |
| Selank | 5mg |
| Semax/Selank | 10mg/10mg |
| Adamax | 10mg |
| Pinealon | 10mg |
| SS-31 | 50mg |
| MOTS-C | 20mg |
| B-12 | 10mg |
| Melanotan 1 | 10mg |
| Kisspeptin | 5mg |
| Oxytocin | 5mg, 10mg |
| VIP | 5mg, 10mg |
| BAC Water | 3 mL |
| Needles 31G 5/16" | 10pk |

## Payment activation remains the first operational dependency

The current website code cannot replace merchant approval. NMI/PeptidePay card and wallet presentation must come from an enabled, verified provider configuration. The remaining acceptance checks are provider account activation; approved catalog/countries/currencies; production credentials; wallet/domain setup where required; and successful sandbox/provider-authorized testing of charge, decline, retry/idempotency, callbacks, reconciliation and refunds. A live transaction requires the actual merchant configuration and explicit payment authorization.

Do not infer a private supplier, card acquirer, subscription platform, affiliate network size, revenue or delivery performance from NeuroLabs' public UI. Public pages did not establish those facts.

## Completion order for the remaining programs

1. Activate and verify the existing payment integration with the real approved merchant. Retain operational bank checkout while approval/testing is outstanding.
2. Implement recurring billing only against that provider's supported token/renewal APIs. Connect renewal success to membership and fulfillment; test cancellations and failures before offering subscriptions.
3. Build affiliate attribution and commission accounting with agreed economics. Use admin-approved payouts and reconcile refunds/chargebacks before paying commissions.
4. Add gift-card issuance and recipient redemption on top of the existing protected credit ledger, with paid-only issuance and refund controls.
5. Add optional promotion/gift programs only when the underlying rules, inventory and fulfillment exist. Match supplier lots to customer orders as fulfillment evidence arrives.

These are genuine unfinished capabilities, not features completed by reproducing a menu label.

## Release verification

This change needs no migration and does not modify payment configuration or database permissions. Validation consists of the existing unit suite, the complete production build, isolated DOM interaction tests for both account/checkout and the shared menus, then desktop/mobile verification against the exact production deployment. CI and deployment identifiers are recorded on the release pull request. The previously working production deployment remains the rollback target.
