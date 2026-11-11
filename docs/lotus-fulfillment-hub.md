# Lotus and manual fulfillment hub

The admin entry point remains `/admin-orders.html`. Checkout orders, supplier allocations, exceptions and shipment updates appear above the preserved historical order tools. Overview and Inventory links were removed. Lotus catalog tools and the payment/refund desk open within the dashboard with its authenticated session.

Paid goods orders receive an allocation for every exact variant, including promotion/free units. Verified US mappings route to Lotus; other lines are manual. An immutable payload and stable reference are persisted before the external order is created. Existing historical paid orders are not automatically backfilled or purchased.

Manual suppliers may be named per allocation. Record supplier ordering, dispatch and delivery with an audit note. Separate tracking numbers are retained. The customer account shows each dispatched allocation. The overall order becomes shipped only after every allocation ships, and delivered only after every allocation is delivered. Browser roles cannot read or modify allocations directly.

Before Lotus submission, reassign a line to another supplier. After submission (including uncertain outcomes), use **Cancel Lotus & switch to manual**. This cancels the whole Lotus portion and waits for confirmed cancellation before releasing its allocations. If Lotus has already settled/shipped or rejects cancellation, the exception remains blocked for reconciliation; never place a duplicate replacement. A blocked job can be explicitly retried without changing its reference or retained payload. A price-changed retained payload remains blocked until reconciled; retrying does not silently approve a new quote.

The dashboard accepts purchased Pirate Ship label share links and USPS/UPS tracking. Attaching a label is not proof of dispatch. Supplier settlement and purchasing postage remain manual external steps; the API has no settlement endpoint. Polling uses the signed worker on the existing ten-minute scheduler. One job is processed per invocation; a submitted job becomes due again after fifteen minutes. Owner may also process a queued job from the Lotus tab. No live shipment or settlement is fabricated by this release.

## Mapping evidence — 2026-11-11

Provider source: https://lotuspeptide.com/live-prices plus authenticated `/products` catalog. The public list expands Reta → Retatrutide, Tirz → Tirzepatide, MT2 → Melanotan II. These exact strengths use single-vial packs:

| Alta variant | Lotus ID |
|---|---:|
| retatrutide\|10mg | 7 |
| retatrutide\|15mg | 8 |
| retatrutide\|20mg | 9 |
| retatrutide\|30mg | 10 |
| tirzepatide\|10mg | 11 |
| tirzepatide\|20mg | 12 |
| tirzepatide\|30mg | 13 |
| melanotan-ii\|10mg | 20 |
| glow\|70mg | 26 |
| klow\|80mg | 25 |

GLOW composition confirmed at https://lotuspeptide.com/peptide/glow-blend: GHK-Cu 50mg + BPC-157 10mg + TB-500 10mg. KLOW https://lotuspeptide.com/peptide/klow-blend adds KPV 10mg. Added to the existing 21 mappings: **31 of 84 Alta variants**. This is mapping coverage, not stock availability or COA verification.

Unmapped: BPC/TB 10mg/10mg. Lotus's 20mg blend has no confirmed per-component ratio: https://lotuspeptide.com/peptide/bpc-157-tb500-blend?strength=20mg explicitly defers the split to the lot COA. Do not infer 10+10. Other strength differences, pens versus vials, and absent compounds are not substitutions. All remaining variants stay available for manual supplier routing.
