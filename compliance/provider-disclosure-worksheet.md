# Payment-provider disclosure worksheet

**Status:** Draft preparation worksheet only. It is not an application, provider approval, merchant agreement or representation that the products may be sold or shipped in any jurisdiction.

Complete every applicable field from actual business and supplier records. Do not guess. Submit identity, tax, ownership, bank and other sensitive documents only through a provider's verified secure onboarding portal, not in this repository or a chat.

## 1. Merchant and contracting entity

| Field | Merchant-confirmed value |
|---|---|
| Full legal entity name | **TO COMPLETE** |
| Trading name / DBA | AltaPure Labs — confirm legal linkage |
| Entity type | **TO COMPLETE** |
| Incorporation / formation jurisdiction | **TO COMPLETE** |
| Registration number | **TO COMPLETE IN PROVIDER'S SECURE PORTAL** |
| Registered business address | **TO COMPLETE IN PROVIDER'S SECURE PORTAL** |
| Operating / management location(s) | **TO COMPLETE** |
| Public website | https://altapurelabs.com |
| Customer support email and telephone | **TO COMPLETE** |
| Tax residence / tax registrations | **TO COMPLETE IN SECURE ONBOARDING** |
| Beneficial owners and control persons | **TO COMPLETE IN SECURE ONBOARDING** |
| Settlement bank country and account holder | **TO COMPLETE IN SECURE ONBOARDING** |
| Requested settlement currency/currencies | **TO CONFIRM** |

Do not apply under a different entity, descriptor, domain or business category to make the activity appear lower risk. The contracting entity, website operator, seller of record, invoice issuer, account holder, exporter and importer of record must be accurately identified.

## 2. Business model and customer profile

| Field | Merchant-confirmed value |
|---|---|
| Business model | Online catalog and direct order flow — confirm actual seller/fulfillment model |
| Product category disclosure | Research compounds / injectable-category products and laboratory supplies |
| Product presentation | Current catalog includes injectable-category vial products, BAC Water and laboratory needles; confirm exact product labels and presentations |
| Intended-use wording shown to customers | Research / in-vitro laboratory use only; not for human or veterinary use. Provide the exact current wording and page screenshots. |
| Permitted customer types | **TO COMPLETE** — state whether individuals, laboratories, companies, universities or other institutions may order |
| Customer verification | **TO COMPLETE** — accurately describe age, business, institutional or other checks actually enforced |
| Customer countries | **TO COMPLETE** — list only markets the merchant has separately established a lawful basis to serve |
| Fulfillment and returns model | **TO COMPLETE** |
| Customer support / complaint process | **TO COMPLETE** |

Do not state that orders are limited to institutional or business customers unless the storefront and order controls actually enforce that restriction. Do not imply that an RUO label itself establishes a lawful sale, import, export, advertisement or shipment pathway.

## 3. Exact catalog disclosure

The repository catalog baseline contains **46 product records / 84 sellable variants**:

- 43 injectable-category records containing 81 variants.
- Two BAC Water records containing two variants.
- One Needles 31G 5/16" (10-pack) record containing one variant.

The uploaded 83-row supplier manifest matched 81 injectable variants and both BAC Water variants. It did **not** include the storefront Needles 31G 5/16" 10-pack. This discrepancy must be resolved with the supplier before claiming the manifest is complete.

**Attach the current full SKU register and exact product/variant list.** For each SKU, attach the actual front/back label, product presentation and formulation, supplier/manufacturer identity, manufacturing site and country, current lot-specific COA, quality specifications and test methods, and all claims/marketing materials. Include each blend's full component composition and per-component strength. Do not submit only a representative product or generic COA.

Current compliance tracking files:
- `compliance/sku-evidence-register.csv` — exact variant rows and evidence fields (developed in the related shipping-compliance PR; include the latest approved copy in the provider packet).
- `compliance/sku-evidence-register-readme.md` — how to complete the register.
- `compliance/market-entry-compliance-gates.md` — destination restrictions and review requirements.

No SKU or destination is represented as approved by these planning documents. All injectable variants remain on HOLD. BAC Water and needles require separate product classification review.

## 4. Product sourcing, quality and fulfillment

| Field | Merchant-confirmed value |
|---|---|
| Supplier legal name(s) | **TO COMPLETE** |
| Manufacturer legal name(s) | **TO COMPLETE** |
| Manufacturing country and facility/site | **TO COMPLETE** |
| Supplier authorization / license evidence | **TO COMPLETE** |
| Quality system / GMP evidence, where applicable | **TO COMPLETE** |
| Batch/lot traceability process | **TO COMPLETE** |
| COA and specification access process | **TO COMPLETE** |
| Sterility / endotoxin / particulate claims and supporting tests, if applicable | **TO COMPLETE — do not claim without evidence** |
| Storage and handling conditions | **TO COMPLETE FROM VALIDATED PRODUCT DOCUMENTS** |
| Actual fulfillment warehouse(s) and country/countries | **TO COMPLETE** |
| Exporter of record | **TO COMPLETE** |
| Importer of record for each destination | **TO COMPLETE** |
| Carriers and shipping services | **TO COMPLETE** |
| Returns, rejected parcels and customs seizure handling | **TO COMPLETE** |

Supplier certificates, labels and COAs must be authentic and current. A generic sample COA does not prove the identity or quality of the lot supplied to a customer.

## 5. Regulatory status and destination scope

