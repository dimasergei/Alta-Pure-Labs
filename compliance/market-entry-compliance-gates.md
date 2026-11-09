# Market-entry and shipping eligibility gates

**Status:** Internal compliance planning only — no destination or SKU is approved for sale or shipment by this document.

**Last reviewed:** 2026-11-09

## Why this gate exists

The project record describes 83 numbered product/strength entries in a product manifest, with examples including retatrutide, tirzepatide, semaglutide, BPC-157, TB-500, blends, NAD+, glutathione and BAC Water. The manifest itself was not available during this review. These examples are not a complete SKU inventory and do not establish the legal classification, stock status, purity, intended use, or approval of any item.

A "Research Use Only" label is not a general exemption from medicines, import, sale, advertising, or product-safety laws. Do not turn on worldwide shipping or accept orders from a jurisdiction until both the exact SKU and the destination have a documented approval basis.

## Initial destination gate

| Destination | Official-source finding | Current operational gate |
|---|---|---|
| Canada | Health Canada states that a research-use label does not make a product legal to import or sell. It states unauthorized health products without DIN/NPN have not been assessed and are illegal to sell or promote. Its Nov. 6, 2026 warning identifies unauthorized injectable products including retatrutide, tirzepatide, NAD+ and others, and describes seizures and border enforcement. | **HOLD** all unapproved/uncategorized peptide and injectable SKUs for Canadian sales/imports. Only consider a SKU after product classification, applicable DIN/NPN or other lawful pathway, establishment/import licensing, labeling and shipment documentation are verified by qualified Canadian counsel/regulatory specialist. |
| United States | FDA says retatrutide and cagrilintide cannot be used in compounding under federal law and are not components of FDA-approved drugs. FDA has warned about unapproved GLP-1 products and direct-to-consumer marketing. This does not by itself classify every catalog item or every RUO transaction. | **HOLD pending SKU-specific U.S. regulatory review.** Do not market or ship retatrutide/cagrilintide as compounded products. Obtain written legal classification for every item, including intended use, claims, presentation, supplier and customer type. |
| United Kingdom | MHRA guidance says importing licensed/unlicensed human medicines can require marketing authorisations, wholesale/manufacturer licences and, for unlicensed medicines, prior notification with no MHRA objection. | **HOLD pending UK medicines-law review and applicable licences/authorisations.** A customer-facing RUO disclaimer is not a substitute for the required pathway. |
| Australia | TGA states unapproved peptide products generally cannot be imported or supplied unless a valid exemption, approval or authority applies. The Personal Importation Scheme does not permit commercial supply or public advertising. | **HOLD unapproved peptide SKUs.** Only enable a SKU/destination after the applicable ARTG, exemption, approval or authority and importer/supplier requirements are documented. |
| European Union / EEA | No SKU-specific or member-state-specific legal determination was completed in this pass. | **HOLD** until counsel verifies EU and destination-member-state requirements, including medicinal-product classification, authorisation, importation, distribution and advertising. |
| All other destinations | No country-specific review has been completed. | **HOLD by default.** No blanket worldwide-shipping setting. Review each destination and SKU before allowlisting. |

## SKU evidence required before allowlisting

Create one record for every manifest row / sellable variant. Do not infer one strength or formulation's status from another.

Required fields:
- Exact SKU, compound/ingredient, strength, formulation, route/presentation, and product claims.
- Supplier legal name, manufacturer, manufacturing country/site, batch/lot and traceability.
- Intended customer and documented intended use; exact label, website copy, images and marketing claims.
- Regulatory classification for the origin country and each destination.
- Applicable product authorisation/registration (e.g. DIN/NPN, FDA status, ARTG entry, UK/EU authorisation) or the specific lawful exemption/approval relied upon.
- Importer/exporter identity, establishment/manufacturer/wholesale licences, and any site/GMP requirements.
- Label and language requirements, customs tariff classification, dangerous-goods/carrier constraints, temperature/storage and packaging requirements.
- Written review date, reviewer, source links and expiration/reassessment trigger.

## Implementation rule

The shipping service must use a server-side allowlist keyed by **SKU + destination + fulfillment origin + shipping service**. Default is denied. A destination selector or currency selector must never imply that a product can legally be shipped there.

Do not:
- expose an unrestricted "worldwide" shipping option;
- rely on an RUO / not-for-human-consumption disclaimer as the legal basis;
- use customer self-certification to bypass import or sale restrictions;
- route around a restriction through a different processor, entity, carrier or country;
- invent COAs, licences, product authorisations, supplier records or customs descriptions;
- show an eligible shipping rate until the exact SKU/destination combination has passed review.

If an item is not approved, block it before payment and display a neutral availability message. Do not collect payment and attempt to resolve import eligibility after the order.

## Official sources reviewed

- Health Canada, [Peptides: Research and clinical trials](https://www.canada.ca/en/health-canada/services/drugs-health-products/peptides/research-clinical-trials.html) — RUO labels do not legalize import or sale.
- Health Canada, [Peptides: Regulations and enforcement](https://www.canada.ca/en/health-canada/services/drugs-health-products/peptides/regulations-enforcement.html) — authorization and DIN/NPN requirements.
- Health Canada, [Nov. 6, 2026 warning on contaminated unauthorized injectable peptides](https://recalls-rappels.canada.ca/en/alert-recall/health-canada-warns-about-contaminated-unauthorized-injectable-peptides-and-non) — examples, enforcement and risks.
- Health Canada, [GUI-0117 commercial import/export guidance](https://www.canada.ca/en/health-canada/services/drugs-health-products/compliance-enforcement/importation-exportation/commercial-use-health-products-guidance/document.html) — commercial import/export, importer responsibilities, licensing and documentation.
- FDA, [Concerns with unapproved GLP-1 drugs](https://www.fda.gov/drugs/postmarket-drug-safety-information-patients-and-providers/medications-containing-semaglutide-marketed-type-2-diabetes-or-weight-loss) — FDA's statements on retatrutide/cagrilintide and unapproved GLP-1 products.
- MHRA / GOV.UK, [Import a human medicine](https://www.gov.uk/guidance/import-a-human-medicine) — import licensing and unlicensed medicine notification.
- MHRA / GOV.UK, [Supply unlicensed medicinal products (specials)](https://www.gov.uk/government/publications/supply-unlicensed-medicinal-products-specials/supply-unlicensed-medicinal-products-specials).
- TGA, [Peptide products](https://www.tga.gov.au/resources/explore-topic/peptide-products) — Australian regulation and import/supply obligations.
- TGA, [How we regulate therapeutic peptide products](https://www.tga.gov.au/products/medicines/monitoring-and-compliance/how-we-regulate-therapeutic-peptide-products) — unapproved products, exemptions and commercial-supply restrictions.

## Review limits and next input needed

This is a planning gate, not a legal opinion or regulator decision. The complete 83-row `product_manifest.csv` referenced by the project record was not present in the accessible project files during this review. The next product-level review requires that exact manifest plus current supplier, label, claims, intended-use and fulfillment-origin records. No product has been approved by this document.
