# AltaPure launch work — 11 November 2026 UTC

## What can launch now

Publish factual research-procurement content and collect expressly requested inquiries through the existing contact/bulk forms. The public research-documentation guide explains exact variants, original supplier references, manual order review and request-specific lot COAs. It does not claim instant checkout, merchant approval, inventory, therapeutic effects or a verified shipment lot.

The public analytics loader uses Vercel's existing enabled analytics endpoint. Only allowlisted public paths are measured on altapurelabs.com; query strings and fragments are stripped, custom events are rejected, and account/invoice/payment/tracking pages are excluded. Global Privacy Control and Do Not Track prevent loading. Preview/test traffic is excluded by hostname. This provides aggregate visits, not an attributed purchase-conversion system. No paid analytics add-on or ad pixel is activated.

## Payment activation remains provider-dependent

- Existing NMI code and database migration are deployed. Live NMI credentials and an approved account are absent. Existing successful sandbox sale/decline/refund evidence is not live acceptance.
- PeptideApprove catalog, domain and Google business profile are configured. Hosted checkout is an unpublished draft, not integrated with Supabase orders; wallet buttons do not yet open a payment sheet. Provider technical answers, processor configuration and Google web-integration review remain outstanding.
- Production has PEPTIDEPAY_API_KEY and PEPTIDEPAY_WEBHOOK_SECRET names configured. Current main has no PeptidePay adapter. Presence of these values is not account approval or an integration. PeptidePay describes card-to-crypto on-ramp settlement, not ordinary direct USD merchant acquiring. Written eligibility, upstream merchant-wallet authorization, truthful customer disclosure, fees/refund handling and a safe test/live separation must be resolved before implementing/activating that route. An eligibility/technical inquiry was sent; no charge was attempted.
- PayerURL account authentication remains unresolved; it is not on the critical path for cards.
- The bank-transfer discount code is deployed, but beneficiary/account compatibility and an active, verified receiving method must be confirmed. Do not advertise a working bank rail merely because the discount exists.

## Supplier decision

Continue owner-reviewed manual supplier invoices and fulfillment until a supplier is contracted, its exact variants/stock and costs are confirmed, and a shipment/lot/tracking test passes. Do not substitute products or attach a reference COA as the shipment lot's certificate.

| Candidate | Verified published or emailed facts | Decision |
| --- | --- | --- |
| Rapid Fulfillment | Existing email: no standard setup fee/monthly minimum; custom API available; $1,500 fulfillment deposit plus $1,500 supplier product deposit for their dropship route. Supplier unused balance described as product credit. | Best documented no-membership candidate; not zero upfront cost. Detailed follow-up drafted in existing thread. No contract/deposit accepted. |
| US Wholesale Peptides | Official page: stock dropship, white label, API/webhooks, no minimum monthly spend; personal onboarding usually 1–2 weeks; early-stage sellers may not fit standalone fulfillment. | Ask explicitly about membership/setup/deposits and startup eligibility. Draft prepared; no credentials or contract available. |
| LabShipped | Official pricing: $149/month plus products/fulfillment/shipping. | Does not meet no-membership requirement. |
| YourPeptideBrand | Current homepage lists Core $297/month and Premier $497/month. One older article mentions a free tier, conflicting with current plans. | Not a verified free white-label option. |
| Europe Peptides | Advertises no subscription with EU/UK fulfillment. | Not a verified immediate US fulfillment solution. |
| Lotus partner program | $0/month during launch, later plans start $399/month; hosted storefront offering. | Temporary free offer, not a permanent no-membership custom-store match. |

Sources checked: https://rapidfulfillment.com/pages/pricing ; existing Rapid email dated 7 November 2026; https://uswholesalepeptides.com/fulfillment ; https://labshipped.com/pricing ; https://yourpeptidebrand.com/ ; https://europepeptides.eu/ ; https://partners.lotuspeptide.com/ . Supplier claims are not independent quality verification.

## First seven marketing days

1. Publish the documentation guide; verify public metadata, sitemap, mobile readability and analytics receipt. Keep the current catalog and prices.
2. Add the guide URL to the owner's existing business profiles. Draft copy: “Review the product. Check the report. Browse exact catalog variants and original supplier reference COAs at AltaPure Labs. Request documentation for your proposed research order before payment. Laboratory research only.”
3. Publish a documentation explainer: “A report for the same compound is not automatically a report for the lot shipped. Match product, strength, batch and report client. Our guide explains what to request.” Link to /research-documentation.html.
4. Publish a procurement explainer: “Preparing a laboratory order? Send the exact variant, quantity, destination and documentation requirements. We review availability and shipping before issuing an invoice.” Link to /bulk-orders.
5. Respond to genuine inbound research inquiries. Do not upload customer lists, scrape contacts, send bulk marketing or run abandoned-cart messages without the required consent and suppression workflow.
6. Review aggregate public-page traffic, genuine inquiries and verified paid orders separately. Existing paid Stripe test sessions must not count as revenue. Maintain a source log for manually handled inquiries until purchase attribution is implemented.
7. Compare supplier landed cost, processing cost, shipping subsidy, refund/loss allowance and actual acquisition cost. Revise the forecast after 20 genuine orders or 30 days; this is a work plan, not a scheduled automation.

No public social posts or marketing emails were sent by this change. No ad campaign or ad spend was launched. Destination and account eligibility need review before paid ads: Google restricts promotion of unapproved substances, and an RUO label alone does not establish advertising eligibility. Source: https://support.google.com/adspolicy/answer/15595718 .

## Budget and measurement

Initial paid-ad budget is $0 until the owner supplies a cap, the channel accepts the destination/catalog, a live payment/refund test succeeds and fulfillment costs are known. Do not budget against gross revenue as profit. Maximum allowable acquisition cost equals captured sales less discounts, landed supplier/fulfillment costs, processing fees, shipping subsidy, expected loss/refund cost and required contribution margin.

Forecast sent to Robert and PaymentCloud: USD 2,000 gross card volume in the first full operating month, provisional USD 500–5,000 range, with possible lower/zero results. Assumptions: 2,000 qualified visits × 1.25% paid conversion × 80% card/wallet share × USD 100 captured average order. These are unvalidated assumptions, not sales history.

## Owner-only or external actions

- Processor supplies written eligibility/terms, secure KYB steps, live credentials and wallet setup. Owner provides identity/business/bank evidence and decides on commercial terms.
- Owner verifies the receiving bank account's legal beneficiary and its acceptance for XYZ Holdings LLC.
- Supplier supplies its final terms, SKU costs, lot documentation and API/sandbox access; owner accepts any deposits or contracts.
- Vercel team is still Hobby. Its official plan restricts commercial use; owner must upgrade to a commercial plan or choose a migration. No subscription was purchased. Source: https://vercel.com/docs/plans/hobby .
- Paid marketing needs a specific budget and supported account/channel. Research-use positioning must match actual customers and content; no health/dosing testimonials or policy evasion.
