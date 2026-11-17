# PURE admin and payments operations

This release uses one shared admin session, hosted Rampex Card checkout, and direct native USDC on Polygon. New checkout is `checkout-2026-11-v6`; the payment policy is `pure-payments-2026-11-v1`. Historical payment routes and receipts remain available for reconciliation.

## Admin sign-in

Open `/admin-orders.html` or `/admin-marketing.html` and request a sign-in link. Delivery goes only to the server-configured owner inbox; the browser cannot select another recipient. A link expires after ten minutes and is consumed once, after an explicit sign-in click. Its proof is removed from the browser URL before exchange.

The resulting seven-day session uses a secure, HTTP-only, same-site cookie shared by the admin workspaces. Mutating requests also require the session's CSRF proof and a permitted origin. Signing out revokes the session and synchronizes the interface across tabs. Neither an unprotected admin page nor a public order API replaces authentication.

Required existing configuration: `ADMIN_ORDER_EMAIL`, `RESEND_API_KEY`, `ORDER_CONFIRMATION_FROM`, and `SITE_URL`. `ADMIN_AUTH_SIGNING_SECRET` is the preferred signing key; the existing `ADMIN_ORDERS_PASSWORD` is the compatibility fallback. Do not delete or rotate that fallback without first configuring the intended signing key and planning session invalidation. Valid legacy header clients remain supported, and an already-authorized browser can exchange its old stored credential for a session without displaying a password form.

For failed sign-in, inspect the redacted response from `/api/customer-config?admin_auth=session`, email delivery status, and the private admin session tables. Do not log or paste sign-in links, cookies, CSRF proofs, or credential values. Requesting a new email link sends a real email.

Implementation: [server authentication](../lib/admin-auth.js), [browser session handling](../admin-auth.js), and [storage migration](../supabase/migrations/20261117192716_pure_passwordless_admin_sessions.sql).

## Payment choices and pricing

| Choice | Behavior |
| --- | --- |
| Card | Existing Rampex **hosted** route, USD goods, US/Canada destinations. The provider presents eligible payment rails and its final fees, conversion rate, and charge before payment. |
| Crypto | Native USDC on Polygon sent directly to the configured receiving wallet through an exact order authorization. Initially requires a compatible externally owned wallet/browser extension and POL for gas. |

Apple Pay and Google Pay are conditional choices inside the hosted provider flow. Country, device, provider availability, minimum amount, and verification requirements may affect them. Do not advertise guaranteed wallet availability, no fees, or an exact final card charge equal to the merchandise invoice. A return URL or a customer-supplied transaction hash is never payment confirmation.

Crypto receives 5% off merchandise. An entered valid `BLACKFRIDAY15` coupon receives the better 15% discount instead; they do not stack. Shipping, tax, and protection are excluded. The automatic Crypto discount is suppressed if the selected account redemption would fully cover the Crypto-discounted total; a valid coupon still applies to balance-funded orders. Partial account redemption can retain the 5% discount when Crypto remains due. Public cart previews show regular/coupon pricing until an authenticated customer explicitly selects an eligible Crypto method.

Source and SQL independently enforce the same totals, including cent allocation, discounts, delivery, balances, method version, and destination. Do not manually alter an order total after creating a payment authorization.

## Direct USDC configuration

| Environment key | Requirement |
| --- | --- |
| `POLYGON_USDC_RECIPIENT` | Previously verified owner-authorized receiving wallet. The value is deliberately omitted here. No private key or seed phrase is required. |
| `POLYGON_USDC_ENABLED` | Explicit switch controlling creation of new wallet payments. |
| `POLYGON_USDC_RPC_URL` | Primary HTTPS Polygon JSON-RPC endpoint supporting token reads, historical logs, receipts, and finalized blocks. |
| `POLYGON_USDC_SECONDARY_RPC_URL` | Required independent HTTPS endpoint on a different hostname, with the same capabilities. |

The pinned network is Polygon, chain ID **137**. Native USDC has six decimals and contract **`0x3c499c542cef5e3811e1192ce70d8cc03d5c3359`**. Bridged USDC, other chains, and ordinary wallet transfers are not automatically matched to orders.

Check `GET /api/checkout?native=polygon-usdc-readiness`. Activation requires configured and operational token, chain, decimals, EIP-712 domain, and finality checks on both endpoints. Readiness can be operational while new collection is disabled. The endpoint omits RPC URLs, credentials, and the full recipient. It is cached for up to thirty seconds.

The admin configure action derives the recipient and account fingerprint from server configuration. It cannot substitute a request-supplied wallet. Existing route identity is immutable: do not change the receiving wallet in place while invoices or authorizations remain outstanding. Such a change requires a separately planned route transition with continued verification of the old route.

### Preserve configured destination coverage

Crypto activation should use the exact canonical shipping list, excluding configured unavailable destinations. It currently contains **243 unique country/territory codes**, already excluding `RU`, `BY`, `IR`, `KP`, `CU`, and `SY`. This is the application's existing checkout scope; it is not an independent carrier or import-eligibility guarantee.

Generate the activation array from source, rather than entering a shortened list:

```bash
node -e "const c=require('./config/checkout.json'),z=require('./config/shipping-zones.json');const countries=c.shipping_countries.filter(code=>!z.unavailable_countries.includes(code));if(new Set(countries).size!==countries.length)throw Error('Duplicate countries');console.log(JSON.stringify(countries));"
```

