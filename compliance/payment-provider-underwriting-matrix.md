# Payment-provider and payment-rail underwriting matrix

**Status:** Research and diligence only. No provider is approved, no application has been submitted, and no payment method is enabled by this document.

**Reviewed:** 2026-11-09

## Current storefront inventory and disclosure basis

The repository `main/products.js` contains 46 catalog records / 84 variants: 43 records in the `injectables` category, two BAC Water records and one needles record. The uploaded `product_manifest.csv` contains 83 numbered rows and has been reconciled against the storefront inventory: 81 injectable variants and both BAC Water variants match; the storefront additionally contains Needles 31G 5/16\" (10-pack), which is absent from the CSV. The source CSV was not modified. The provider disclosure must use the complete current storefront inventory, including this additional needles variant.

The exact catalog must be disclosed to every provider. Do not relabel the business as a supplement, cosmetics, or generic laboratory supply merchant if that does not accurately describe the products and business model. The provider must confirm in writing which individual SKUs and product presentations are accepted.

## Provider shortlist

| Candidate | Publicly described capability | Important distinction / unresolved issue | Diligence priority |
|---|---|---|---|
| PeptideApprove | Current public materials market card merchant services for RUO peptide ecommerce through a partner acquiring bank; the site advertises a 48-hour underwriting response after a complete application and standard T+1 settlement, both subject to approval/terms. It says pricing is confirmed after underwriting rather than publishing a rate. | No customer ACH/pay-by-bank, Zelle, Venmo, Cash App, Interac e-Transfer or BTC checkout is publicly confirmed. Identify the actual acquirer and processor, verify the exact product mix, and obtain the complete merchant agreement, reserves and settlement terms in writing. | **First card-underwriting inquiry** |
| Ember Services | Markets a dedicated peptide/research underwriting track and advertises card, ACH and EmberPay Cash App checkout. Its site says the sponsor bank reviews and boards the account after underwriting; its public Cash App demo specifically describes a **protein-peptide** test store. | This demo does not establish approval for AltaPure's injectable research catalog. Cash App's current Acceptable Use Policy prohibits businesses it considers financially/legal risky and products it considers unproven health products; Cash App's own policy applies to business use. Obtain explicit written acceptance from Cash App and the sponsor bank for the exact catalog and claims before treating this as a usable rail. No public confirmation of Venmo, Zelle, Interac or BTC checkout. | **Conditional inquiry only; Cash App is not approved** |
| RFG Specialty Payments | Current public peptide page advertises customer pay-by-bank ACH and card checkout. It also advertises a card-to-crypto **merchant settlement** lane. Its public pricing (stated as program pricing to its desk in late October 2026, not a quote) lists ACH at 3.95% + $0.30 and card-to-crypto at 4%; other card-settlement lanes are priced differently and may carry reserves. | RFG identifies itself as an independent sales agent, not the bank or processor. Its page says no crypto or peer-to-peer apps **at customer checkout**. Card-to-crypto settlement means a customer pays by card and the merchant receives crypto; it is not customer BTC checkout. Confirm the actual acquirer, gateway, product acceptance, pricing, reserve and settlement terms in a written bank-backed offer. | **First ACH/card comparison inquiry** |
| CERF | Its current site identifies CERF SAS as a Paris-based/French merchant-account placement and payment-infrastructure firm, lists Research Peptides as a supported vertical, and claims relationships with 30+ acquiring banks. It says assigned acquiring institutions provide the gateway and that fiat/crypto merchant settlement options depend on approval. | CERF explicitly says it does not operate a payment gateway or process payments. Its broad geographic and vertical claims are not a bank approval for AltaPure. Identify the actual acquiring institution, gateway, contractual counterparty, country and exact customer checkout rails before proceeding. | **Secondary multi-bank placement inquiry** |

These are candidates based on their own public descriptions, not recommendations that they will accept AltaPure Labs. Their marketing claims are not underwriting decisions.

## Requested methods — what must be verified

