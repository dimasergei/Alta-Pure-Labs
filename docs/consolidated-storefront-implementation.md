# AltaPure Labs — one consolidated storefront implementation

## Goal
Preserve AltaPure's forest-green/cream visual identity while delivering the connected navigation and customer workflows benchmarked against neurolabsresearch.com. This is one implementation/release, not a new sequence of incremental backend phases.

## Delivered scope
- Rebuilt homepage, sticky multi-level navigation, accessible category mega-menu, global search, responsive mobile menu, consistent footer.
- Dedicated catalog and product detail routes, dosage-specific images, search/category/price filters, sorting, quick-add, local saved items, product comparison.
- Shared persistent cart across product pages, builder, bulk ordering, and account navigation; catalog prices stay authoritative and unchanged.
- Four-compound research builder, repeat-cadence planning, local drafts, optional authenticated account save, CSV export, and cart transfer.
- Bulk quantity matrix by exact product/size, totals from the real catalog, CSV export, cart transfer, and quote inquiry form.
- Membership comparison and interest submission, rewards/store-credit activity areas, partner inquiry, offers/configuration surfaces. No invented prices, balances, discounts, or paid enrollments.
- Searchable COA library with verified-only metadata, product linkage, and truthful empty states.
- About, contact, FAQ, tracking entry point, and unified /my-account navigation.
- Inquiry delivery through the existing notification service; no new Vercel function slot. Existing customer configuration GET contract preserved.
- Desktop/mobile browser regression checks, screenshots, build and existing CI.

## Operational distinctions
The interface is implemented independently of payment activation. Checkout stays paused as already requested. A saved research plan is not a billed subscription. An interest request is not paid membership or affiliate approval. No supplier report is published as verified without actual evidence. Promotions and financial balances are rendered only from explicitly configured data; empty states never masquerade as earned balances.

## Preservation
Do not modify products.js prices/descriptions, Stripe historical webhook logic, supplier batch behavior, existing authentication checks, secrets, database grants, or production data during visual testing. All browser/test fixtures are isolated. Test email delivery only with mocked transport unless separately authorized.
