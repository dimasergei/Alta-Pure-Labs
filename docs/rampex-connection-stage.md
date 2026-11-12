# Rampex connection verification — collection disabled

This additive stage uses RAMPEX_API_KEY and RAMPEX_WEBHOOK_SECRET from server-only production secrets. No secret values belong in source, logs, chat or browser JavaScript.

GET /api/checkout?native=rampex-readiness performs only the documented POST /api-validate-key authentication check. Its sanitized result contains no merchant identity, wallet or credentials. Results are cached for 60 seconds per function instance. Configured variables do not imply valid credentials, catalog authorization or working settlement.

POST /api/checkout?native=rampex-webhook verifies HMAC-SHA256 over bounded raw bytes. Explicitly marked signed test events return 200 with live_payment_applied=false. Genuine or ambiguous callbacks return 503 with verified=true and Retry-After: 60, rather than silently acknowledging a payment that cannot yet be reconciled. Invalid signatures return 401. This endpoint must NOT be used to collect customer payments in this stage.

No database calls, payment-link creation, payments, notifications, supplier actions, schema changes or automatic deployments occur in the added connection handler. RAMPEX_ENABLED cannot bypass the hard-coded collection-disabled state.

The dependency-free protocol helper builds but never sends exact-amount requests. Its amount/reference checks and stable event key do NOT replace durable account-bound attempt mapping, authenticated payment-status retrieval or atomic database deduplication.

Before customer collection: implement and independently test dedicated Rampex attempt/link storage and payment finalization; approve and apply a narrowly scoped database migration separately; configure an explicit non-Stripe provider authorized for the catalog/countries; verify callback delivery and the actual customer/merchant fee and settlement flow. Do not reuse PeptidePay provider IDs or its database constraints. Do not run the broad main-branch production migration workflow to apply this feature.

Offline tests: node --test tests/rampex-protocol.test.cjs tests/rampex-connection.test.cjs. These are not end-to-end payment or settlement tests.

Official contract reviewed 2026-11-12: https://rampex.io/api-docs. The live provider-status feed may differ from marketing fee examples.
