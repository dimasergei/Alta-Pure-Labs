# Stripe checkout retirement — handoff

## Intent

Stop all **new** Stripe Checkout Sessions while the merchant selects an appropriately underwritten processor. Retain the existing signed webhook and stored order metadata so completed Stripe transactions can still be reconciled, refunded or disputed correctly.

## Code-level changes

1. `api/checkout.js` responds 503 to all POST requests **before** reading credentials, creating orders, or creating Stripe sessions. Other methods receive 405. The stop has no environment-flag override.
2. `api/checkout-status.js` always returns `{ "enabled": false }`, with no-store headers. Stale checkout environment flags cannot reopen the browser checkout.
3. `checkout.js` already gates the client UI on the status API and shows a localized pause notice; it has not been changed in this release.
4. `api/stripe-webhook.js` is intentionally untouched to preserve historical signed payment-event processing and idempotency.

## Release acceptance checks

- The checkout-status endpoint returns `enabled:false` on the exact release commit.
- A POST to checkout returns 503 with no order record and no Stripe session; check the server logs and historical orders remain unchanged.
- The storefront cart visibly shows checkout unavailable in supported locales.
- Old, correctly signed webhook replay is processed once and does not create duplicate payment events.
- Admin order histories, existing refunds/disputes and customer notifications continue to work.
- Vercel Preview browser checks, tests, and release approval are recorded before production deployment.

## Before enabling a replacement

- Merchant provider and actual acquirer confirm in writing acceptance of all intended SKUs, jurisdictions, marketing claims, customer methods, reserves and refunds.
- Separate lawful shipping lane review identifies exact SKU, destination, origin/site and service, and carrier acceptance.
- Implement a separate provider adapter with signed event verification, replay/idempotency protection, immutable USD or contract-currency order totals, fraud controls and reconciliation.
- Enforce shipping/product/payment eligibility server-side *before* order creation/payment initiation; no client-only flag or broad worldwide default.
- Validate with sandbox credentials and non-production users, confirm rollback plan, then approve the exact production release.
- Keep historical Stripe webhook handling until all remaining obligations are closed.

No processor account or payment contract can be created by modifying the repository.
