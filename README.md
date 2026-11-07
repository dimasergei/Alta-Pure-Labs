# AltaPure Labs

A static, responsive research catalog using plain HTML, CSS and JavaScript. The reference-led redesign uses a dark full-width hero, white product showcases, large typography and alternating editorial feature panels.

## Run locally

Serve this directory with any static web server, for example:

```sh
npx serve . -l 3000
```

Open `http://localhost:3000`. There is no build step or framework dependency.

## Catalog and branding

`products.js` remains unchanged from the original repository. It contains 55 products and 93 size/price variants, including the original pricing multiplier. Do not edit prices in the UI templates.

The original three-bar logo and wordmark are retained, using the existing light treatment on the dark header and footer. Generated still lifes are conceptual illustrations, not actual packaging photographs; this is disclosed in the footer.

## Behavior

- Session-based adult/research-use gate.
- Search, ten category tabs, name/price sorting and progressive product display.
- Product dialogs with every available size and price.
- Local cart with quantity changes and browser persistence.
- Local-only request summary with required research confirmation.
- Accessible native dialogs, keyboard focus states, FAQ disclosures and reduced-motion support.

This site does not send orders, process payments or contact a fulfillment service. The confirmation explicitly states that no order was sent.

## Regression checks

Run the dependency-free catalog checks:

```sh
node --test tests/catalog.test.cjs
```

Browser QA covered desktop, tablet and narrow phone layouts; age acceptance and rejection; navigation; all categories; empty and matching searches; both price sort directions; loading all products; product variants; cart increment/decrement/persistence; local summary completion; empty cart; FAQ disclosure; Escape and close controls.

## Deployment

Serve `index.html`, `styles.css`, `products.js`, `app.js` and `assets/*.webp`. Generated source PNG files, tests and local design-inspection metadata are not needed in the deployed site.
