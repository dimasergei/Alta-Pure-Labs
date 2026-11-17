# PURE shipping labels

Orders → Manage order → **Generate shipping label** uses Shippo to quote and buy one parcel label for a paid physical order. A label does not mark the order shipped or contact the supplier. Existing manual fulfillment remains the dispatch record.

## Activation

Add `SHIPPO_API_KEY` to the production project's secure environment configuration. Use the token from the owner's Shippo account; never paste it into order notes, source code, support messages, or browser storage. The account must have billing and the intended carrier accounts configured. A `shippo_test_…` token only creates test labels, clearly marked as invalid postage. A `shippo_live_…` token permits the explicit purchase step.

No provider token or ship-from address was available during this implementation. Until connected, the new menu explains setup and cannot quote or purchase. No live label has been purchased or validated by this release.

The operator enters the actual sender/return address, packed dimensions, and packed weight. Recipient information is loaded from the saved order and cannot be substituted in a label request. Address corrections must first be saved through the existing audited order editor. A previous sender for the same order is offered when available; no origin address or package weight is invented.

## Workflow

1. Open the order and choose **Generate shipping label**.
2. Review the recipient and requested delivery selection. Enter sender and packed parcel details.
3. For an international parcel, enter accurate customs descriptions, quantities, total item values, total net weights, countries of manufacture, tariff codes, signer, and applicable export references. Quantities come from physical fulfillment items, including recorded gifts.
4. Select **Get shipping rates**. No postage is purchased at this step.
5. Review the sender, recipient, parcel, carrier messages, service, currency, and postage amount. Select one rate, check the review confirmation, then explicitly confirm the displayed purchase amount.
6. Download the provider's 4 × 6 PDF, any commercial invoice, and review tracking. Record dispatch through the normal fulfillment workflow after the parcel is handed to the carrier.

Quotes expire after fifteen minutes and support USD/CAD postage amounts. Carrier availability depends on the connected account and the actual origin/destination. The amount is the provider's selected postage rate; a Shippo plan may separately charge label fees. This does not change the customer's saved shipping charge.

Carrier/country-specific customs requirements can extend beyond the fields in this menu. Provider messages are shown before purchasing. If a required field is unavailable, finish the label directly in Shippo instead of ignoring the requirement. No tariff code, origin, legal exemption, export statement, or customs certification is fabricated by the application.

## Purchase and recovery guarantees

`admin_shipping_labels` is private, RLS-enabled, and inaccessible to browser database roles. The existing admin session and CSRF checks protect the API. Only the server receives the Shippo token.

The service-only claim locks the supplier job, invoice, allocations, and label in the existing fulfillment order; it checks paid state, cancellation holds, shipment activity, unchanged order/address snapshot, quote age, and the exact selected rate/amount/currency. A partial unique index allows one active label per order and test/live mode. Repeat submissions return the stored attempt without another provider purchase.

The claim is saved before the purchase POST. There is no automatic POST retry. Definite validation or authorization rejections close the attempt as failed. A timeout, unexpected response, or unknown outcome remains in review, blocking another purchase. Locate `pure-label:<attempt UUID>` in Shippo and enter that transaction ID to reconcile. Do not clear an uncertain attempt by editing database rows.

Provider results must match the order metadata, selected rate, and test/live mode. The row-locked result RPC binds the transaction ID immutably. Older pending/error responses cannot erase a successful label, and refund states cannot be undone by stale purchase responses. Live unresolved purchases hold relevant order, allocation, and supplier-job changes; test labels do not hold real operations.

Untracked services can return a valid label without a tracking number. They do not bypass the existing order shipment requirements. Choose an appropriate tracked carrier service for orders that require tracking.

Refund unused postage in Shippo. **Check label status** reflects refund pending, rejected, and completed states. A confirmed refunded label is not downloadable as valid postage and no longer blocks a fresh quote. An order refund and a postage refund are separate transactions; this feature initiates neither automatically.

## Release and verification

Apply `20261117221540_pure_admin_shipping_labels.sql` before releasing its API. The migration is transactional and changes no existing order data. It creates private attempt storage, claim/result RPCs, immutable provider identity, and live purchase guards.

Focused tests cover authenticated order access, selected amount confirmation, JSON request handling, domestic/international form validation, unknown transport outcomes, duplicate clicks, stale order snapshots, unpaid/canceled/refunded orders, service-role privileges, optional tracking, monotonic status and refund sequences, and test/live isolation. External provider calls are mocked. Live acceptance still requires the configured account and an owner-authorized purchase.

Primary integration references:

- <https://docs.goshippo.com/api-reference/overview>
- <https://docs.goshippo.com/api-reference/shipments/create-a-new-shipment>
- <https://docs.goshippo.com/api-reference/transactions/create-a-shipping-label>
- <https://docs.goshippo.com/api-reference/customs-declarations/create-a-new-customs-declaration>
- <https://docs.goshippo.com/api-concepts/apihttp-status-codes>
