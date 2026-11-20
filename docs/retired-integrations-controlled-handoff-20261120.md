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
- Developer **confirmed**: `main.belkdigital@gmail.com` accepted Vercel team member role `MEMBER`; GitHub account `belk-digital` has `write` collaborator permissions.
- Domain `getpureskin.co` registered to the Vercel team, registrar verification **confirmed**; auto-renew off. It has **zero** project-domain attachments: do not change existing production domain routing without separate cutover planning.
- Vercel CLI environment pull generated `.env.local`, but 25 protected secrets were replaced with `[SENSITIVE]`; use Vercel team access for hosted execution and provider-issued scoped development credentials when local execution requires keys. Do not email or commit a populated file. A safe `.env.example` is included in this branch, with retired providers omitted.
- `.gitignore` now protects `.env`, `.env.*`, and `.vercel/` from accidental commit.
- Deletion CLI is in `scripts/retire-vercel-env-safe.sh` and defaults to `--dry-run`. It enforces exact Vercel team/project matching, disabled retired flags, active-key presence, and a typed confirmation for `--apply`. **Only run after CI and release checks pass.**

**State of this branch:** audited, safe template + Git ignore protections, isolation regression tests, and a guarded dry-run retirement script are committed in draft PR #112. No production env deletion, production deploy, domain rerouting, payment code activation, or DB mutation has occurred.

## New Stripe account — live charges enabled; NOT connected to PURE checkout
- **Old Stripe account (closed):** `acct_1K7VwMFgmwsD5cg2`. Closure notice confirmed its API keys were expired; do not repurpose old production credentials.
- **Replacement Stripe account:** `acct_1UcAGhHgf0oCHlRb`, business **1001517614 ONTARIO INC.** **Verified directly via Stripe live account API on 2026-11-20:** `charges_enabled=true`, `payouts_enabled=true`, `details_submitted=true`, `card_payments=active`. Stripe account requirements still list `person_1UcAR8Hgf0oCHlRbiLHybhWV.verification.document_live_capture` as `currently_due`, `past_due`, and `eventually_due`; the account has `disabled_reason=null`. Identity-document verification must be completed by the account owner. This API result establishes technical capability but does **not** establish Stripe approval of PURE's actual product catalog or lawful sales jurisdictions.
- Do not route card payments, replace `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`, or change the live merchant-of-record until the account owner completes the outstanding identity verification, confirms Stripe permits the actual product catalog and jurisdictions, and the new integration has passed isolated checkout/webhook tests.
- Existing current card-to-crypto payments are handled by Rampex, including a `rampex_provider='stripe'` setting. This is **not** the new merchant-direct Stripe account.
- Plan any new direct Stripe checkout behind a dedicated, disabled adapter and separate test credentials and webhook, with dedicated idempotency and reconciliation tests. Keep legacy event handling independent until closed obligations have been reconciled.

## Four-item handoff status
1. **Domain** — registered, verified; Vercel team owns it, developer is a member of the team. No live DNS cutover.
2. **GitHub** — developer `belk-digital` has verified write collaborator access to `dimasergei/PURE`.
3. **.env** — safe template tracked. Owner's production pull exists locally but has 25 sensitive placeholders; complete export is not available through Vercel CLI. Developer can use hosted Vercel env and scoped provider credentials.
4. **Hosting** — developer email confirmed member of Vercel team `dimasergeis-projects`, project `pure`.

## Cleanup release status
- Checkout, auth, admin, order, bank/Interac, direct USDC, Rampex, notifications, marketing, and shipping source code **unchanged**.
- Retired configuration remains on Vercel until verified CI/preview and explicit execution of guarded script; do not claim removed until verified.
- For testing and review, use draft PR `https://github.com/dimasergei/PURE/pull/112` (base = current production branch, NOT default `main`).

## Verified latest audit (2026-11-20)
- Stripe live API independently confirms the replacement account can currently accept charges and payouts, subject to outstanding identity-document verification; it is **not** yet integrated into PURE checkout.
- GitHub `dimasergei/pure-gateway` exists as a private, empty repository and `belk-digital` has verified `write` permission.
- Vercel still reports 13 retired Lotus/PeptidePay/Tagada environment entries, plus the legacy `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`. They are **not removed**; changing/deleting old Stripe keys before historical webhook reconciliation could break production.
- CI on commit `0a76cc01ff4e6ec156f38a98920f3f18275c882e`: 5 targeted workflows green, full build-and-test workflow red (984 pass, 77 fail, 1 skip). Do not merge/deploy based on partial green checks.
- Current production remains `4bd6cbd845c963c337d0641a9068ec7f6fb4e3d1` / deployment `dpl_DGggAwMwiwgHV77t9Tb4qkjoqGwb` READY. This audit did not mutate production.
