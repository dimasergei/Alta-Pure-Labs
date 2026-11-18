# PURE order management

The shared Manage Order workspace displays order details, payment, a generic fulfillment-sheet download, shipping and delivery controls, the shipping-label workspace, and collapsed refund/activity sections where applicable. It is used for regular product orders, bulk orders, and earlier store orders. Memberships and subscription records do not receive physical shipping controls.

## Generic fulfillment sheet

Authenticated PDF and CSV downloads use the PURE Fulfillment Sheet template. The template contains the order reference/date, recipient and destination, contact details, products and strengths, purchased/free/total physical quantities, shipping selection, available lot information, tracking, and a dispatch record. It excludes supplier names, supplier SKUs and pack mappings, routing labels, external fulfillment references, internal notes, customer prices, payment instructions, and provider payloads.

Historical supplier information remains in private records for reconciliation but does not enter the sheet or the Manage Order supplier section, which has been removed. Supplier-related activity events display a generic summary; normal order history remains accessible in its disclosure.

The sheet is generated from the current saved order each time it is downloaded. Generating or downloading it never creates an external order, marks the order shipped, purchases postage, or sends a message. Unpaid, canceled, refunded, already-dispatched, or otherwise held orders receive an explicit generic hold/reference state. Hidden legacy report controls also omit supplier metadata and do not record a download as fulfillment activity.

## Manual shipping

New paid regular and bulk orders receive manual fulfillment allocations without an assumed supplier. Physical quantities come directly from the saved order, and seeding is idempotent. Existing allocations, external jobs, and audit history are not rewritten.

An eligible paid manual order can be marked shipped using a carrier, tracking number, and audit note without choosing or naming a supplier. Existing payment, current-version, cancellation, external-request, active-sync, partial-shipment, and unresolved-postage restrictions still apply. Historical automated routes remain held until their existing fulfillment is reconciled.

The independent shipping-label flow continues to offer rate comparison before payment, paid-only label purchase, private PDF previews/downloads, and saved sender/package preferences.

## Release verification

Apply `20261118020145_pure_generic_manual_fulfillment.sql` before releasing the matching UI. It replaces the existing seed and complete-order fulfillment functions using their verified live definitions, changing the new-allocation supplier default and removing only the supplier-name prerequisite for manual dispatch. No historical data migration is performed.

Focused DOM, API, export, and PostgreSQL tests cover all order types, supplier-neutral output with historical branded fixtures, exact quantities, blank-name manual dispatch/tracking, private execution, and retained cancellation/postage/duplicate-shipment protections. Fake-data PDF samples are rendered for layout review. These checks make no live purchases or customer notifications.
