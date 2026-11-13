'use strict';
// Intentionally RED against baseline 2099485. Opt-in specification tests:
// node --test tests/checkout-parity/contracts.test.cjs
// These are NOT imported by npm test; they gate a future refactor PR.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');

const checkout=read('checkout-reference.js');
const cart=read('cart-reference.js');
const checkoutCss=read('checkout-reference.css');
const cartCss=read('cart-reference.css');

test('PAR-01: cart has a separately scrollable product body and an anchored checkout footer',()=>{
 assert.match(cart,/(?:class|data-[\w-]+)=["'][^"']*(?:cart__body|nlc-scrollable-items)/,
  'Introduce an explicit product-scroll region; do not put all content inside the scrolling root.');
 assert.match(cartCss,/(?:cart__body|nlc-scrollable-items)\s*\{[^}]*min-height\s*:\s*0[^}]*overflow-y\s*:\s*auto/s,
  'Products/recommendations must have overflow-y:auto and min-height:0.');
 assert.match(cartCss,/(?:cart__checkout|nlc-cart-checkout)\s*\{[^}]*(?:flex\s*:\s*none|flex-shrink\s*:\s*0)/s,
  'Bottom coupon, total, CTA and wallets must not shrink away or scroll with products.');
 assert.doesNotMatch(cartCss,/#ap-cart-content\s*\{[^}]*overflow\s*:\s*auto/s,
  'Root must not scroll the footer out of view.');
});

test('PAR-02: protection help is a real inline disclosure with no diamond placeholder',()=>{
 assert.doesNotMatch(checkout, /♢/, 'Replace text diamond with an approved icon.');
 assert.doesNotMatch(checkout, /href=["']\/shipping-protection\.html["']\s+target=/,
  'Read more must not navigate away from checkout.');
 assert.match(checkout, /aria-expanded|data-nlx-accordion/,
  'Disclosure button needs an expandable state.');
 assert.match(checkout, /aria-controls|data-nlx-panel/,
  'Disclosure button needs its own panel.');
});

test('PAR-03: Priority and Cold Chain explain inline without window.alert',()=>{
 assert.doesNotMatch(checkout, /window\.alert\(/,
  'Blocking browser alerts interrupt checkout; replace with inline accordions.');
 assert.match(checkout, /data-nlx-info/);
 assert.match(checkout, /aria-expanded/);
});

test('PAR-04: member activation is not recursively dispatched through the overwritten checkout handler',()=>{
 const original=checkout.includes('const original=window.DirectCheckout?.checkout;');
 const replacement=checkout.includes('current.checkout=checkout;');
 assert.ok(!(original&&replacement),
  'The saved original handler is obtained inside its replacement; preserve original handler BEFORE overriding it.');
 assert.match(checkout, /\/memberships|\/account\/membership|membershipCheckout/,
  'Membership activation must go to a verified functional membership flow.');
});

test('PAR-05: points incentive links to memberships and uses an actual accessible sparkle icon',()=>{
 assert.match(checkout, /href=["']\/memberships["']/,
  'Earn more must lead to /memberships, not /account/points.');
 assert.doesNotMatch(checkout, /<span>✧\s*/,
  'Use an SVG/icon, not a raw text sparkle.');
 assert.match(checkout, /sparkles|data-icon=["']sparkles["']/);
});

test('PAR-06: payment brand marks are sanctioned image/icon assets or provider-owned',()=>{
 assert.doesNotMatch(checkout, /\['mastercard','●●'\]/,
  'Two circles are not the Mastercard brand logo.');
 assert.doesNotMatch(checkout, /\['amex','AMERICAN EXPRESS'\]/,
  'Plain text is not an authentic Amex payment mark.');
 assert.match(checkout, /<img|<svg|providerBrand|paymentBrandIcon/,
  'Use proper image/SVG/provider marks with alt labels; no brand-mimicking text spans.');
});

test('PAR-07: wallet control has one real provider owner and avoids duplicate permanently disabled placeholders',()=>{
 assert.doesNotMatch(checkout,
  /class="nlx-wallet-button"\s+disabled/,
  'Do not keep a permanently disabled imitation above a separate provider wallet widget.');
 assert.match(checkout, /Alt[aA]NmiInline|PaymentRequest/,
  'Live wallet rendering belongs to the authorized processor; gate by readiness.');
});

test('PAR-08: optional paid services do not carry into unrelated orders',()=>{
 assert.doesNotMatch(checkout,/localStorage\.getItem\('ap-shipping-extras'\)/,
  'Do not silently restore extras from a previous unrelated checkout.');
 assert.doesNotMatch(cart,/localStorage\.getItem\('ap-shipping-extras'\)/,
  'Do not silently preselect stale extras when a new cart is created.');
});

test('PAR-09: branded checkout uses one actually loaded font family',()=>{
 const fonts=checkoutCss.match(/\.nlx-checkout-root\s*\{[^}]*font-family\s*:\s*([^;}]+)/);
 assert.ok(fonts);
 assert.doesNotMatch(fonts[1], /Plus Jakarta Sans/,
  'The checkout declares Plus Jakarta Sans but its loaded font is Poppins.');
 assert.match(fonts[1], /Poppins/);
});

test('PAR-10: estimated dates and cutoff are sourced, not fabricated',()=>{
 const deliveryApi=path.join(root,'lib/delivery-estimates.js');
 assert.ok(fs.existsSync(deliveryApi),
  'Implement validated carrier/dispatch estimate adapter, or show no unsupported dates.');
 const src=fs.readFileSync(deliveryApi,'utf8');
 assert.match(src,/cutoffAtISO/);
 assert.match(src,/estimatedFromISO/);
 assert.match(src,/timezone/);
 assert.match(src,/source/);
});

test('PAR-11: compact shipping summary includes an actionable in-page cross-sell',()=>{
 assert.match(checkout,/Researchers also bought|Recommended for your research|data-nlx-cross-sell/,
  'Show actual eligible product suggestions on shipping step.');
 assert.match(checkout,/data-nlx-cross-sell-add|addItems/,
  'The add buttons must update cart and server quote, not merely decorate the page.');
});

test('PAR-12: CTA semantics remain explicit, with a single payment submit',()=>{
 assert.match(checkoutCss,/\.nlx-primary\s*\{[^}]*background\s*:\s*#08090c/s);
 assert.match(checkoutCss,/\.nlx-primary\s*\{[^}]*color\s*:\s*white/s);
 assert.match(checkout,/card checkout awaiting activation/i,
  'When the merchant is not approved, do not misrepresent a live place-order control.');
 assert.match(checkout,/data-nlx-place/);
});
