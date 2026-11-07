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
    "85dcef2ef7794871cc73027f307c2df23df0cd7e6f84d4e1e06265c231a6cad4"
  );
});

test("all 55 products and 93 variants remain available", () => {
  assert.equal(catalog.length, 55);
  assert.equal(catalog.reduce((sum, product) => sum + product.variants.length, 0), 93);
  assert.equal(new Set(catalog.map((product) => product.id)).size, 55);
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
