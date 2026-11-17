# PURE shipping labels

Orders → Manage order → **Generate shipping label** uses Shippo to quote and buy one parcel label for a paid physical order. A label does not mark the order shipped or contact the supplier. Existing manual fulfillment remains the dispatch record.

## Activation

Keep both account tokens in the Vercel production project's sensitive environment configuration. This API runs on Vercel; it does not read Supabase Edge Function secrets.

| Variable | Purpose |
| --- | --- |
| `SHIPPO_TEST_TOKEN` | Shippo test token, beginning `shippo_test_`. |
| `SHIPPO_API_TOKEN` | Shippo live token, beginning `shippo_live_`. |
| `SHIPPO_MODE` | `test` (the safe default) or `live`. Must match the selected token. |
| `SHIPPO_ALLOW_LIVE_PURCHASES` | Must be exactly `true` to enable live label purchases. Otherwise live rates and read-only reconciliation remain available. |

Never paste tokens into order notes, source code, support messages, or browser storage. A legacy `SHIPPO_API_KEY` is accepted only when the mode-specific variable is absent and its prefix matches the explicit mode. Missing/invalid keys never fall back to another mode. Redeploy after changing environment settings.

The account must have billing and the intended carrier accounts configured. A test token creates sample labels, clearly marked as invalid postage. The live mode and purchase switch enable the existing owner-confirmed purchase step; simply enabling them does not buy a label. The admin panel states the active mode and whether purchases are enabled. Existing labels refresh with their original test/live credential even after the active mode changes.

The operator enters the actual sender/return address, packed dimensions, and packed weight. Recipient information is loaded from the saved order and cannot be substituted in a label request. Address corrections must first be saved through the existing audited order editor. A previous sender for the same order is offered when available; Canada and metric parcel units are offered by default; no street address or package weight is invented.

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

Focused tests cover authenticated order access, selected amount confirmation, JSON request handling, domestic/international form validation, unknown transport outcomes, duplicate clicks, stale order snapshots, unpaid/canceled/refunded orders, service-role privileges, optional tracking, monotonic status and refund sequences, and test/live isolation. The automated unit/DOM/SQL tests use fixtures and mocked provider calls.

### Optional provider verification without purchasing postage

`npm run verify:shippo` is an explicitly invoked server-side diagnostic. For a controlled Vercel deployment, set `SHIPPO_VERIFY_ON_BUILD=1` to run it before the normal build; remove the flag or set it to `0` after verification. Normal builds make no Shippo requests. To recheck a previous diagnostic label without generating another, set `SHIPPO_VERIFY_TRANSACTION_ID` to its recorded test transaction ID; this mode permits only GET requests. Clear it only when intentionally creating a new sandbox label. Never export production secrets to run this locally.

The diagnostic authenticates the live token using read-only carrier-list requests, then uses only the test token to obtain Canadian domestic rates, create one sample `PDF_4x6` transaction, refresh its URL, and parse the downloaded PDF and check its effective page dimensions, including crop boxes, rotation, and page units. Verification accepts both documented `PDF_4x6` sizes: 4×6 inches and 102×153 mm (the size returned by the Canadian UPS sample). It does not crop or rescale carrier labels. It uses named public civic addresses as test fixtures, never PURE's actual ship-from address or customer information. It does not connect to PURE's database, create a PURE order, mark fulfillment, send customer notifications, schedule a pickup, or buy live postage. Test and live credentials stay in the server process; logs contain allowlisted results, not keys, label URLs, account numbers, or provider payloads. No transaction POST is automatically retried.

The script rejects missing test flags or mismatched transaction IDs, rates, and metadata. A failed provider verification fails that deployment before promotion. Its success proves the tested sandbox workflow and live credential authentication, not live billing or every carrier/destination combination. Shippo test rates may differ from real rates. Live purchase acceptance still requires the actual paid order, sender/parcel/customs details, a configured payment method, and the owner's explicit purchase confirmation.

Primary integration references:

- <https://docs.goshippo.com/api-reference/overview>
- <https://docs.goshippo.com/api-reference/shipments/create-a-new-shipment>
- <https://docs.goshippo.com/api-reference/transactions/create-a-shipping-label>
- <https://docs.goshippo.com/api-reference/customs-declarations/create-a-new-customs-declaration>
- <https://docs.goshippo.com/api-concepts/apihttp-status-codes>

Additional verification references:

- <https://docs.goshippo.com/guides/testing>
- <https://docs.goshippo.com/api-reference/carrier-accounts/list-all-carrier-accounts>
- <https://docs.goshippo.com/shipments/shipping-label-sizes>