Use that array as the Polygon route's `countries` field. The API accepts only unique canonical supported codes for this provider. The Polygon database constraint permits the full list; other providers retain the existing sixty-country cap. Keep hosted Card at `US`/`CA` unless its separate eligibility has been reviewed. New orders require the destination to be supported by both shipping configuration and the selected payment route.

## Verification, recovery, and cancellation

1. The authenticated customer saves the server-priced order, connects a compatible wallet, and receives one stored EIP-3009 authorization: payer, recipient, exact amount, nonce, chain/token, and validity window. The amount in token units is invoice cents multiplied by 10,000.
2. The customer explicitly signs and confirms the wallet transaction. PURE's server never holds a signing key, signs a transfer, or broadcasts one. An authorization lasts at most thirty minutes and never beyond the invoice expiry.
3. The verifier checks the recovered signer and exact calldata, successful transaction and receipt, canonical block and transaction placement, `AuthorizationUsed`, and the matching USDC `Transfer`. Both independent RPC endpoints must agree on the finalized receipt. An unfinalized or conflicting result remains pending.
4. Backend-only SQL atomically records the proof and uses the existing payment/fulfillment transition. Unique invoice intent, nonce, attempt, and chain/transaction/log identities prevent duplicate credit and reuse across orders. Repeated confirmation returns the existing result.

The customer can reload the saved order and check payment status. The nonce remains the order identity even if a wallet replaces its transaction hash. A failed browser response is not proof that no payment occurred; do not create another payment to resolve uncertainty.

The existing `altapure-invoice-email-retry` pg_cron job runs once per minute and wakes the same HMAC-authenticated, one-use-nonce worker when crypto, email, or supplier work is due. It reuses the existing Vault worker signing material; no new public scheduler is added. Each worker checks up to four pending crypto intents within a 35-second budget, then runs the existing independent notification and supplier queues. Pending/failing checks rotate so older receipts cannot starve new work. Customer confirmation, admin reconciliation, and the worker all use the same verifier.

To stop new Crypto collection, disable its environment switch and/or deactivate the route, while retaining recipient, both RPC endpoints, the stored account identity, and the authenticated worker. Existing payment confirmation continues independently of the collection switch. Do not erase old intents or proofs.

An authorization is not released merely because the browser closed, a wallet dialog was rejected, or a local clock says it expired. Safe release requires **both independent RPC views** of the finalized chain to be past its validity window and report the nonce unused. Release marks the attempt declined/intent expired, allowing the existing unpaid-order cancellation process to proceed. A used or uncertain nonce requires reconciliation first. A valid receipt discovered after the invoice expired, was canceled, or entered a conflicting state is stored for **review**, without automatic fulfillment.

Direct Crypto refunds are manual owner-authorized wallet transactions after verifying the customer destination and network, followed by recording the verified external refund. The native endpoint does not initiate them. Rampex also has no implemented automatic refund API. Never assume an on-ramp's sending address is the customer's refund address.

Implementation: [USDC verifier](../lib/polygon-usdc.js), [wallet client](../polygon-usdc-pay.js), [native gateway](../lib/native-gateway.js), [worker](../lib/manual-commerce-integrated.js), and [cancellation gate](../lib/commerce-cancellation.js).

## Release and verification

Check recorded migration history first; never reapply a recorded version. The independent admin-session migration is `20261117192716_pure_passwordless_admin_sessions.sql`. Apply the remaining payment/delivery migrations in this order:

1. `20261117192240_pure_canada_next_day_delivery.sql` — shared Canadian next-day quote.
2. `20261117193534_pure_direct_polygon_usdc.sql` — private intents/proofs, route registration, provider constraints, safe release, and existing worker schedule.
3. `20261117194109_pure_card_crypto_checkout.sql` — checkout v6 pricing/validation and activation of the uniquely identified existing hosted Rampex route for US/Canada.

The USDC migration does not seed a receiving wallet or activate a financial route. Configure its route only after the reviewed environment and live read-only readiness checks pass. Keep the application and v6 SQL rollout coordinated: older checkout versions intentionally fail validation and require a refreshed checkout.

Run builds in an isolated release checkout: `npm run build` rewrites generated source/output. In that checkout, install the locked project dependencies and isolated test-only dependencies, then run the financial and auth tests:

```bash
npm ci
PURE_VERIFY_DEPS=$(mktemp -d)
npm install --prefix "$PURE_VERIFY_DEPS" --package-lock=false --ignore-scripts @electric-sql/pglite@0.5.16 ganache@7.9.2
NODE_PATH="$PURE_VERIFY_DEPS/node_modules" node --test tests/admin-auth*.test.cjs tests/polygon-*.test.cjs tests/pure-payment-*.test.cjs tests/invoice-worker-auth.test.cjs tests/canada-delivery-sql.test.cjs tests/shipping-preferences-dom.test.cjs tests/neuro-cart-layout.test.cjs tests/rampex-*.test.cjs
npm run build
git diff --check
```

Require **zero failed and zero skipped** financial tests. PGlite executes disposable local PostgreSQL schemas; the EVM tests use a disposable local chain and the pinned Circle token fixture. They do not use production database credentials or move real funds.

After release, inspect public readiness and `/api/customer-config?checkout=public`: Card should be hosted Rampex for US/Canada, Crypto should have the canonical configured destination coverage, and new checkout should expose exactly two choices. Verify protected admin reads, account-owned order access, shipping protection opt-out persistence, Canadian next-day pricing, and the 5% versus 15% summaries without placing a live order. Check the existing cron job and redacted worker counts for progressing pending work; do not create unauthenticated worker requests or send a test payment as a health check.
