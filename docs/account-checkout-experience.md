# Account and checkout experience

This release builds on the direct checkout release, without changing processor activation, ledger rules, pricing, tax, database permissions or historical Stripe payment handling.

- Seven account tabs: Overview, Orders, Membership, Rewards, Profile, Partner, Support.
- Orders contains all orders, pending payments, tracking and earlier Stripe orders. Existing order detail URLs continue to work; old tracking/history entry routes lead into Orders.
- Membership renders current status, all three plans, benefits and direct annual-pass checkout links. Saved research lists remain reachable within Membership.
- Partner renders the real existing inquiry form in the account tab. The durable inquiry API and admin workflow are reused.
- Profile saves bounded first/last/display names, contact phone, organization, shipping and billing addresses using authenticated user metadata. No financial entitlement or balance is derived from that metadata. Existing order address snapshots remain immutable.
- Email changes use Supabase Auth's confirmation flow; password changes use its existing recovery flow. No authentication setting is weakened.
- Checkout has a focused responsive layout, cart images and amounts, live enabled payment methods, optional rewards controls and shipping address autofill. Server quote and durable placement APIs are unchanged. Form inputs lock during quote calculation and edits invalidate the displayed quote.

## Verification

- `npm test`: 257 tests pass.
- `npm run build`: compiled script parsing, account route, inline page, private-page analytics and checkout output checks pass.
- `npm run test:account-dom`: isolated jsdom fixtures exercise profile saves, email/password requests, membership rendering, order search, shipping autofill, quote invalidation and final quoted placement. No production credentials or network are used. DOM fixtures do not provide visual rendering or navigation verification.
- CI runs these DOM fixtures after the build, with pinned development dependency jsdom 26.1.0.
- Production desktop/mobile visual inspection follows the exact tested commit deployment. No real customer profile changes or test purchases are required.

No migration is required. The previously applied `20261111025932_direct_checkout_balances` migration remains the database prerequisite. Bank transfer stays live; cards and wallets remain unavailable until actual merchant activation and provider testing succeed.
