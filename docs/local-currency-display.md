# PURE local-currency display

## Customer experience

The storefront starts in **Automatic** mode. A same-origin request uses Vercel's country hint to suggest a supported local currency. Customers can choose Automatic or a specific currency under **More → Display currency**. An explicit choice persists across pages and takes priority over later country responses. Previously saved manual choices, including USD, remain respected.

Product cards, product details, bulk-order prices, AUTO-STACK™ estimates, membership fees, and cart estimates share the same conversion layer. Changes update price fragments in place without resetting quantities, selected strengths, search filters, coupons, membership intervals, or saved selections.

Converted amounts show an approximation mark and an unambiguous currency code. The selector shows the reference-rate date. The original USD amount remains available in the price's accessible label and tooltip. A short caption explains the USD basis. Currency formatting follows the chosen language and the currency's normal minor units, including zero decimal places for JPY.

## Price and payment boundaries

- Catalog prices and program quotes remain canonical USD amounts. Marked prices store their original integer USD cents in `data-usd-cents`; conversions always derive from those cents.
- The country hint is used only for presentation. It does not change a customer's shipping address, shipping-country selection, payment eligibility, taxes, discounts, authentication, or account data.
- Cart and checkout requests retain their existing USD product amounts. Display-currency changes do not request new financial quotes.
- Actual payment totals, provider requests, historical account transactions, and wallet authorization amounts remain in their original payment currency. They are never selected by the display-price updater.
- Interac continues to use its separate validated, signed CAD quote based on Bank of Canada rates. A storefront CAD estimate is not a replacement for the exact Interac amount.
- Points, credit values, and benefit thresholds retain explicit US-dollar labels because those are contractual values.

This release does not connect recurring payments. Monthly AUTO-STACK™ enrollment remains unavailable until the payment provider's recurring mandate, billing, update, cancellation, and event flow can be verified. Current membership purchases retain their existing prepaid behavior.

## Supported currencies and country fallback

`config/display-currencies.json` is the shared server/build allowlist. It currently contains 30 currencies:

USD, CAD, EUR, GBP, AUD, BRL, CHF, CNY, CZK, DKK, HKD, HUF, IDR, ILS, INR, ISK, JPY, KRW, MXN, MYR, NOK, NZD, PHP, PLN, RON, SEK, SGD, THB, TRY, ZAR.

Unknown countries and countries whose primary local currency is outside this list fall back to USD. Automatic detection is approximate, so a manual selector is always available. No browser location permission, precise location, IP storage, or customer identity is required by this feature.

## API and rate lifecycle

The existing customer-config function dispatches two public, read-only routes:

| Route | Result | Cache behavior |
| --- | --- | --- |
| `/api/customer-config?display_locale=country` | Country hint, suggested currency, supported currencies | Private, no-store |
| `/api/customer-config?display_locale=rates` | Validated USD reference rates, source date, fetch/expiry timestamps | Fresh responses: up to 60 seconds browser / 1 hour shared, bounded by expiry; fallback responses: no-store |

Rates come from the European Central Bank feed through Frankfurter's provider-specific v2 endpoint. Country information and request identity are not forwarded to the rate provider. The backend validates the complete allowlist, USD base, unique currencies, finite positive rates, a single valid observation date, and bounded response size. Provider requests have an 8-second timeout and reject redirects.

An instance deduplicates concurrent rate requests and keeps verified rates for one hour. A provider failure may use the last verified snapshot for at most 24 hours from the original fetch, with short expiries and an explicit cached-rate date. Observation dates older than seven days are rejected, including during fallback. A cold failure, invalid payload, or expired snapshot displays USD. The selected preference is preserved so that a later successful refresh can restore the requested currency.

The browser checks rate metadata and expiry independently. An expiry timer removes expired conversions and attempts a refresh; returning to a visible page retries if necessary. Late network responses cannot change a customer's manual choice. The DOM updater matches only explicit price, code, and note markers; it does not replace page roots or checkout totals.

## Implementation and verification

Core files: `locale.js`, `pure-currency.css`, `lib/display-fx.js`, `lib/display-locale.js`, `config/display-currencies.json`. Build publication versions the core and all annotated storefront/program assets together.

Focused tests cover country mapping, private country caching, shared rate caching, provider validation, stale/failure behavior, manual-choice migration, delayed responses, expiry, dynamic price fragments, zero-minor-unit rounding, DOM/focus preservation, and the unchanged USD checkout boundary. Integration suites exercise product quantity/strength selection, bulk drafts, cart coupons and wallet totals, membership intervals, and AUTO-STACK™ selections and enrollment gates.

Release checks use `npm test`, `npm run build`, `npm run test:account-dom`, and `node tests/pure-customer-pages-audit.cjs`, followed by live desktop and narrow-layout checks. No payment is submitted during verification.

## Primary references

- [Frankfurter API documentation](https://frankfurter.dev/)
- [ECB reference exchange rates](https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html)
- [ECB euro introduction and membership](https://www.ecb.europa.eu/euro/intro/html/index.en.html)
- [Unicode CLDR currency data](https://github.com/unicode-org/cldr-json/tree/main/cldr-json/cldr-core/supplemental)
