# Reference storefront release — 11 November 2026

## Scope
Customer-facing structure rebuilt against the current NeuroLabs homepage, shop, product, membership, research-builder and bulk-order pages. AltaPure branding and catalog remain. New structure includes sale strip, large gradient hero, floating branded products, five-column cards, carousel, category pills, compact product pricing/options, membership panels, COA report cards, application/contact forms, account sidebar and focused checkout styling. Existing cart, authentication, customer ownership, payment/refund, points, credit, manual fulfillment and historical Stripe behavior are retained.

## Promotion behavior
New direct checkout uses version `checkout-2026-11-v2`. Every second unit of the same product/size is free; quantities are the actual units to fulfill. Card add-to-cart adds two units and states this. Product quantity defaults to two and remains editable. The better of BOGO and existing membership/volume savings applies per line. Coupon `BOGO` adds 10% off the remainder; active bank-transfer checkout adds 5% afterward. Points/credit follow discounts. Membership purchases and shipping are excluded. Integer-cent rounding is downward per line. Catalog base prices and accepted historical orders are untouched. Sale terms are published at `/sale-terms.html`.

## Database / rollout
Apply `20261111070511_checkout_promotion_version.sql` before deploying. It changes only the allowed checkout versions in the existing private service RPC, retains v1 for rollback, and explicitly preserves service-role/postgres access while denying browser roles. No orders, balances, receiving instructions or gateway accounts are changed. The previous production deployment is `dpl_4NbDU3qYbXNkpmd3Woqcw5KfA4pf` (main `61cdbd5b3f76d30da4d6d95c723af6565bb43f08`).

## Payment activation evidence
Supabase checked live: direct-checkout balance migration applied, zero `commerce_gateway_accounts`, bank transfer active in USD, Interac retained but inactive in CAD. PeptideApprove's setup checklist is not proof of payment activation: its only initial route was the inactive sandbox. A separate NMI configuration is prepared, explicitly disabled in test mode, with no API key and no assignment to live routing. Actual live NMI merchant credentials/catalog approval and provider tests are still required. No real charges or processor fees/contracts were approved.

Robert's latest proposal is card-to-crypto at 8.5%, including first-payment ID verification; standard card processing and Apple/Google Pay are not confirmed live. The existing clarification email remains a draft. PeptidePay has not answered the existing activation thread. PayerURL remains unavailable. Do not display those routes as live.

## Intentional factual differences from the reference
No invented purity percentages, test counts, sales volume, reviews, supplier inventory, express delivery, packaging gifts, monthly subscriptions, affiliate commission promises, gift-card balances or spin-wheel winnings. Actual annual memberships, rewards/credit and supplier-reference COAs retain their current terms and attribution. Exact fulfilled-lot COAs remain supplier-dependent. A visual match cannot supply merchant approval or fulfillment capabilities.

## Verification
264 unit tests pass before generated outputs; build output checks and isolated account/navigation/reference DOM workflows pass. Database v1/v2 acceptance, snapshot preservation, replay and permissions are covered by the disposable PostgreSQL CI fixture. Browser and deployment verification results are recorded in the PR after preview review.