| Requested method | Practical route to investigate | Current diligence position |
|---|---|---|
| Credit cards | Specialist acquirer / merchant account that has reviewed the exact product list, claims, fulfillment and jurisdictions | Required primary route; no approval yet |
| Bank transfer | Provider-supported customer ACH / pay-by-bank for eligible U.S. customers; wire instructions where appropriate | Confirm customer payment acceptance separately from merchant payout options |
| Zelle | Only through a participating bank's explicitly approved business-use functionality | Not a global ecommerce checkout rail; obtain bank's written approval for this exact business category |
| Venmo | Authorized Venmo business profile or approved online checkout integration | Do not use a personal profile or informal P2P payments for business orders; obtain category approval |
| Cash App | Ember advertises Cash App checkout, but confirm the actual Cash App / sponsor-bank permission and product eligibility | **Unresolved policy conflict**; no use until written approval is produced |
| Interac e-Transfer | Canadian participating-bank / merchant service arrangement | Canada-specific; not a worldwide payment option; obtain business account and use-case approval |
| Bitcoin | Direct self-hosted BTCPay Server wallet, or a regulated/contracted crypto payment provider | Technically separate from card acquiring; still requires legal, tax, sanctions, AML, wallet-security, accounting and refund controls. Do not treat crypto as a way around a provider's product restrictions |

A merchant payout method is not necessarily a customer checkout method. A card payment that settles to a merchant in crypto is not the same as a customer paying in Bitcoin. The UI must label these accurately.

## Provider questions — mandatory written answers

Send each candidate the same complete disclosure and request written answers to all items below before applying or integrating:

1. Will the acquiring bank and gateway underwrite the actual AltaPure Labs catalog, including all listed compounds, blends, strengths, lyophilized vials, BAC Water and needles? Ask for SKU-specific exclusions.
2. Does approval cover a research-use-only online store, and what exact website, label, social-media, claims, age-gate, shipping and COA requirements apply?
3. What countries may the merchant sell to and ship to under the approved account? Which countries, product types or customer types are excluded?
4. Which methods are accepted **from customers at checkout**: Visa, Mastercard, Amex, Discover, customer ACH/pay-by-bank, wire, Zelle, Venmo, Cash App, Interac e-Transfer, BTC?
5. Which methods are only used for **merchant settlement/payout**? Name the payout currency and settlement timing for each.
6. Identify the actual acquiring bank, processor, gateway, sponsor bank, payment facilitator (if any), and contractual counterparty. Provide the merchant agreement before activation.
7. Provide card brand coverage, domestic/international acceptance, 3-D Secure / SCA support, AVS/CVV, fraud tooling, chargeback representation, refund support and dispute evidence requirements.
8. Provide all pricing: discount rate, per-transaction fee, monthly/gateway/compliance fees, chargeback fees, refund fees, cross-border/FX fees, reserve percentage, reserve duration, rolling cap and early termination fees.
9. State settlement schedule, currencies, minimum payout, holds, termination triggers, reserve release process and treatment of funds after account closure.
10. Confirm webhook/API support, idempotency, signed event verification, refunds, partial refunds, disputes, recurring payments (if any), sandbox/staging and cutover support.
11. Confirm whether existing customer payment tokens are portable (do not assume they are) and how legacy refunds/chargebacks are handled after migration.
12. Confirm in writing that the provider and its acquiring bank have been told the exact catalog, product pages, business model and intended-use presentation and have approved that disclosed profile.

Do not accept a verbal assurance, sales-page claim, generic "high-risk approved" statement, or a merchant-services broker's statement as bank approval.

## Immediate recommendation

1. Start with PeptideApprove for a disclosed **card-only** underwriting decision; its current materials are the clearest direct RUO-peptide merchant-services offer, but no account or SKU acceptance is established.
2. Compare RFG for customer ACH/pay-by-bank and card lanes, with a written comparison of USD settlement vs card-to-crypto settlement. It cannot provide customer BTC or P2P-app checkout based on its published rules.
3. Ask CERF for a named acquiring-bank placement and gateway proposal, including the actual checkout methods and country scope; CERF itself is not the processor or gateway.
4. Keep Ember/Cash App conditional. Require the sponsor bank and Cash App to confirm eligibility for this exact injectable research catalog in writing; do not infer approval from the Cash App demo.
5. Treat Zelle, Venmo, Cash App, Interac and BTC as separate optional rails. Add none until the bank/platform/provider confirms business-category permission.
5. Integrate only the method(s) expressly approved in the executed agreement, using a separate staging branch. Keep all live configuration, secrets, database permissions, checkout settings and deployment settings unchanged until separately approved.

