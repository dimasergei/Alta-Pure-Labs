const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const html = readFileSync(resolve(__dirname, "../index.html"), "utf8");
const locale = readFileSync(resolve(__dirname, "../locale.js"), "utf8");
const app = readFileSync(resolve(__dirname, "../app.js"), "utf8");
const css = readFileSync(resolve(__dirname, "../styles.css"), "utf8");

test("storefront exposes currency and language selectors in the header", () => {
  for (const id of ["currency-select", "language-select", "currency-status"]) assert.match(html, new RegExp('id="' + id + '"'));
  for (const currency of ["USD", "CAD", "EUR", "GBP", "AUD"]) assert.match(html, new RegExp('value="' + currency + '"'));
  for (const language of ["en", "fr", "es"]) assert.match(html, new RegExp('value="' + language + '"'));
  assert.match(html, /id="currency-status"[^>]*aria-live="polite"/);
});

test("currency conversion uses live USD-based rates and safely falls back to USD", () => {
  assert.match(locale, /api\.frankfurter\.dev\/v1\/latest\?base=USD/);
  assert.match(locale, /rates = \{USD:1\}/);
  assert.match(locale, /checkout currency USD/);
  assert.match(locale, /ap-currency/);
  assert.match(locale, /ap-language/);
});

test("English, French, and Spanish translations cover the shopping interface", () => {
  for (const key of ["en:", "fr:", "es:", "researchCatalog:", "cartEmpty:", "subtotal:", "placeRequest:"]) assert.ok(locale.includes(key), "missing locale key: " + key);
  assert.match(html, /data-i18n="heroDescription"/);
  assert.match(html, /data-i18n="researchConfirmation"/);
});

test("catalog and cart amounts use display formatting while catalog prices remain unchanged", () => {
  assert.match(app, /window\.AltaLocale\.formatMoney\(n\)/);
  assert.match(app, /window\.AltaLocale\.onChange/);
  assert.match(app, /displayCurrencyNote/);
  assert.match(app, /price: variant\.price/);
});

test("locale controls have responsive styling", () => {
  assert.match(css, /\.locale-controls/);
  assert.match(css, /@media \(max-width:700px\)/);
});