Attach a separate written regulatory review for each exact SKU and destination. Identify the classification, authorization/registration, lawful exemption or other basis relied upon; the responsible importer/exporter; and applicable licensing, labeling, advertising and shipment conditions.

| Destination | Current project gate | Merchant/provider disclosure |
|---|---|---|
| Canada | HOLD pending exact SKU classification and applicable authorization/licensing | Do not state that Canadian sale/import is approved |
| United States | HOLD pending exact SKU and business-model review | Disclose injectable presentations, claims, supplier and customer model; do not imply an FDA-approved product |
| United Kingdom | HOLD pending applicable medicines/import/supply pathway | Identify any required authorizations and license holders |
| Australia | HOLD pending applicable TGA status, exemption or authority | Do not use the personal-importation scheme as a commercial-supply basis |
| EU / EEA | HOLD pending EU and destination-member-state review | No blanket EU authorization is established |
| Other countries | HOLD by default | List only after country-specific review |

A payment provider's willingness to process a transaction is not a regulatory authorization. A destination's product authorization is not automatically a bank, payment-platform or carrier approval.

## 6. Requested customer payment methods

For every method, ask the provider to identify whether it is actually available **from the customer at checkout**, or is only a **merchant payout/settlement** option.

| Requested method | Customer checkout? | Merchant payout? | Countries / limits / conditions |
|---|---|---|---|
| Credit cards | Request exact card brands and domestic/international coverage | Separate question | **PROVIDER TO CONFIRM IN WRITING** |
| Bank transfer / ACH / pay-by-bank | **PROVIDER TO CONFIRM** | **PROVIDER TO CONFIRM** | Specify countries and supported banks |
| Zelle | **PROVIDER / BANK TO CONFIRM** | **PROVIDER / BANK TO CONFIRM** | Do not use a personal P2P account or circumvent bank restrictions |
| Venmo | **VENMO / PROVIDER TO CONFIRM** | **PROVIDER TO CONFIRM** | Confirm business-profile/online acceptance and product-category permission |
| Cash App | **CASH APP / SPONSOR BANK TO CONFIRM** | **PROVIDER TO CONFIRM** | Resolve applicable acceptable-use policy and underwriting restrictions first |
| Interac e-Transfer | **PARTICIPATING FINANCIAL INSTITUTION TO CONFIRM** | **PROVIDER TO CONFIRM** | Canadian rail; not a worldwide checkout method |
| Bitcoin (BTC) | **PROVIDER / MERCHANT COUNSEL TO CONFIRM** | **PROVIDER TO CONFIRM** | Identify wallet/control, refund, sanctions, AML, tax and accounting controls |

Do not describe card-to-crypto settlement as customer Bitcoin checkout. Do not represent a provider payout option as a customer payment method. Do not route a restricted product through a different rail or entity to evade underwriting.

## 7. Mandatory written provider answers

Obtain written answers from the actual acquirer, sponsor bank, processor and gateway (not only a sales agent):

1. Has the actual underwriting bank reviewed the exact full 84-variant catalog, product labels, images, website copy, claims, customer model, suppliers and fulfillment origins?
2. Which exact SKUs, strengths, blends, vial presentations, BAC Water products and needles are accepted or excluded?
3. Does the approval explicitly cover the disclosed research-use-only e-commerce model? What label, age/business verification, customer, website and advertising conditions apply?
4. Which customer checkout methods are supported, by country, card brand, transaction currency and customer type?
5. Which methods are only for merchant payout? What payout currency, timing, minimum and fees apply?
6. What are the excluded countries, products, transaction types, customer profiles and fulfillment locations?
7. Identify the actual acquiring bank, sponsor bank, gateway, processor, payment facilitator (if any) and contracting party.
8. Provide the full merchant agreement, pricing, rolling reserve, reserve duration, chargeback fees, refund fees, cross-border/FX fees, settlement holds, termination triggers and reserve release terms.
9. Confirm fraud controls, 3-D Secure/SCA, AVS/CVV, dispute evidence requirements, refund and partial-refund handling, and webhook/API support.
10. Confirm permitted descriptors, prohibited marketing claims, record-retention requirements, monitoring triggers and what changes require re-underwriting.
11. Confirm sandbox and staging support, production cutover process and how existing open orders, disputes and refunds would be handled during a processor migration.
12. Provide written SKU-level approval from the actual bank/processor before any integration or use.

## 8. Integration gate

No integration begins until the contracting counterparty, bank and processor have confirmed the exact product profile, methods, destinations, fulfillment model and website in writing, and the merchant has reviewed and accepted the executed agreement.

Any later integration must be isolated in a separate development/staging change with test credentials and explicit approval. Production configuration, secrets, database permissions, checkout/payment settings and deployment settings remain unchanged until separately authorized.

## 9. Merchant inputs still required

This worksheet cannot be completed from public website data alone. The merchant must supply or confirm:

- Legal entity / formation jurisdiction and operating location.
- Seller of record, settlement country and settlement currency.
- Supplier and manufacturer identities, product labels and current batch-level evidence.
- Actual warehouse / fulfillment origin(s), exporter and importer-of-record model.
- Which customer types are accepted and what customer verification is actually enforced.
- Countries intended for the first launch wave, after jurisdiction-specific review.
- Which requested payment rails are priorities if no single provider supports all of them.

**Do not place personal identity documents, tax identifiers, bank account numbers, passwords, API keys or payment credentials in this worksheet or a public repository.** Submit sensitive onboarding items only through the provider's verified secure portal.
