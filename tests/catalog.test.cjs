const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { createHash } = require("node:crypto");
const vm = require("node:vm");

const source = readFileSync(resolve(__dirname, "../products.js"), "utf8");
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(`${source}; globalThis.catalog = CATALOG; globalThis.groups = GROUPS;`, sandbox);
const { catalog, groups } = sandbox;

test("original catalog, descriptions, sizes and pricing are byte-identical", () => {
  assert.equal(
    createHash("sha256").update(source).digest("hex"),
    "683c78e7a39e1c75d20a32bba52ce27f9a372d9a8a89eba9b2ebd97f024b7f50"
  );
});

test("current products and variants remain unique and valid", () => {
  assert.equal(catalog.length, 46);
  assert.equal(catalog.reduce((sum, product) => sum + product.variants.length, 0), 78);
  assert.equal(new Set(catalog.map((product) => product.id)).size, 46);
  for (const product of catalog) {
    assert.ok(groups.includes(product.group), product.name);
    for (const variant of product.variants) {
      assert.ok(variant.size);
      assert.ok(Number.isFinite(variant.price) && variant.price > 0);
    }
  }
});

test("featured and spotlight entries keep their original minimum prices", () => {
  for (const [id, expected] of [["retatrutide", 66], ["tirzepatide", 60], ["semaglutide", 63], ["bpc-157", 51]]) {
    const product = catalog.find((item) => item.id === id);
    assert.equal(Math.min(...product.variants.map((variant) => variant.price)), expected);
  }
});

test("every category has a unique card background and every vial uses the original brand asset", () => {
  const app = readFileSync(resolve(__dirname, "../app.js"), "utf8").replace(/\binit\(\);\s*$/, "");
  vm.runInContext(`${app}; globalThis.cardMarkup = productCardMarkup; globalThis.productSvg = vialSvg;`, sandbox);
  const css = readFileSync(resolve(__dirname, "../styles.css"), "utf8");
  const colors = new Set();
  for (const group of groups.filter((group) => group !== "All")) {
    const rule = `.card[data-group="${group}"]`;
    assert.ok(css.includes(rule), `Missing background for ${group}`);
    const color = css.slice(css.indexOf(rule)).match(/--card-bg:\s*(#[a-f0-9]+)/)[1];
    colors.add(color);
  }
  assert.equal(colors.size, 8);
  for (const product of catalog) {
    const svg = sandbox.productSvg(product);
    const logos = svg.match(/class="vial-brand"/g) || [];
    assert.equal(logos.length, product.variants.length > 1 ? 2 : 1, product.id);
    assert.ok(svg.includes('href="assets/brand-label.webp"'));
    assert.ok(sandbox.cardMarkup(product).includes(`data-group="${product.group.replaceAll("&", "&amp;")}"`));
  }
  assert.ok(readFileSync(resolve(__dirname, "../assets/brand-label.webp")).length > 0);
});
