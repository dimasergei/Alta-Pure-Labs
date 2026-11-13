# Checkout v2 acceptance harness (opt-in / red baseline)

These tests turn the benchmark audit into executable requirements **before implementation**. They are on a separate planning branch, outside the default \`tests/*.test.cjs\` pattern and do not change the storefront, provider configuration, database, or any production order.

## Baseline

- Source: AltaPure Labs production commit \`2099485c8ccb23289ba473f41685c71628f72acd\`.
- Reference: user-supplied screenshots of NeuroLabs and AltaPure on November 13, 2026, captured at 2047×1331 image pixels.
- Reference assets are **not** committed to GitHub: some show identifiable customer details and competitor branding.
- Test inputs in \`fixture.html\` use synthetic customer information and local browser mocks. All external checkout APIs are intercepted; the server only serves allowlisted files and never proxies requests.

## Running the read-only source contracts

\`\`\`sh
npm ci
node --test tests/checkout-parity/contracts.test.cjs
\`\`\`

Several tests are **expected to fail** until the corresponding refactor is implemented. This is useful evidence of the missing features, not a failed production build. Do not add them to \`npm test\` until the v2 implementation passes.

## Running local browser geometry and screenshots

\`\`\`sh
npm ci
npm install --no-save --no-package-lock @playwright/test
npx playwright install chromium
npx playwright test --config=tests/checkout-parity/playwright.config.cjs
\`\`\`

The suite starts a local read-only server on \`127.0.0.1:43183\`. It renders the real \`checkout-reference.js\` and \`cart-reference.js\` against local fixture data and CSS. It checks independently scrolling cart products, anchored footer, compact checkout geometry, button contrast, inline disclosures, points/membership routing, cards and wallets, desktop and mobile overflow. Captures are attached to \`test-results/checkout-parity-report\` and are **not** checked in.

A screenshot-only run (for visual review before passing tests):

\`\`\`sh
npx playwright test --config=tests/checkout-parity/playwright.config.cjs --reporter=list
\`\`\`

The benchmark images are *not* automatic pixel goldens; no exact screenshot-diff threshold can be legitimate without matched content, viewport, zoom, DPR and approved redacted baseline assets. Compare local artifacts manually with the user-provided reference, or establish future goldens after designer approval. Never run \`--update-snapshots\` to bless a broken baseline.

## Required selectors in the implementation

- \`data-testid="cart-product-scroll"\`: scrollable product / recommendation area.
- \`data-testid="cart-fixed-footer"\`: coupon, totals, checkout and wallet area.
- \`data-testid="protection-disclosure"\` and \`data-testid="protection-disclosure-panel"\`.
- \`data-testid="priority-disclosure"\`, \`data-testid="priority-disclosure-panel"\`.
- \`data-testid="cold-chain-disclosure"\`, \`data-testid="cold-chain-disclosure-panel"\`.
- \`data-testid="membership-activate"\`.

Each disclosure button must have \`aria-expanded\` and \`aria-controls\`, and no external navigation or browser \`alert\` on click.

## Definition of passing

- Existing \`npm test\`, \`npm run build\`, and \`npm run test:account-dom\` remain green.
- All opt-in source and visual tests become green after P0/P1 refactor work.
- Screenshot comparisons at desktop, tablet and mobile are reviewed and approved.
- No accidental shipping fees, duplicate checkout orders, unreachable membership routes, fabricated delivery ETA, or fake payment acceptance.
- Preview deployed only after passing tests; production only after separate user approval.
