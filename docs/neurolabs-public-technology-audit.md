# NeuroLabs public technology and workflow inspection

**Inspection:** Read-only browser audit of https://neurolabsresearch.com/ on 2026-11-09.  
**Browser run:** https://agent.tinyfish.ai/runs/ecaebc2d-a72f-40ca-af76-78a0794ec69a  
**Scope:** No accounts, carts, forms, payments or private APIs used.

## Technology fingerprints — evidence versus unknown

| Component | Observed evidence | Confidence |
|---|---|---|
| CMS / theme | WordPress markup and Hello Elementor theme fingerprints observed in page DOM | Public fingerprint, not server configuration |
| Commerce | WooCommerce product/cart/account conventions and WooCommerce-related assets | Public fingerprint |
| COA storage | Public documents under `/wp-content/uploads/2026/...` | Public URL pattern |
| COA verification | External `koveralabs.com/#/verify?code=...` links from individual reports | Publicly linked |
| Advertising pixels | Facebook pixel and Taboola placeholders/scripts observed | Presence does not prove events fire or conversions are attributed |
| Custom widgets | Age gate, cart panel and free-gift progress UI | Observable UI only |
| Actual card acquirer / payment gateway | Card/wallet icons visible, but no verified acquirer name | UNKNOWN |
| Subscription billing provider | Monthly/annual options visible, backend not verified | UNKNOWN |
| Email/SMS marketing vendor | Email/phone opt-in forms visible; provider not established | UNKNOWN |
| Shipping/label software | UPS options claimed in shipping policy; no shipping API verified | UNKNOWN |
| Inventory, ERP, suppliers, fulfillment contracts | No private access or verifiable integration evidence | UNKNOWN |
| Hosting, DB, queues, admin, fraud tooling | Not established by public audit | UNKNOWN |

**Architecture choice:** Do not migrate AltaPure to WordPress/WooCommerce merely because the competitor uses it. Existing Vercel + Supabase is an appropriate basis for a custom modular commerce system if built with proper state machines, access controls and operational tooling.

## Additional public workflows

- More navigation: Partner Program, Gift Cards, Track Your Order, Spin and Save.
- Partner area links to `/partner-dashboard` and `/partner-registration`; public terms advertise a 30-day attribution window, $100 payout minimum, 40% first-order commission and 10% on later orders. Do not adopt these rates without margin modeling.
- Product detail pages include variant selection, sale banners, research-use notice, purported purity and storage information, and card/wallet icons. Icons are not proof of accepted payment methods.
- COA listings expose report IDs, batch history, lab name, date, actual net-content and purity figures, external verification and download links. The site's current summary advertises 44 reports/24 compounds; do not interpret this as a verified claim that every saleable SKU has a corresponding valid lot-specific COA.
- Research Builder advertises 4 compounds, a 3-delivery initial period, 40% off, a bundled 3 mL solution and free 2-day shipping.
- Bulk page currently says 10 units per product for 50% off and 50 units for 60% off, strengths combined per product; a search title elsewhere uses 40%/50%. Promotional terms must be normalized to a single authoritative rules engine in AltaPure.
- Membership page advertises Free, VIP and Elite; benefits include 2.5x/5x/10x points, 5%/10% paid tier discounts, shipping, early access, and an Elite monthly store-credit benefit. The site has some inconsistent presentation of Free-tier perks between sections; do not replicate ambiguity.
- Track Order public form uses Order ID and billing email. This pattern needs rate limits, enumeration resistance, email normalization, and no cross-customer leakage in AltaPure.
- Marketing capture: first-order email discount, optional SMS opt-in with consent text, restock alerts and push notification invitation. Implement consent records, suppression, unsubscribe and regional rules before activating.
- Cart incentive progress meter and gifts at order thresholds. Add only after verifying real unit economics and availability.

## Not verified by this audit

No checkout was submitted. Therefore no processor, payment authorization, settlement, 3DS, tax/duty calculation, shipping quote, subscription renewal, referral payout, fraud handling, inventory reservation, fulfillment API or actual delivery was tested. The public site may describe capabilities that are unavailable or restricted in practice.

## Design requirements for AltaPure

- Preserve the current branded AltaPure look, navigation aesthetics, product images and admin design.
- Create original feature components, not a copied WordPress theme or competitor code.
- Build business rules and entitlement calculations server-side; never trust browser prices or membership status.
- Maintain separate status for *displayed*, *orderable*, *payment-eligible* and *shippable* products.
- Keep checkout paused until written SKU/country/provider authorizations and staging tests are complete.
- Do not advertise batch purity, sterility, same-day shipping, global shipping, free gifts or accepted payment rails without evidence and operational support.
