# AltaPure Labs: TEST checkout integration overlay

This is an overlay, not your complete website. Keep all existing source files and assets.
No credentials are included. Not deployed or end-to-end tested against your accounts.

## Install
1. Back up your GitHub repository or use a new branch.
2. Copy the ZIP contents to the repository root (same level as index.html). Preserve api/, lib/ and supabase/ directories. If package.json or vercel.json now exists, merge instead of overwriting it.
3. In Supabase SQL Editor run supabase/payment-webhook.sql after your original tables exist.
4. In Vercel set Framework Preset to Other, Build Command to npm run build, Output Directory to . (dot), and use the repository root. Install command: npm install. Node 22 is recommended.
5. Commit/push the overlay. Check the Vercel deployment build logs. The build script generates lib/catalog.json from your unchanged products.js and adds checkout.js to index.html. Existing catalog hash tests remain applicable.
6. In the SAME Stripe test mode/sandbox as your test API key, add a snapshot webhook endpoint:
   https://altapurelabs.vercel.app/api/stripe-webhook
   Events: checkout.session.completed, checkout.session.async_payment_succeeded, checkout.session.async_payment_failed, checkout.session.expired.
   Choose API version 2025-03-31.basil if offered. The handler retrieves sessions with this pinned version.
7. Copy this endpoint's whsec_ signing secret into Vercel STRIPE_WEBHOOK_SECRET (Secret), then redeploy.
8. Ensure SITE_URL is https://altapurelabs.vercel.app, SHIPPING_FLAT_RATE_CENTS=2500 and LIVE_CHECKOUT_ENABLED=false. Use only a sk_test_ Stripe key. Live keys are hard-rejected regardless of the LIVE_CHECKOUT_ENABLED setting.

## Test
- Add one product and complete the required name/email/organization/research form.
- Stripe must show USD, the correct variant price, and $25 shipping. US shipping addresses only; no state exclusion is configured.
- Test card: 4242 4242 4242 4242, future expiry, any three-digit CVC; never use real card data.
- Stripe webhook delivery should show HTTP 200.
- Supabase store_orders must show paid, correct amounts and shipping_address; store_order_items must match the cart.
- Resend the same Stripe event: no duplicate order/payment-event processing.
- Cancel checkout: cart remains. This test build intentionally retains the cart even after successful payment to avoid deleting unrelated changes from another tab. Clear it manually before another test.
- A success redirect alone does not mark an order paid. Status is read from the database without exposing email/address.
- Test an Alaska and Hawaii address. Territory and military-address exclusions are not implemented; US country selection is not a strict 50-state-only validator.

## What is NOT production-ready
- All payments are TEST ONLY. This package cannot enable live checkout by changing an environment variable.
- No tax calculation: tax remains zero for testing; this is not a determination of tax obligations.
- No inventory reservation/stock enforcement, refund/dispute reconciliation, email delivery, customer login, automatic shipping labels, warehouse integration or dedicated admin dashboard.
- No verified institutional-buyer approval controls. Obtain processor approval for the actual research-peptide catalog and implement required controls before any live launch. A checkbox is not business approval.
- No distributed rate limiter/CAPTCHA; same-origin checks are not bot protection. Add abuse controls before public production checkout.
- Duplicate webhook delivery is transactionally deduplicated, but starting a fresh checkout creates a fresh pending order. Repeated clicks after network failures can leave abandoned pending orders; the UI blocks concurrent submits but cross-request checkout deduplication is not implemented.
- Failures during order/session creation can leave pending orders. Reconcile or expire abandoned records; do not treat pending as paid.
- Use Supabase dashboard to inspect paid orders. Manual fulfillment: set processing, then shipped plus tracking_carrier/tracking_number/shipped_at only after physically shipping. Never ship a test order.
- Keep legal shipping eligibility, product authorization, privacy, returns and terms review separate from technical completion.

## Architecture decision
Both server endpoints run on Vercel. Supabase stores orders and transactionally applies verified webhook updates. There is no Supabase Edge Function to deploy, avoiding a second backend runtime.

## Troubleshooting
- 500 at checkout: inspect Vercel function logs, environment variables, catalog generation and Supabase grants.
- Webhook 400: verify the SAME test account/sandbox, endpoint-specific signing secret, redeployment, and raw request-body handling.
- Webhook 500: check SQL function exists, amount checks, shipping details and Supabase connection. Stripe should retry after fixing the error.
- Use Stripe snapshot events, not thin-event destinations.
- Do not add SPA catch-all rewrites that route /api/* to index.html.
