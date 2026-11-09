# Shipping-lane register template

**Operational default: DENY.** This template does not authorize sale, export, import, fulfillment or shipment of any product.

The file starts with one placeholder row for each of the 84 sellable variants in the storefront catalog. These are not complete route records. For each proposed lane, duplicate the SKU row and fill the exact destination (including state/province or other sub-jurisdiction where required), fulfillment origin/site, and shipping service. Do not use a generic "worldwide" row.

The operational decision key is:

`SKU + destination + fulfillment origin/site + shipping service`

For a lane to be considered, link:
- SKU evidence from `sku-evidence-register.csv` (supplier/manufacturer, product presentation, label, exact lot evidence and classification).
- Written destination-specific regulatory analysis and any authorization/licence/exemption.
- Correct exporter and importer-of-record identities and licences.
- Correct customs classification/description and any permits/declarations.
- Carrier's written acceptance of the exact product, route, packaging and service.
- Storage/temperature and dangerous-goods requirements, where applicable.
- A named reviewer, date, rationale, and re-review trigger.

Rules:
- Keep `decision=DENY` while any key field or evidence is missing, expired, contradictory or unverified.
- Do not infer that another strength, blend, product form, origin or country is covered.
- A payment provider's acceptance does not make a shipping lane lawful; a carrier's acceptance does not confer regulatory authorization.
- Do not accept or capture payment until server-side checks confirm that every item in the order is eligible for that exact route.
- Only qualified review with linked evidence may change a specific lane's decision. Keep the store's default as deny for all unlisted lanes.
