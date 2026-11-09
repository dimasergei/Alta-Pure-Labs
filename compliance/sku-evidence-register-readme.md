# SKU evidence register — instructions

**Status:** Working diligence template only. No row is approved for sale, import, export, advertising, checkout or shipment.

**Catalog baseline:** 46 records / 84 variants from `main/products.js`. The uploaded `product_manifest.csv` matches 83 variants; the storefront-only `Needles 31G 5/16"` 10-pack is marked `manifest_match=NO`. Verify whether that item belongs in the supplier manifest and resolve the difference before treating the supplier file as complete.

## How to use this register

- Maintain one row per exact sellable variant. Do not combine different strengths, formulations, blends, routes or presentations.
- Preserve `sku_key` as a stable internal key; do not encode prices, legal approvals or inferred product classifications in it.
- Fill evidence fields from authentic supplier/manufacturer records. Use a document reference or controlled repository location, not a statement that a document exists.
- For blends, record each active component and its per-component strength. A total blend mass is not a substitute for a composition statement.
- Record the exact shipped batch/lot and ensure its COA is for that lot. A generic or sample COA is not batch traceability.
- Record the precise intended use, target customer type, complete product label, images and every product-page/advertising claim supplied to a regulator, lawyer, carrier or payment provider.
- Record sterile, injectable, endotoxin, particulate and other quality assertions only when supported by the appropriate product specification, validated method and lot-specific test result. Do not infer sterility from packaging or appearance.
- Record country-of-origin rules separately from each destination's product classification and import/supply pathway.
- Do not treat a provider's acceptance as regulatory authorization, or a regulator's product authorization as payment-provider or carrier acceptance.
- Final decisions must be made for the exact SKU + destination + fulfillment origin + shipping service. Until then the server-side shipping/payment eligibility decision remains deny-by-default.

## Required decision values

- `HOLD`: not eligible; no sale/shipment until the exact issue is resolved and documented.
- `SEPARATE REVIEW`: a distinct product classification and evidence path is required; this is not an approval.
- `APPROVED`: use only after qualified review confirms the exact variant, destination, origin and service and links all supporting evidence. Never set this based only on a RUO label, supplier assurance, customer self-certification or a payment processor's willingness to process a charge.

The initial values are deliberately restrictive: injectable-category products start at `HOLD`; BAC Water and needles start at `SEPARATE REVIEW`. No country or route is approved by this file.
