# AltaPure Labs — Checkout & Cart Parity Refactor v2
**Status:** Specification / acceptance gate only. **Implementation:** Not yet authorized by this branch.  
**Date:** 2026-11-13 · **Production baseline:** \`2099485c8ccb23289ba473f41685c71628f72acd\` · **Production deployment:** \`dpl_nEPtRco6uCpi8wMBkRUPRGdgWB1z\`  
**Benchmark:** The user-provided November 13 screenshots of NeuroLabs (checkout and cart) against the same-day AltaPure screenshots. Use the screenshots solely as the layout/interaction reference. **Do not copy NeuroLabs marks, source, proprietary copy, or photographs.** Use AltaPure branding, legitimate payment-brand assets, original fulfillment claims and terms.

## 0. Goal and immutable constraints

Recreate the *visual geometry, styling discipline and interaction patterns* of the reference checkout while preserving AltaPure's own brand and real backend invariants. No fake wallet payment activation, no crypto-onramp masquerading as direct card acquiring, no invented carrier dates, no hidden paid products, and no automatic production deployment from this planning branch.

Do not change or test production orders, payment secrets, Supabase permissions, webhook verification, supplier batches, account authentication, or fulfillment state. Do not implement unnecessary third-party card/bank methods: user-selected payment scope is **Card, Apple Pay, Google Pay** only; display them as **pending activation** until the gateway explicitly reports actual authorization. Do not imply Visa/MC/Amex/Discover acceptance if merchant permissions are unverified. Avoid any payment tests using live charges.

## 1. Reference measurement protocol

1. Match viewport, zoom, DPR, state, contents, coupon, destination, shipping tier, options, and scroll position **before** judging visual parity. The screenshots are 2047 × 1331 pixels; do **not** treat those raw pixels as CSS pixels without checking DPR/zoom. Capture desktop at 1536×900 CSS pixels and DPR 1 or exactly match reference device metadata if available. Additional tests at 1280×800, 768×1024, 390×844, and 375×667.
2. Block application animations, network races, auto-refresh and external scripts via the isolated fixture. Use a deterministic clock and prices. Compare *matched content*, not screenshots with different products and shipping choices.
3. Important approximate measurements from the submitted full-resolution images (design-estimate, not programmatic CSS values):

| Feature | NeuroLabs image | AltaPure image | V2 target |
|---|---:|---:|---|
| Cart panel width | ~584 image px (28.5% of screenshot) | ~667 image px (32.6%) | 28–30% of desktop viewport, cap ~440 CSS px |
| Checkout overall width | ~1795 image px (87.7%) | ~1883 image px (92%) | 86–89% desktop viewport at equivalent zoom |
| Left form card | ~1158 image px | ~1200 image px | 63–66% of main grid width |
| Summary card | ~580 image px | ~625 image px | 31–34% of main grid width |
| Column gap | ~55–60 image px | ~55–60 image px | preserve relative gap; do not solve width by crushing gap |
| Footer anchoring | Fixed inside cart, product region scrolls | Entire cart scrolls | footer stays fixed, body scrolls independently |

These estimates must be replaced with computed element bounding boxes recorded during visual calibration. Goal: ≤8 CSS px deviation in major panel edges after matched viewport; ≤4 CSS px for repeated component spacing; avoid requiring pixel-perfect aliasing of fonts across OSes.

## 2. Required component structure

### CART DRAWER — highest-priority architectural change

\`dialog.cart\` must have exactly three independently managed regions:
- \`cart__header\`: fixed top, title and close control.
- \`cart__body\`: \`min-height:0; flex:1; overflow-y:auto;\`, product rows, free-item badge, quantities, removal, recommendations carousel; ONLY this region scrolls.
- \`cart__checkout\`: \`flex:none;\` anchored bottom: coupon details, *server-calculated* subtotal / discount / shipping estimate / add-ons / protection / total, checkout CTA, express-wallet controls, research terms. Footer visually separated with subtle top divider/shadow. At mobile <700px height, cap footer height and allow its **own** inner scrolling without covering items.

Cart must be ~440 CSS px at a 1536px desktop viewport (allow 420–450 after calibration); rows compact (~12–14px label font, ~8–12px gaps); recommendation cards compact and navigable; coupon expandable without shifting pinned footer out of view. Fix price duplication from legacy \`ConversionUI.cart\`. One cart renderer and one authoritative quote source.

### CHECKOUT — three steps + persistent summary

\`CheckoutLayout\` > \`Stepper\` + \`CheckoutSteps\` + \`OrderSummary\`; progressive shipping → delivery → payment. Existing login requirement is preserved; do not collect raw card data into AltaPure inputs. At desktop use a compact container about 88% of viewport with constrained left/right grid, not full-bleed.

- **Shipping step:** name, phone, international country dropdown, address, postal code, optional SMS opt-in, billing same/different, recommended products with working add buttons, next. Continue is white-on-black (or accessible dark-CTA equivalent), **never dark-on-dark**.
- **Delivery step:** delivery selection, clear price, cutoff and arrival estimate *only if supported by carrier/dispatch ETA source*; extra services in colored cards: Priority Processing + Cold Chain initially unchecked. Both Read more links become accessible **inline disclosures** with no \`alert()\` or page navigation. Membership offer retains selection and cart; monthly/yearly price and current-cart savings must be computed, not fabricated.
- **Payment step:** structured contact / shipping / delivery recap with edit buttons; express-wallet area; separate card area; official brand assets; short contextual RUO text with real policy links; two required distinct research-use acknowledgment checkboxes; single canonical provider-owned Place Order action displaying verified final amount. No fake payment controls, duplicate charge buttons or crypto-onramp flow.
- **Order summary:** persistent desktop panel with item thumbnails, free-item badges where eligible, quantities and removal, coupon, discounts, individual shipping extras, total and earned points; correct approved sparkle icon. \`Earn more\` links to \`/memberships\`, not \`/account/points\`. On mobile the summary remains accessible without blocking checkout.

### DISCLUSURES / ICONS / LOGOS

- Shipping Protection occupies the top summary row with **a shield-check icon** and small lock icon if applicable; do not use U+2662 diamond placeholder. It is preselected only where permitted, clearly deselectable and never assumed across unrelated orders.
- Protection \`Read more\`: inline accordion directly beneath the protection title; preserve full seller-backed terms and link to detailed policy *within* the expanded copy only, if desired. Priority and Cold Chain use the same accessible accordion pattern.
- Each disclosure has \`button type=button\`, \`aria-expanded\`, \`aria-controls\`, keyboard activation, focus visibility, and does not unexpectedly change fees.
- Replace manually styled \`VISA\`, \`●●\`, \`AMERICAN EXPRESS\` and custom letter-G approximations with authentic assets or **provider-rendered** supported marks; correct dimensions, accessible names, transparent background where authorized. Do not expose unsupported card networks as accepted; visually label unavailable methods **Pending activation**.
- Font: establish **one** checkout type scale based on computed reference styles; avoid mixing unloaded Plus Jakarta Sans with Poppins fallback. Match weights, line heights and spacing under one token system. Do not copy NeuroLabs' business mark.

## 3. Proposed design tokens (initial calibration targets)

| Token | Target before visual calibration | Acceptance |
|---|---|---|
| \`--checkout-font\` | Poppins or verified reference-like geometric sans | font must actually load; consistent family across all sections |
| \`--checkout-surface\` | white \`#FFF\` | compact light interface |
| \`--checkout-ink\` | near-black \`#101720\` | text contrast ≥4.5:1 |
| \`--checkout-navy\` | deep navy \`#164B97\` | primary brand / selected controls |
| \`--checkout-muted\` | \`#6E8199\` approx | secondary text readable ≥4.5:1 for normal text |
| \`--checkout-border\` | \`#DCE5EF\` approx | subtle but apparent |
| \`--checkout-priority-surface\` | pale red \`#FFEDEE\` | red-border priority card |
| \`--checkout-cold-surface\` | pale blue \`#E8F5FF\` | blue-border cold-chain card |
| \`--radius-panel\` | 17–22 px | consistent main cards |
| \`--radius-row\` | 11–14 px | shipping method/add-ons |
| \`--radius-cta\` | 999 px | fully rounded button |
| \`--space-1 … 8\` | 4, 6, 8, 12, 16, 20, 24, 32 px | no ad hoc 19/27/35px proliferation |
| Desktop panel gap | 28–42 CSS px | measured reference match |
| Main section type | h1 30–38, h2 18–22, base 12–14 CSS px | confirm against actual computed reference, not guesses |
| CTA minimum contrast | white \`#FFF\` on \`#08090C\` | meets WCAG AA; verify COMPUTED style after all CSS loads |

These are *starting targets*, not a claim about hidden NeuroLabs CSS.

## 4. Functional contracts and source bugs

| ID | Current confirmed issue | Required behavior | Verification |
|---|---|---|---|
| F01 | Cart \`#ap-cart-content\` uses one scrolling region | Product section scrolls; footer pinned and visible | scroll upper region >150px, footer Y ≤3px drift |
| F02 | Footer and cards too wide | 28–30% screen drawer at desktop | geometry |
| F03 | Checkout visual width ~92% screenshot | 86–89% screen main content | geometry |
| F04 | \`nlx-primary\` black fill but visibly dark text | computed text must be white / ≥4.5 contrast | computedStyle + contrast test |
| F05 | Membership uses \`/checkout?plan=vip\` and recursive \`window.DirectCheckout.checkout\` override | Working membership action; selected period preserved; return-to-cart intact | navigation and no infinite recursion |
| F06 | Protection diamond \`♢\` and external Read more | approved shield, inline accordion, no navigation | click + aria + same URL |
| F07 | Priority/Cold Read more invokes \`window.alert\` | inline disclosure, text appears beneath row | click + aria |
| F08 | Points uses \`✧\` and links to \`/account/points\` | approved sparkles icon; links to \`/memberships\` | DOM + navigation |
| F09 | Pay logos synthesized by HTML text | genuine assets/provider rendering | accessible icon sources; no unicode stand-ins |
| F10 | Wallet placeholders hard-disabled | when approved, one real tokenization component; otherwise labeled unavailable | mocked disabled/enabled gating |
| F11 | Old add-ons persisted in \`localStorage\` across orders | new checkout starts with Priority/Cold unchecked; protection only when permitted | fresh-session / new-order test |
| F12 | No ETA/countdown | carrier-backed ETA & cutoff; no invented precision | fake-time boundary + provider result test |
| F13 | Product rows lack \`+1 FREE\` in checkout | badges only for backend-confirmed promo entitlement | server-discount fixture |
| F14 | Generic points bubble | actual server points + sparkle + link membership | fee and rewards fixture |
| F15 | No compact shipping-step cross-sell | add-on suggestions; adding updates totals without duplicate line | cart and quote test |
| F16 | Different checkout and cart totals possible | identical authoritative server quote for same draft | integration test |
| F17 | Conflicting or unbounded CSS overrides | component namespace + token stylesheet, no conflicting global button color | computed style across pages |
| F18 | Full-site visual parity not tested on mobile | no clipped controls, usable footer | 375/390 and 768 screenshots |

### Fulfillment estimate / countdown source of truth

No live UPS rate or transit-time API is currently verified. Implement a behind-feature-flag \`DeliveryEstimate\` contract:
\`{ service, country, postalCode, rateCents, rateCurrency, cutoffAtISO, estimatedFromISO, estimatedToISO, timezone, confidence, source }\`.
If \`cutoffAtISO\` or dates are missing, show **"Estimated at dispatch"**, not a fake "Arrives Monday" or fabricated remaining minutes. Simulated countdown tests use a fixed reference clock, including time zone, weekend and cutoff rollover. The current flat rates may still be used but must not be called quoted UPS rates unless verified.

### Membership and terms

Membership route must not recurse to the same overridden \`checkout\` function. Preserve original membership handler or use real membership route + price ID, correct monthly/annual selection and clear return to checkout. Explicit subscription billing/terms cannot be hidden behind the standard one-time order. Benefits, immediate savings and percent-off claims must be calculated with real membership logic.

### Legal/claims hygiene

Do not copy competitor's exact legal text or checkout supplier guarantees. Keep AltaPure's own RUO compliance copy, jurisdictional shipping/claims policy, refund policies, age gate and required acknowledgments. Prefer shorter plain-language text and accessible links rather than duplicated legal paragraphs. Never suppress payer/bank mandated authentication or disclosures.

## 5. Screenshot and accessibility acceptance

### Screenshot states

Capture **all** of these with the deterministic fixture, fixed fonts and loaded assets:
1. Desktop (1536×900) cart open, 2 products + promotions, at top.
2. Desktop cart after 250px scroll inside product section; footer remains same position.
3. Desktop cart coupon expanded; footer remains visible.
4. Desktop checkout shipping, valid prefilled US details.
5. Desktop delivery, standard service, Priority/Cold OFF, Protection ON; no invented arrival date.
6. Desktop delivery with each inline disclosure open, with one then both extras selected.
7. Desktop payment, no active NMI; wallet buttons clearly pending and Place Order blocked.
8. Desktop payment, simulated approved NMI: provider wallet/card component and single action, no live transaction.
9. Desktop summary with validated BOGO promo label and points link.
10. Mobile 390×844 cart; products scroll, footer works without trapping focus.
11. Mobile 390×844 three checkout steps; zero horizontal overflow.
12. Tablet 768×1024 summary stacking/behavior.
13. Desktop membership selection monthly/annual with functional navigation.
14. Desktop and mobile overflow when extra-long product/country labels exist.

### Automated tests & release gates

- See \`tests/checkout-parity/\` for **opt-in** tests, purposely not in the default \`npm test\` glob; existing page is expected to fail some v2 requirements.
- A screenshot test generates fixture screenshots and checks DOM geometry. A separate visual review compares those artifacts to *anonymized* user-provided references at matched viewport. Do not commit raw customer addresses, emails, order IDs, personal screenshots, or competitor artwork into a public repo.
- Functional tests: quote changes, accessibility (ARIA/keyboard), deterministic ETA, enabled wallet gating, no provider credentials in browser, no duplicate orders, no obsolete cart takeover, membership navigation and true protection default.
- Build/test gate: \`npm test\`, \`npm run build\`, \`npm run test:account-dom\`, visual parity tests, desktop/tablet/mobile captures, static safety checks.
- Deployment gate: separate refactor branch → isolated preview with mocked payment & authenticated fixture → visual approval → user-authorized production deploy → read-only smoke check. Preserve prior deployment for rollback.
- No edits to Supabase tables, processing methods or production credentials within the styling refactor. Any feature needing DB/schema/carrier API is a separate, explicitly reviewed change.

## 6. Work packages, in order

**P0 / Release blockers:** cart sticky structure; black-button contrast; membership recursion; all three Read more accordions; native payment marks; unintended paid extra defaults; points link; no fake acceptance.

**P1 / Visual parity:** measured compact layout, CSS tokens/fonts, order summary, BOGO quantity/free-badge logic, shipping label layout, membership savings card, checkout cross-sell and mobile breakpoints.

**P2 / External dependencies:** provider-backed arrival dates and countdowns, real Apple/Google Pay acquiring integration. Do not block honest non-payment preview UX on external approval; never pretend these dependencies are done.

## 7. Definition of done

- Every P0 contract passes with browser-level evidence.
- Every P1 screenshot state is captured at defined viewport, no unreviewed text/logos, panel edges within approved tolerance; reference comparison explicitly approved.
- All shipping add-ons are reversible and server authoritative; card/wallet availability truthful; shipping date certainty correctly labeled.
- All user-facing links, membership route, disclosure controls and edit buttons genuinely work.
- No accidental changes to orders, batches, notifications, payments, authentication or existing terms. Production deploy requires a separate approval after preview checks.

**Intended next implementation:** create a fresh code branch from \`2099485c\`, implement P0 cart + checkout contracts first, validate, then advance to typography/pixel parity. This document alone is not a production release.
