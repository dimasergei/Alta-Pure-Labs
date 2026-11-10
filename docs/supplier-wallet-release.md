# Supplier references and wallet readiness — November 10, 2026

This continues the NMI/PayerURL release merged in PR #61 (`9a8496ea6911b7439b20819f28c938cf7bc21b24`). The storefront, product prices, historical Stripe records and manual supplier workflow remain in place.

## Completed in this follow-up

- Correct NMI wallet method identifiers to `apple-pay` and `google-pay`. The deployed SDK version 1.1.1 and current NMI documentation both require the hyphenated identifiers. Regression tests exercise component mounting and the express token callback through the accepted invoice payment path.
- Add supplier planning presets to invoice review. Presets clear stale shipping quotes and amounts, leave unknown carriers/transit blank, and require a new invoice preview. They do not create supplier orders or promise a route that has not been quoted.
- Publish the three selected suppliers' delivery estimates and original reference COA links separately from verified AltaPure lot records. Supplier references do not populate inventory, grant payment eligibility, or represent an AltaPure purchased lot. PeptideDropship's actual report remains to be obtained.
- Maintain existing supplier IDs and add PeptideDropship to the private supplier registry. No subscription, supplier charge, purchase order or automatic fulfillment was authorized by those records.
- Prepare an explicit build allowlist for the provider-issued Apple Pay association file. No substitute file was generated; production domain registration still needs the actual account file.
- Tax work is deferred at the owner's request. Existing invoice review and recorded amounts are preserved.

## Supplier basis

| Supplier | Dispatch / handling basis | Transit planning estimate | Source |
| --- | --- | --- | --- |
| YourPeptideBrand | US; advertised 24–48-hour dispatch | Confirm exact carrier and transit with supplier | https://yourpeptidebrand.com/launch-a-peptide-store-in-14-days/ |
| 99PurityPeptides | US; 1–3 business-day processing | US 3–7 business days; international 7–15 plus customs | https://99puritypeptides.com/shipping-policy |
| PeptideDropship | California; advertised 24-hour fulfillment | Advertised two-day US delivery; exact route/cutoff needs confirmation | https://peptidedropship.com/ and existing supplier correspondence |

Shipping prices are not published as AltaPure defaults. Supplier handling fees and delivery charges are separate. Reference report metadata and original links are in `data/supplier-references.json`; purchased-lot reports remain in the verified quality workflow.

## NeuroLabs comparison and actual card blocker

The existing US checkout displayed Standard UPS $14.95, Express UPS $34.95 and UPS Next Day $69.95. These were address/cart-specific observations, not carrier quotes for AltaPure. Its shipping policy lists processing of 1–2 business days, standard transit 3–5 and express transit 1–2. Its homepage advertises a faster cutoff, so the policy is the more conservative planning reference. No public evidence established NeuroLabs' supplier or acquiring bank.

Visible choices were NMI cards, NoRamp cards and Link Money bank payments. NMI Component/v5 is already implemented here. NoRamp's current published policy excludes GLP-1/GIP compounds present in the AltaPure catalog; its visible use by another store is not account approval for this catalog.

NMI sandbox sale, decline and full refund were tested in the preceding release. There is no configured live merchant account, production key, tested wallet, live callback or settlement evidence. The browser's sandbox merchant session was at the login screen during this review. Apple Pay requires the actual merchant file at `/.well-known/apple-developer-merchantid-domain-association`, allowed-domain registration and eligible-device testing. Google Pay must also pass account-specific testing before activation. Keep both wallet flags off until then.

## Focused provider follow-up

Existing RFG review remains open awaiting NMI/fee answers. MOBOPAY's reply says it does not offer NMI or Apple/Google Pay. PeptideApprove has not provided approval. Do not submit duplicate applications.

Prepare a reply to the existing PeptideDropship contact for a processor introduction supporting the Canadian entity, exact catalog and both wallets. Novupay publicly advertises peptide processing and Apple/Google Pay, but no merchant eligibility, acquiring arrangement, fees or timeline has been verified for AltaPure; request a nonbinding review before any application/terms acceptance. PayerURL support should resolve the confirmed-email 401 before credentials are configured. Do not retry account creation or substitute credentials.

Sources: https://neurolabsresearch.com/shipping-policy/ ; https://docs.nmi.com/docs/payment-component ; https://noramp.io/ruo ; https://novupay.com/industries/peptides-research-compounds ; https://novupay.com/terms-of-service .
