# Supplier offer normalization — operational design

This is a pure comparison module, not a live supplier integration or fulfillment decision. It recognizes three established supplier relationships: 99 Purity, Your Peptide Brand and PeptideDropship.

## What is supported now

- A normalized per-SKU supplier offer contract with explicit currency, minimum quantity, unit cost, order handling cost and shipping cost.
- Explicit confirmation flags for exact formulation and strength.
- Evidence reference, availability state and source-specific supplier SKU.
- Cost-only ranking for the exact AltaPure SKU. Unknown, stale, discontinued, differently formulated or mismatched supplier listings are not automatically eligible for review.
- Unit tests; no supplier credentials, memberships, account access, orders, reservations or production writes.

## Still required

- Current supplier pricing and SKU crosswalk verified by each supplier. The uploaded catalogs contain aliases and differing strengths; do not silently equate them.
- Actual shipping, handling, packaging, subscription/membership and minimum-order terms.
- Lot-specific COA, manufacturer, country of origin, product eligibility and permitted fulfillment routes.
- A supplier adapter for each provider's **actual** available API, secure CSV feed or manual fulfillment procedure. Do not invent APIs.
- For any future routing decision, call the separate SKU/destination/payment compliance gates. A low price or supplier willingness to ship never authorizes a transaction.

## Privacy and security

Supplier contract prices and negotiated terms belong in a restricted data store, not a public static JSON file or client-side code. Do not commit supplier contact identities, API keys, wholesale cost files or private contract terms into the public repository. Do not enable automatic purchase orders until explicit approval and fulfillment reconciliation tests.
