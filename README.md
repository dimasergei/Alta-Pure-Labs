# AltaPure Labs — Storefront and operations

## Current checkout status (November 2026)

**New online payments are paused while a replacement merchant processor is underwritten.**
The legacy `/api/checkout` responds with HTTP 503 for all POST requests, and `/api/checkout-status` reports `{ "enabled": false }` even if an old `CHECKOUT_ENABLED=true` environment variable remains. The browser presents a paused-checkout notice.

The existing signed `/api/stripe-webhook` handler is **retained for reconciliation and existing payment obligations**. Do not delete its credential or disable the endpoint until historical Stripe events, refunds, disputes and settlement obligations are accounted for. The old checkout implementation is preserved in Git history; it should not be restored to accept new transactions.

Payment activation requires a provider and acquiring-bank approval for the *actual catalog*, plus approved product/destination shipping lanes, signed webhooks, idempotent order handling, and sandbox checkout tests. See [payment provider underwriting](compliance/payment-provider-underwriting-matrix.md) and [commerce integration plan](docs/commerce-eligibility-integration-plan.md).

## What exists in the repository

- Catalog and product dosage variants: `products.js`, `product-images.js`
- Currency display and English/French/Spanish controls: `locale.js` (USD checkout remains the historical settlement currency; converted catalog amounts are estimates)
- Customer accounts and Google OAuth: `account.html`, `account.js`
- Admin orders, suppliers, batches, notifications, and inventory tools: `admin-*.html`, `api/admin-*.js`
- COA library and pending/withdrawn review logic: `coas.html`, `lib/coa-*.js`; no COAs are published as verified in `data/verified-coas.json`
- Default-deny shipping and payment decision prototypes: `lib/commerce-eligibility.js`. **Not integrated into live checkout.**
- Country, product, origin, service and underwriting diligence templates under `compliance/`

These components do not establish legal product authorization, customer payment approval, COA authenticity or international shipping eligibility.

## Build and test

```sh
npm install
npm run build
node --test tests/*.test.cjs
```

The `build-test.yml` GitHub Actions workflow additionally runs disposable PostgreSQL tests and a Python exporter integration suite. Do not run fixture scripts against production databases.

## Deployment and security

`vercel.json` currently has Git deployments disabled. Before any production change, verify the exact project/commit, CI and isolated browser checks, product eligibility and merchant approval, and get the appropriate release authorization. Do not weaken Vercel deployment protection or expose server-side Supabase/Stripe credentials.

For the operational cutover checklist see [Stripe retirement handoff](docs/stripe-retirement-handoff.md).
