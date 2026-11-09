# Promotions engine — first implementation

The new `lib/promotion-pricing.js` provides deterministic **simulation only** for percent, fixed-amount and buy-X-get-Y offers. It is not wired to checkout, customer accounts, memberships, bulk orders, database or live storefront pricing. No campaign is configured or enabled.

- Input prices are server-validated USD cents in future integrations.
- Promotions require explicit `approved:true`, `enabled:true` and a current start/end interval.
- The highest eligible discount wins; **no stacking** until a reviewed policy is implemented.
- Duplicate SKUs, invalid quantities, negative prices and unsafe totals are rejected.
- Quotes always return `checkout_allowed:false`; this module never authorizes payment.
- Taxes, duties, shipping, memberships, rewards, coupons, refunds, returns and margin controls are out of scope.
- Future promotion eligibility must include product/customer/destination/legal restrictions, inventory availability, redemption limits and fraud controls.
- Do not adopt NeuroLabs discount rates, BOGO rules or free shipping without margin and compliance review.

Next milestone: add an admin-managed promotion rules registry and server-side simulation API on a separate review branch, with migrations tested on disposable databases. No production discounts or checkout reactivation without separate approval.
