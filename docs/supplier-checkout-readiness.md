# Supplier, partner and checkout release — 2026-11-11

This extends the existing AltaPure checkout. It does not replace the storefront or activate an unapproved processor.

## Release and migration

Apply `20261111174353_partner_settings_supplier_queue.sql` after `20261111163930_conversion_memberships_partners.sql`. The migration retains all partner codes, backfills their aliases, preserves existing orders, and starts supplier automation disabled. New tables use RLS and service-only access. The v4 checkout still accepts outstanding v1–v3 signed quotes under their original rules.

Before deploying, create `PARTNER_BANK_ENCRYPTION_KEY` as 32 cryptographically random bytes encoded as 64 hex characters in the production server environment. Retain this key: replacing it without re-encryption makes existing bank records unreadable. Never expose it in a client, commit, log or support message. Bank records use AES-256-GCM with the partner UUID bound as authenticated data. Only masked details reach the customer dashboard. Admin payout reads are authenticated, recorded and cleared from the UI after 60 seconds. Saving details does not debit an account, verify bank ownership or initiate a payout.

Rollback: the previous application can run on the additive schema. Keep this migration and its encrypted bank records; do not drop tables to roll back application code. Existing referral aliases remain valid in this release; an older application cannot resolve newly chosen aliases correctly, so pause new partner enrollment if rolling back.

## Lotus prerequisites and activation

Official contract: https://partners.lotuspeptide.com/api/documentation

Lotus must enable API access for the approved partner account. The account's Connections page did not expose API keys at verification time. A hosted Lotus shop or its DNS connection is not needed for this integration. Do not redirect the existing storefront.

1. After Lotus enables the API, obtain a test key from Shop → Connections → API keys. Put it in a separate test environment as `LOTUS_PARTNER_API_KEY`. Test keys begin `ptr_test_`; live keys begin `ptr_live_`. Never use a test key for real customer fulfillment.
2. Read `/products` and `/pricing`, then map every exact AltaPure compound/dosage to the correct Lotus product and pack in `/admin-supplier.html`. A mapping never rounds quantities or substitutes strengths. Unsupported pack quantities stop for review. Free BOGO units count toward fulfillment.
3. Test quote, create, duplicate-reference replay, lookup by reference, label attachment, tracking and cancellation using provider-approved fixtures. A Lotus test order can still ship if paid/labeled, so do not settle it or buy postage unintentionally. Test changed prices, unavailable inventory, transient errors and cancellation after a customer refund.
4. Confirm actual dispatch time, express service/cutoffs, packaging, lot-specific COAs, settlement procedure and any supplier fees/agreements with the owner. Do not enable paid priority, cold-chain or protection services without the service and terms.
5. Set the live key and `LOTUS_FULFILLMENT_ENABLED=true` in production only after successful provider testing. Set the singleton `commerce_supplier_settings` row's `enabled`, `verified_at` and a user-approved `max_order_cents`. Both the environment flag and database gate must be on. Do not backfill historical orders into the queue automatically.
6. A newly paid goods order enters a durable queue. The signed existing notification worker processes one due supplier job per invocation. The worker retains a stable `ALTA-<order UUID>` reference and immutable price-guarded payload, checks the reference before retrying an ambiguous create, and uses a database lease. Retryable transport errors back off; business errors stop for manual review in Supplier Operations.
7. Creating a live supplier order incurs an amount owed. **Pay Lotus on its Owed page and purchase/attach a Pirate Ship label manually.** The API currently does not automate settlement or label purchase. The supplier can cancel unpaid orders after its payment deadline. Review the queue and Lotus panel each operating day; the queue does not itself send exception emails.
8. Polling only marks a customer order shipped after Lotus returns `status=shipped`, `shipped_at` and tracking. A label or supplier `status=paid` is not proof of dispatch. Existing order notifications are retained. Refund cancellation can be refused after supplier payment/shipment and then requires manual resolution.

No Lotus key, supplier order, settlement or label was created as part of this release. Supplier test execution and live activation remain pending provider access.

## Checkout availability

Standard US delivery remains $25, waived for paid members or $250 in merchandise after discounts. Express UPS ($34.95), UPS Next Day ($69.95), priority processing ($9.99), cold chain ($9.99) and protection ($5) are prepared but disabled. These are proposed customer charges, not verified Lotus costs. Both the API and SQL reject unavailable selections. Only standard shipping is waived; extras are never silently selected or waived.

The membership offer computes savings from the actual basket and available discounts, and states that membership is purchased separately and that displayed savings exclude its fee. Memberships remain prepaid monthly/annual terms, not recurring billing.

Apple Pay and Google Pay controls depend on a verified live NMI method plus wallet enablement. They remain disabled while awaiting processor activation. When enabled they enter checkout, which collects/validates shipping and consent and creates a durable order before opening the native payment component. This is not a verified one-click wallet sheet in the cart. Complete NMI card and eligible-device wallet tests, domain verification and reconciliation/refund checks before enabling live charging. An NMI sandbox login or a processor eligibility email is not live approval.

## Verification

Local checks cover the existing payment/refund/reward suites, new encryption and supplier retry/reconciliation tests, isolated SQL fixtures and account/cart DOM interactions. Provider end-to-end tests cannot be completed without actual credentials and approval. Never mark them passed based on mocks.
