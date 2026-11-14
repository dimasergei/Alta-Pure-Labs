# Stripe only through Rampex (no merchant-direct Stripe)
Scope: owner authorized Stripe via Rampex for USD research goods, with hosted redirect accepted. No Apple Pay or Google Pay activation is claimed in this stage.
Do not re-enable legacy `api/checkout.js` Stripe Checkout or old `STRIPE_*` credentials. This remains a Rampex Merchant API connection.
Rampex published `provider=stripe` with USD and US-only coverage and $2 platform minimum (actual provider fees and customer verification may vary).
A distinct Stripe-only Rampex gateway route is configured. The old multi-provider route stays inactive and is retained only for reconciliation of outstanding historical payment links.
The provider is fixed when the server creates each payment attempt; no fallback to hosted or any other provider. Only a Rampex-origin HTTPS link is returned after a durable attempt binding.
The existing HMAC webhook and read-after-webhook confirmation path verifies exact USD amount, receipt, payment link, account tag and Polygon USDC settlement data; no amount or provider can be substituted. The full upstream catalog eligibility is not independently verified by a status endpoint.
No real customer payment has been submitted as part of offline tests. A successful small real card payment, paid-order reconciliation, webhook delivery, and receiving-wallet settlement still require verification before calling the provider fully operational.
Apple Pay / Google Pay will be addressed separately only if confirmed enabled for the particular Stripe-via-Rampex route.
