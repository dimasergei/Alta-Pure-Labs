# Rampex Multi Hosted Providers

Owner authorized hosted provider choice, including Stripe within Rampex, on 2026-11-12. AltaPure's direct Stripe route remains retired. This release retains USD goods-only orders and the existing US shipping scope.

Requests use provider=hosted. The public status feed has no hosted row, so the availability check requires at least one active underlying USD route whose stated minimum fits the exact server amount. Customer eligibility, identity checks, actual fees and provider minimums are still decided by the provider. No Apple Pay/Google Pay flag is invented: those methods are presented on Rampex/provider-hosted checkout when supported. AltaPure uses a top-level HTTPS redirect, not an embedded wallet frame. Its native NMI wallet flags are not enabled as a substitute.

Authenticated payment-status responses and signed callbacks may name the provider selected within hosted checkout. Amount, currency, account/link/order references, payout checks and atomic replay prevention remain enforced. A fixed-provider attempt still rejects a different provider. A newly created hosted URL cannot silently substitute a fixed provider.

The additive migration only permits hosted in the existing route constraint and setup function, and updates the schema marker. It does not seed customers, orders or payments, or change suppliers. Public and customer-role execution privileges remain revoked.

The readiness response can expose a SHA-256 account binding fingerprint while there is no active route. It is not an authentication credential, and never returns the API key, webhook secret, wallet or merchant identity. It disappears after an active matching route is registered. This allows authorized account setup without retrieving a production secret.

Validation: 341 offline unit tests passed; site build and isolated DOM checkout/navigation tests passed; hosted database lifecycle, replay, amount/currency/account and permissions checks passed on disposable PostgreSQL. No actual card payment, Apple Pay/Google Pay payment sheet, or receiving-wallet settlement was tested. The provider guide and public availability feed are capability evidence only, not proof of a successful payment.

Provider contract: https://rampex.io/api-docs
Public status: https://api.rampex.io/provider-status