## Official platform and technical policy references

- PeptideApprove, [official FAQ](https://www.peptideapprove.com/faq) and [merchant page](https://www.peptideapprove.com/) — current statements about RUO underwriting, the acquiring-bank relationship, 48-hour response, T+1 settlement and pricing availability.
- Ember Services, [peptides and research page](https://www.emberservices.net/peptides/) — current claims about card/ACH/Cash App, sponsor-bank boarding, and the protein-peptide Cash App demo.
- RFG Specialty Payments, [current peptide payment page](https://rfgspecialty.com/peptides) — current ACH/card lanes, published program pricing and customer-checkout restrictions; these are sales-desk claims, not an offer or underwriting decision.
- CERF, [official home](https://thecerf.com/) and [About / role](https://thecerf.com/about/) — its stated French placement-firm role, acquiring-bank network and explicit statement that it does not operate a gateway or process payments.
- Cash App, [current Acceptable Use Policy](https://cash.app/us/en/legal/acceptable-use-policy) — risky-product and unproven-health-product prohibitions apply to business use.
- Venmo, [goods and services acceptance rules](https://help.venmo.com/cs/articles/can-i-use-venmo-to-buy-or-sell-merchandise-goods-or-services-vhel227) and [Business Profiles FAQ](https://help.venmo.com/cs/articles/business-profiles-faq-vhel143) — business acceptance requires explicit authorization.
- Zelle, [Small business FAQ](https://www.zellepay.com/faq/small-business-using-zelle) — business availability depends on the participating bank offering Zelle for that business account type.
- Interac, [Business FAQ](https://www.interac.ca/en/resources/business-resources/business-faq/) — business e-Transfer operates through participating Canadian banks/credit unions.
- BTCPay Server, [general FAQ](https://docs.btcpayserver.org/FAQ/General/) and [deployment methods](https://docs.btcpayserver.org/deployment/deployment/) — self-hosted non-custodial invoicing; technical capability does not create legal or product approval.

- Cash App, [Acceptable Use Policy](https://cash.app/legal/us/en-us/acceptable-use-policy) and [Cash for Business Terms](https://cash.app/legal/us/en-us/cash-for-business-terms) — review prohibited/high-risk activity and business acceptance before relying on an intermediary's Cash App checkout claim.
- Venmo, [Business profiles FAQ](https://help.venmo.com/hc/en-us/articles/360043677874-Business-Profiles-FAQ) and [Online payments](https://help.venmo.com/hc/en-us/articles/360046059274-Paying-on-websites-with-Venmo) — business profiles and authorized online acceptance only.
- Zelle, [Terms of Service](https://www.zellepay.com/legal/user-service-agreement) — service is provided through participating financial institutions; confirm the business account's own bank terms.
- Interac, [Interac e-Transfer terms](https://www.interac.ca/en/terms-of-use/) — transfers are facilitated through participating financial institutions; this is not a worldwide card-acquiring network.
- BTCPay Server, [Documentation](https://docs.btcpayserver.org/) — self-hosted, non-custodial Bitcoin payment infrastructure; technical capability does not confer legal or product approval.
- PeptideApprove, [official peptide merchant page](https://www.peptideapprove.com/) and [FAQ](https://www.peptideapprove.com/faq).
- Ember Services, [official peptides and research page](https://www.emberservices.net/peptides/).
- RFG Specialty Payments, [official peptide payment page](https://rfgspecialty.com/peptides).
- CERF, [official site](https://thecerf.com/) and [about / role](https://thecerf.com/about/).

## Boundaries

No provider has been contacted or approved through this work. No application, merchant agreement, payment integration, live transaction, payment configuration, secret, database, production setting or deployment has been changed. Do not route transactions through unrelated entities, disguise the catalog, or move restricted products to a different rail to evade underwriting.
