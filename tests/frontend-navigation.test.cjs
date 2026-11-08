const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const read = (path) => readFileSync(resolve(__dirname, "..", path), "utf8");

test("storefront header orders search, account, then cart", () => {
  const header = read("index.html").match(/<header class="topbar">([\s\S]*?)<\/header>/)?.[1];
  assert.ok(header, "topbar exists");
  const search = header.indexOf('id="open-search"');
  const account = header.indexOf('href="/account"');
  const cart = header.indexOf('id="open-cart"');
  assert.ok(search >= 0 && account > search && cart > account);
});

test("storefront account link is an accessible person-outline icon", () => {
  const html = read("index.html");
  assert.match(html, /<a href="\/account" class="icon-btn account-icon" aria-label="Account"/);
  assert.doesNotMatch(html, /<a href="\/account">Account<\/a>/);
});

test("account page retains its accessible account icon", () => {
  assert.match(read("account.html"), /class="icon-btn account-icon" aria-label="Account"/);
});

test("responsive header supports wrapping and horizontally scrollable navigation", () => {
  const css = read("styles.css");
  assert.match(css, /@media\s*\(max-width:\s*860px\)[\s\S]*?\.topbar\s*\{[\s\S]*?flex-wrap:\s*wrap/);
  assert.match(css, /\.top-links\s*\{[\s\S]*?overflow-x:\s*auto/);
  assert.match(css, /\.account-icon:focus-visible\s*\{[\s\S]*?outline:/);
});

test("account formatter loads before account application code", () => {
  const html = read("account.html");
  assert.ok(html.indexOf("/account-format.js") >= 0);
  assert.ok(html.indexOf("/account-format.js") < html.indexOf("/account.js"));
});
