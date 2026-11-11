# Direct checkout and account balances

The customer now checks out directly at `/checkout`. Existing invoice tables remain the internal order/payment record, preserving the native gateway, reconciliation, receipts, manual fulfillment, notification and historical Stripe implementations. Customer orders are at `/account/purchases`; earlier links redirect there. Historical Stripe orders remain at `/account/orders`.

US checkout uses catalog prices, the better member/volume discount, a further 5% merchandise discount for bank transfer, and the existing US$25 domestic delivery charge. The owner deferred tax setup: the current US checkout configuration collects zero tax, which is not a determination that no tax obligations exist. International checkout remains unavailable.

VIP remains US$49 and Elite US$99 for a nonrenewing 365-day pass. Membership activation and revocation still follow verified payment/full refund. Passes cannot be purchased using points/credit; a goods-only provider cannot sell passes.

Product payments earn one point per whole paid merchandise dollar after discounts and redemptions, excluding shipping/tax/pass fees. A point is worth one cent; minimum redemption is 100 points. Staff-issued USD store credit is separate and can cover delivery. No fabricated or historical opening balances are created. Both balances have no automatic expiry and cannot be transferred or cashed out.

Checkout debits reserved balances transactionally. Unpaid cancellation restores them; unresolved gateway attempts block cancellation. Holds do not expire automatically, avoiding reuse while a bank payment may be in transit. Full refunds restore redemptions and reverse earnings. A points debt can result when refunded earnings were already spent; new earnings repay it before further spending. Fully balance-funded orders become paid atomically and have a dedicated audited balance refund command. No fictitious external receipt is generated.

Staff use `/admin-payments.html` for verified bank receipts, manual fulfillment/tracking and discretionary credit issuance (maximum US$1,000 per action, with a stable retry ID and audit reason). Issuing credit does not refund an external payment. Cash refunds remain tied to the original payment workflow. Partial refunds require support reconciliation; no automatic partial-refund feature is advertised.

Payment providers are offered only if active and ready in live mode. NMI, PayerURL and PeptidePay credentials, webhook verification and activation gates are preserved. PeptidePay remains disclosed as card-to-crypto. Cards, Apple Pay and Google Pay cannot be claimed operational until the actual merchant route is enabled and successfully tested.

Validation includes source tests, a full production build, disposable PostgreSQL lifecycle tests (existing native/manual/notification cases plus redemption/refund cases), a two-session credit overspend test, and build-output route/privacy assertions. The migration adds service-only balances/RPCs with RLS and no browser grants; no existing customer payment history is rewritten.
