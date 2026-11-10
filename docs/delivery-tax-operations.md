# Delivery and tax setup

Owner-confirmed on 10 November 2026: AltaPure Labs and Northline Research operate under the same Ontario corporation; the seller is GST/HST registered; suppliers dispatch from US inventory. Suppliers are verified by the owner, with lot/COA evidence obtained upon purchase. Those facts do not establish every destination's tax or import treatment.

## Final invoice workflow

1. Obtain a quote for the exact items and delivery address from the selected supplier. The supplied 99 Purity price sheet explicitly excludes shipping. Record the dispatch state, carrier/service, handling and transit estimates, quote reference and expiry. No invented flat shipping fee or blanket worldwide promise.
2. For a cross-border shipment, establish the importer of record and who pays import duties, taxes and brokerage. Keep product/carrier/destination eligibility evidence in the private review fields. A supplier's US dispatch location is not necessarily the goods' customs origin.
3. Review place of supply and destination collection obligations. For taxable goods supplied in Canada, the desk calculates GST/HST after merchandise discounts, with a separate explicit decision about delivery-charge taxability. It uses ON 13%, NS 14%, NB/NL/PE 15%, and 5% GST elsewhere. Enter the actual GST/HST account number. PST/QST require separate review; 5% GST does not mean all taxes are covered.
4. For US deliveries, other countries, exceptions and annual membership passes, record the reviewed treatment and any applicable tax lines. Do not apply Canadian HST simply because the seller is Canadian, or assume no US sales tax because the seller is Canadian. State nexus, physical inventory relationships, drop-shipment rules, resale documentation and local rates require the actual facts. A no-collection decision needs an explanation and jurisdiction review.
5. When a USD invoice collects Canadian tax, record the CAD reporting exchange rate, date and approved source separately from the customer pricing conversion. The tax ledger retains its CAD equivalent. Filing/remittance remains an accounting task; this release does not file returns.
6. Preview and issue. The server calculates tax in integer cents, checks the destination against the goods request, and limits payment expiry to the shipping quote's validity. Customer invoices show the seller, tax names/rates/registration references, delivery estimate and import-charge responsibility. Supplier quote and route-review references stay private.
7. After verified payment, purchase from the verified supplier and record the supplier purchase reference, exact lot and COA reference in the private fulfillment note before dispatch. Retain the COA. Enter carrier/tracking when marking shipped. Manual supplier fulfillment is retained.

## Remaining owner/account facts

- Actual GST/HST account number and effective date; any PST/QST or US state registrations and resale certificates.
- Supplier dispatch state(s), actual rates, handling/transit commitments and cross-border delivery terms. Obtain a fresh exact quote when no standing rate is available.
- Confirm permitted business/catalog use for each receiving account before enabling its private draft. Saving a draft does not assert bank/provider approval. US domestic wire instructions do not establish ACH or international wire capability.

## Authoritative references checked

- [CRA destination/place-of-supply and current rates](https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/charge-collect-place-supply.html)
- [CRA place of supply, including goods delivered outside Canada](https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/3-3/place-supply.html)
- [CRA imports and exports](https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/charge-collect-imports-exports.html)
- [CRA receipt/invoice disclosures](https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/charge-collect-which-rate.html)
- [CRA foreign-currency conversion and supporting records](https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/3-6/conversion-foreign-currency.html)
- [Relay domestic wire instructions](https://relayfi.com/hc/en-us/articles/38047970345108-Receiving-a-domestic-wire/)

The software supports documented review; it does not determine business registrations, worldwide nexus or product import authorization from an address alone.


## Release verification — 10 November 2026

Migration `20261110181709_receiving_method_drafts.sql` was applied to the production project after its disposable PostgreSQL checks passed. It adds a service-role-only function for inactive private drafts; it does not activate a receiving method or change existing invoices, orders, attempts or historical records. Owner-provided Interac and US domestic-wire instructions were saved privately as inactive drafts. No receiving account number is stored in this repository.

The actual admin page and server invoice calculation were exercised against isolated fixtures: incomplete review was rejected; CAD 60.00 merchandise plus CAD 10.00 shipping with reviewed Ontario HST produced CAD 9.10 tax and CAD 79.10 total. No production test invoice was created.
