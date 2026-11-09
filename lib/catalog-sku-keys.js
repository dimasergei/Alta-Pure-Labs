'use strict';
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const { skuKey } = require('./commerce-eligibility');

// The repository's existing products.js is the authoritative catalog.
// Evaluate only this trusted local source, never user-supplied JavaScript.
function catalogSkuKeys() {
  const source = readFileSync(resolve(__dirname, '../products.js'), 'utf8');
  const sandbox = Object.create(null);
  vm.createContext(sandbox);
  const catalog = vm.runInContext(source + '\nCATALOG', sandbox, { timeout: 1000 });
  if (!Array.isArray(catalog) || catalog.length !== 46) throw new Error('Catalog unavailable.');
  const keys = catalog.flatMap(product => product.variants.map(variant =>
    skuKey(product.id, variant.size)));
  if (keys.length !== 84 || keys.some(key => !key) || new Set(keys).size !== 84)
    throw new Error('Catalog SKU registry invalid.');
  return keys;
}
module.exports = { catalogSkuKeys };
