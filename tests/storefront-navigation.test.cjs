const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const html = readFileSync(resolve(__dirname, "../index.html"), "utf8");
const css = readFileSync(resolve(__dirname, "../styles.css"), "utf8");

test("primary navigation exposes FAQ and targets the real FAQ section", () => {
  const nav = html.match(/<nav class="top-links"[^>]*>[\s\S]*?<\/nav>/);
  assert.ok(nav, "primary navigation exists");
  assert.match(nav[0], /<a href="#faq-section">FAQ<\/a>/);
  assert.doesNotMatch(nav[0], /href="#faq"|>Help<\/a>/);
  assert.match(html, /<section class="faq-section" id="faq-section">/);
});

test("bottom FAQ call-to-action remains centered in source styling", () => {
  assert.match(html, /class="faq-cta faq-cta-centered"/);
  assert.match(css, /\.faq-cta-centered\s*\{\s*text-align:\s*center;/);
  assert.match(css, /\.faq-cta-centered \.pill\s*\{\s*margin-inline:\s*auto;/);
});
