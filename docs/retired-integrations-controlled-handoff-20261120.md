# PURE retired integrations — controlled handoff (2026-11-20)

## Production baseline
- Vercel project: `dimasergeis-projects/pure`.
- Verified production deployment: `dpl_DGggAwMwiwgHV77t9Tb4qkjoqGwb`.
- Source commit: `4bd6cbd845c963c337d0641a9068ec7f6fb4e3d1` from `feature/pure-dark-uppercase-coas-partner-20261120`.
- This audit branch was created **from that exact production commit**, not from default `main`.
- No production deployment, production variable, payment record, or database schema change is authorized by this document.

## Protect / retain
- **Rampex**: `RAMPEX_API_KEY`, `RAMPEX_WEBHOOK_SECRET`, `RAMPEX_ENABLED`. Live DB contains two active Rampex methods (hosted and stripe rails); this Stripe-named *Rampex rail* is not the legacy Stripe API integration.
- **PURE Crypto**: `POLYGON_USDC_ENABLED`, `POLYGON_USDC_RECIPIENT`, `POLYGON_USDC_RPC_URL`, `POLYGON_USDC_SECONDARY_RPC_URL`. Live DB contains active Polygon USDC method and prior attempt.
- **Interac**: live DB has an active Interac method. Production `lib/direct-checkout.js` implements CAD Interac FX and separate checkout handling.
- **Bank transfer**: live DB has an active bank transfer method. Preserve pricing, checkout, manual receipt, and discounts.
- Keep Supabase, Resend, Shippo, Instagram/Meta, admin auth, order notification, checkout security, membership, affiliate, rewards, and all other unrelated configuration unchanged.

## Retired providers
- **Lotus**: `LOTUS_FULFILLMENT_ENABLED` currently false, supplier settings disabled, no supplier jobs. Remove `LOTUS_PARTNER_API_KEY` (production and branch-specific preview) and `LOTUS_FULFILLMENT_ENABLED` only after removing code paths from `lib/manual-commerce-integrated.js`, `lib/lotus-fulfillment.js`, `lib/lotus-admin.js` and verifying admin routes remain functional. Do not erase historical supplier data.
- **PeptidePay**: `PEPTIDEPAY_API_KEY`, `PEPTIDEPAY_WEBHOOK_SECRET`, `PEPTIDEPAY_WALLET_ADDRESS`, `PEPTIDEPAY_CURRENCIES`, `PEPTIDEPAY_MODE`, `PEPTIDEPAY_ENABLED`, `PEPTIDEPAY_VERIFIED`; enabled flag currently false. Live DB has no PeptidePay methods or attempts. Remove references in `lib/gateway-config.js`, `lib/native-gateway.js`, and related tests/UI, while preserving Rampex and Polygon USDC paths.
- **Tagada**: `TAGADA_API_KEY`, `TAGADA_STORE_ID`, `TAGADA_ENABLED`; enabled flag currently false. No matching provider appears in active live DB payment methods. Check remaining repository files and integrations before removing.
- The above comprises 13 Vercel variable entries including the preview Lotus key. **Do not delete these in production before a verified code cutover.**

## Stripe — separate workstream
- `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` belong to the deleted legacy Stripe account; user has a different new account.
- The production `api/stripe-webhook.js` still uses both the legacy Stripe SDK and webhook secret for historical event reconciliation. `lib/backend.js` enforces Stripe key mode based on `LIVE_CHECKOUT_ENABLED`.
- Do not substitute a new Stripe account's keys into legacy environment variables until historical events, webhook endpoint, product eligibility, and payment flow have been explicitly reconciled and tested.
- A `rampex_provider='stripe'` method in the database refers to a **Rampex payment rail**, not necessarily the site's legacy Stripe account.

## Required verification before any production cutover
1. Run all relevant existing automated tests on the exact production baseline, then on isolated changes.
2. Verify checkout options and quote/order creation for Rampex, Polygon USDC, Interac, and bank transfer; check webhook signature validation, idempotency, pending-payment cancellation, and manual receipt reconciliation.
3. Verify Supabase sign-in, memberships, orders/admin, notifications via Resend, Shippo shipping, Instagram marketing, affiliate/rewards, and product/COA pages.
4. Preview deploy from this branch **without assigning production domains**, confirm no regressions and no retired provider options visible.
5. Back up non-secret environment key names and relevant settings. Preserve secrets in Vercel; do not commit `.env.local`.
6. After a successful controlled release, delete only the listed retired variables in their precise environments and verify a subsequent deployment.
7. Never deploy the default `main` branch as a shortcut; it may differ from production.

## Developer handoff
- GitHub: `https://github.com/dimasergei/PURE` (repository was renamed from Alta-Pure-Labs).
- Vercel: `https://vercel.com/dimasergeis-projects/pure`.
- Developer intended email: `main.belkdigital@gmail.com`.
- Domain `getpureskin.co` registered, auto-renew off; domain routing not changed by this audit.
- Vercel CLI environment pull generated `.env.local`, but 25 protected secrets were replaced with `[SENSITIVE]`; use scoped project access or provider-issued development keys, not a committed or emailed production secret file.

**State of this branch:** audit and handoff documentation only. No production changes or retired integration code removal yet.
