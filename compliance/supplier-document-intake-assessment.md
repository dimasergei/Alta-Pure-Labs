# Supplier-document intake assessment — 99 Purity Wholesale Pick & Pack

**Assessment date:** 2026-11-09  
**Source reviewed:** User-provided one-page PDF, `99Purity-Wholesale-PickPack.pdf`  
**Status:** Catalog/pricing sheet only. It is not supplier qualification, product authorization, a COA, manufacturing-origin evidence, or approval to sell or ship.

## What the supplied PDF actually establishes

The single page is branded **“99 Purity Wholesale — Fulfillment · Pick & Pack”** and describes:
- Out-the-door price per unit, with shipping not included.
- Labeling and pick-and-pack included.
- A “Research Use Only” statement.
- A footer statement “Made in the U.S.A.”
- A list of injectable-category products, BAC Water, needles and a separate capsule section.

The PDF contains no visible supplier legal entity name or registration number, business address, telephone/email, manufacturer identity, manufacturing facility/site, named quality contact, SKU/GTIN/lot identifiers, batch-specific COAs, specifications, analytical methods, test results, GMP/quality certifications, import/export permits, or carrier acceptance documents.

**Important:** The footer's “Made in the U.S.A.” wording is an unverified claim in a sales/pricing sheet. It does not establish the legal manufacturer, actual manufacturing location of each SKU, origin of active ingredients, or the product-specific country-of-origin determination required for any destination. Do not repeat it as a verified origin claim or disclose it as manufacturing evidence to a bank, regulator or customer until supported with traceable manufacturer records and any applicable origin substantiation.

Likewise, “Research Use Only” is wording printed on the sheet, not evidence of regulatory classification or an exemption from sale, advertising, import, export or shipment requirements.

## Catalog reconciliation and exclusions

The current storefront catalog in `main/products.js` contains 46 product records / 84 variants:
- 43 injectable-category records / 81 variants.
- BAC Water 3 mL and 10 mL / two variants.
- Needles 31G 5/16" 10-pack / one variant.

The uploaded 83-row `product_manifest.csv` contains the 81 injectable variants and both BAC Water variants but omits the storefront needles 10-pack. That variant is flagged separately in the SKU register.

The source PDF also lists nine capsule products in a separate section:
1. AMPK (60 ct)
2. Super NAD+ (60 ct)
3. BPC-157 w/ Aminos (60 ct)
4. Micellular LiverGenix+ (60 ct)
5. Wolverine Elite+ (60 ct)
6. Gonadorelin Elite+ (20 ct)
7. Vitamax Regener8 (60 ct)
8. Zazen-ST (90 ct)
9. Male Ultra Elite+ (60 ct)

These capsule listings are not part of the current 84-variant storefront inventory or 83-row manifest reconciliation. They remain **excluded from the storefront register and any provider/shipping disclosure** unless the merchant separately decides to add them and starts a new SKU-level classification and evidence review. Do not infer that capsule listings are capsules of the same category, ingredients or legal status as any injectable SKU.

## Documents needed from the supplier / manufacturer

Request the following from the supplier, and require the supplier to identify the actual manufacturer for each product:

### A. Legal identity and authority
- Full legal supplier name, registered business address, jurisdiction and registration number.
- Supplier and distributor/import/export licenses relevant to the actual products and jurisdictions.
- Full legal manufacturer name, manufacturing facility address/site ID and country of manufacture for each SKU.
- Named quality/compliance contact and verifiable business contact channel.
- Written statement of the supplier's role: manufacturer, authorized distributor, reseller, fulfillment agent, or another role.
- If the supplier uses subcontract manufacturing, identify each responsible legal entity and site.

### B. Exact product identity and specification
- Complete SKU/GTIN or manufacturer item code, product name, exact strength and presentation.
- Full qualitative and quantitative composition for each blend, listing every active component and per-component strength.
- Formulation and dosage form, vial/container type and fill quantity; actual route/presentation.
- Product specification and acceptance limits, including identity, purity/assay, potency and relevant impurity profile.
- Label artwork for every marketed variant and the exact current label revision.
- Storage, temperature, handling, packaging and stability data with supporting studies or specifications.
- Any sterility, endotoxin, bioburden or particulate claim with method, validated specification and applicable result. Do not infer sterility or injectable suitability from a vial or product photograph.

### C. Batch-level quality evidence
- COA for the specific lot intended to be supplied, with product/SKU, batch/lot, manufacturer/site, date, methods, specification limits, actual results, reviewer and authorization.
- Independent laboratory report and laboratory identity/accreditation where testing is performed by a third party.
- Raw analytical chromatograms/spectra or test attachments where appropriate to verify the stated method and result.
- Manufacturing release and lot-traceability records linking the COA to the exact units fulfilled.
- Deviation, complaint, recall and adverse quality event process, including notification and lot quarantine procedures.
- Relevant quality-system/GMP certifications and the issuing body's verifiable details, where applicable.

A generic COA, sample report, unlabeled screenshot or COA for a different lot does not establish the identity or test status of the lot shipped to a customer.

### D. Origin, fulfillment and logistics
- Written product-specific country-of-origin statement and the factual basis for the claim.
- Actual warehouse/fulfillment site address and legal operator.
- Whether products are stored, relabeled, repackaged or picked/packed by a separate third party.
- Exporter of record, importer of record and responsible customs broker for each proposed lane.
- Customs classification and goods description proposed by the supplier, to be independently checked.
- Carrier and shipping-service written acceptance of the exact product presentation, packaging and destination.
- Storage/temperature controls, shipping validation and excursion/rejected-parcel handling.

## Register use

Populate `sku-evidence-register.csv` with a document reference for each field and each exact variant. Do not mark evidence as received based on a verbal statement. Keep missing fields blank and decisions at HOLD/SEPARATE REVIEW.

Populate `shipping-lane-register-template.csv` only after a destination, origin/site and carrier service have been identified. Each unverified route remains DENY.

## Current readiness determination

| Area | What the supplied PDF provides | Current state |
|---|---|---|
| Supplier legal identity | Brand/heading only | MISSING |
| Manufacturer/site identity | No named legal manufacturer or facility | MISSING |
| Product names and dosage/pack listings | Catalog listing | PARTIAL ID ONLY |
| Product labels / label revisions | No separate SKU label files | MISSING |
| Lot-specific COAs | None | MISSING |
| Test methods and actual results | None | MISSING |
| Quality system / GMP evidence | None | MISSING |
| Product-specific country of origin | Unsubstantiated footer claim only | MISSING |
| Fulfillment warehouse/site | Pick-and-pack claim only | MISSING |
| Exporter/importer and licenses | None | MISSING |
| Carrier acceptance per route | None | MISSING |
| Product/destination approvals | None | NOT ESTABLISHED |

**Conclusion:** The supplied sheet is adequate as a product/price reference, not as evidence for supplier due diligence, payment underwriting, country of origin, regulatory status, or shipping approval. No SKU, supplier, manufacturer, destination or route is approved by this assessment.
