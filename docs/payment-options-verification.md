# Payment options verification

## Implemented
Interac, bank transfer, PayPal Business invoices, Stripe-hosted invoices, BTCPay Bitcoin invoices, NOWPayments crypto invoices and a configurable approved specialist processor. All are built on the reviewed-invoice/manual-reconciliation workflow. This release does not claim new native API collection, signed provider payment webhooks, automatically created external invoices or an account approval.

## Executed tests
191 application tests passed. The full production build passed twice. Generated customer invoice, admin and public/provider scripts parse successfully. Repeated builds produce one preference integration and one provider UI script, not duplicated fields.

Real disposable PostgreSQL17 tests passed for provider settings, priority version conflicts, host mismatch rejection, invoice snapshot preservation, goods-versus-membership scope, pausing and service-only privileges. Earlier manual-invoice lifecycle tests remained passing.

A read-only isolated browser rendered the public page with seven setup-pending choices, zero payable links, no JavaScript errors and a390px document within a390px viewport. Expanded positive admin/customer browser submissions were not completed and are not claimed passed. Backend and database command behavior have executed unit/transaction coverage. No production test receiving account, invoice, payment, wallet or customer write was created.

Five CI workflows passed on e94258d04f1f75254befd51de3a32e3355eb983e; final commit and production verification are recorded on PR57.

## Database
Applied tested SQL unchanged, remote migration version20261110074742_payment_provider_options. Repository filename is reconciled to that history. Verified new provider_key/display_order/sale_scope fields, RLS enabled, no anonymous/customer direct table access or provider RPC access, and service-role execution. Receiving methods and manual invoices remained0; historical orders remained19.

Advisor findings remain the existing managed pg_net-in-public warning, leaked-password-protection warning and informational service-only RLS notices. No unrelated security/auth/extension changes were made. This is not a complete security certification.

## What still needs actual inputs
The owner must configure an eligible provider/business receiving account. PayPal/Stripe require an eligible account and a real invoice for the exact sale; BTCPay requires the owner's operating server/store/wallet; NOWPayments requires its actual account/payout setup. Unknown methods are not represented as usable. Bank details, merchant contracts, API secrets and wallets are never invented. A real authorized settlement test remains outstanding.

Previous production code remains the rollback candidate. Keep additive schema fields and historical invoices on rollback. Changing priorities does not change issued invoice instructions; pausing a route does not cancel a provider-issued payment page outside AltaPure.
