# Market-entry and shipping eligibility gates

**Status:** Internal compliance planning only — no destination or SKU is approved for sale or shipment by this document.

**Last reviewed:** 2026-11-09

## Why this gate exists

The uploaded numbered `product_manifest.csv` contains **83 rows**. It was compared row-by-row by product and dosage against the current repository `main` branch `products.js`, which contains **46 catalog product records and 84 sellable variants**: 43 injectable-category records, two BAC Water records and one needles record. **All 81 injectable variants and both BAC Water variants match. The sole discrepancy is the storefront's `Needles 31G 5/16\"` 10-pack variant (`10pk`), which is present in `products.js` but absent from the 83-row CSV.** The CSV's row order differs from the storefront order; no other product/dosage discrepancy was found. The source CSV was not modified. The repository catalog list is reproduced below as an inventory for review, not as evidence of stock, identity, purity, intended use, legality or approval.

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

## Repository catalog inventory to classify

Source: `products.js` on `main` (read during this review). All 43 records in the `injectables` category are **HOLD pending SKU-specific regulatory review**. The two BAC Water variants and needles are not peptide drugs by name, but their regulatory classification, product presentation, claims, import requirements and carrier rules must be reviewed separately; they are not automatically approved.

| Catalog record | Variants in current repository | Initial review state |
|---|---|---|
| Retatrutide | 10, 15, 20, 30, 40, 60 mg | HOLD |
| Tirzepatide | 10, 20, 30, 40, 60 mg | HOLD |
| Semaglutide | 10, 20, 30 mg | HOLD |
| 5-Amino-1MQ | 10, 50 mg | HOLD |
| AOD-9604 | 5, 10 mg | HOLD |
| Cagrilintide | 5, 10 mg | HOLD |
| BPC-157 | 5, 10 mg | HOLD |
| TB-500 | 5, 10 mg | HOLD |
| BPC/TB-500 | 10/10, 15/15 mg | HOLD |
| KPV | 5, 10 mg | HOLD |
| ARA-290 | 10 mg | HOLD |
| LL-37 | 5, 10 mg | HOLD |
| Thymosin Alpha-1 | 10 mg | HOLD |
| GHK-Cu | 50, 100 mg | HOLD |
| AHK-Cu | 50, 100 mg | HOLD |
| Glow | 70 mg | HOLD |
| KLOW | 80 mg | HOLD |
| Snap8 | 10 mg | HOLD |
| CJC-1295 No DAC | 5, 10 mg | HOLD |
| CJC-1295 W/DAC | 5, 10 mg | HOLD |
| CJC/Ipamorelin | 10/10 mg | HOLD |
| Ipamorelin | 5, 10 mg | HOLD |
| Sermorelin | 5, 10 mg | HOLD |
| Tesamorelin | 10, 20 mg | HOLD |
| Tesa/IPA | 5/5 mg | HOLD |
| Semax | 5, 10 mg | HOLD |
| Selank | 5, 10 mg | HOLD |
| Semax/Selank | 10/10 mg | HOLD |
| Adamax | 10 mg | HOLD |
| Pinealon | 10 mg | HOLD |
| DSIP | 5, 10 mg | HOLD |
| NAD+ | 500, 1000 mg | HOLD |
| Epithalon | 10, 50 mg | HOLD |
| Glutathione | 600, 1500 mg | HOLD |
| SS-31 | 10, 50 mg | HOLD |
| MOTS-C | 10, 20, 40 mg | HOLD |
| B-12 | 10 mg | HOLD |
| Melanotan II | 10 mg | HOLD |
| Melanotan 1 | 10 mg | HOLD |
| PT-141 | 10 mg | HOLD |
| Kisspeptin | 5, 10 mg | HOLD |
| Oxytocin | 5, 10 mg | HOLD |
| VIP | 5, 10 mg | HOLD |
| BAC Water (3 mL) | 3 mL | SEPARATE REVIEW |
| BAC Water (10 mL) | 10 mL | SEPARATE REVIEW |
| Needles 31G 5/16" | 10-pack | SEPARATE REVIEW |

The current code's 43 injectable records include products Health Canada specifically identifies in its public peptide advisories, including retatrutide, tirzepatide, semaglutide, BPC-157, TB-500, MOTS-C, NAD+, and others. The advisories do not by themselves settle every product's classification in every country; they are a clear reason not to infer that RUO labeling or a global destination selector authorizes sale.

The route-level starting template is [`compliance/shipping-lane-register-template.csv`](./shipping-lane-register-template.csv), with instructions in [`compliance/shipping-lane-register-readme.md`](./shipping-lane-register-readme.md). It starts with 84 placeholder SKU rows and `DENY` decisions. Duplicate a row for each exact destination + fulfillment origin/site + shipping service under review; incomplete or unlisted lanes remain denied.

## Supplier source-document assessment

The supplied one-page `99Purity-Wholesale-PickPack.pdf` is a catalog/pricing sheet, not a supplier qualification or batch quality dossier. The assessment at [`compliance/supplier-document-intake-assessment.md`](./supplier-document-intake-assessment.md) records the visible claims, missing legal/manufacturer identity and lot evidence, unsubstantiated “Made in the U.S.A.” footer claim, exact supplier-document requests, and the nine capsule listings that remain outside the storefront inventory and current SKU register.

## Working SKU evidence register

A fillable register now exists at [`compliance/sku-evidence-register.csv`](./sku-evidence-register.csv), with instructions in [`compliance/sku-evidence-register-readme.md`](./sku-evidence-register-readme.md). It contains one row for each of the 84 exact sellable variants from `main/products.js`; 83 match the uploaded manifest and the needles 10-pack is flagged as absent. The register captures supplier/manufacturer, formulation, lot-specific COA and quality testing, labeling and claims, intended use, origin/destination classification, importer/exporter, fulfillment, carrier and reviewer evidence. Every row starts as `HOLD` or `SEPARATE REVIEW`; blank evidence fields are intentional. This is a diligence worksheet, not a product approval or shipping allowlist.

## SKU evidence required before allowlisting

Create one record for every sellable variant. Reconcile the 83 manifest rows plus the omitted needles 10-pack storefront variant before treating the manifest as a complete SKU register. Do not infer one strength or formulation's status from another.

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

This is a planning gate, not a legal opinion or regulator decision. The uploaded 83-row `product_manifest.csv` has now been reconciled against `products.js`: 83 product/dosage entries match, and the storefront has one additional variant, Needles 31G 5/16\" (10-pack). Add or otherwise account for that omitted variant in the canonical SKU register after confirming it is intended to be part of the manifest. Next, attach current supplier, label, claims, intended-use and fulfillment-origin records for each sellable variant. No product has been approved by this document.
