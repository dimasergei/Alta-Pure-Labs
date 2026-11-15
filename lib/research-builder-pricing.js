'use strict';

// A quote is a price preview, never a subscription or permission to charge.
const fs = require('node:fs');
const path = require('node:path');

function quote(lines, catalog) {
  if (!Array.isArray(lines) || lines.length !== 4) throw Error('Select exactly four different compounds.');
  const selected = [];
  const seen = new Set();
  for (const line of lines) {
    if (!line || typeof line.id !== 'string' || typeof line.size !== 'string' || seen.has(line.id))
      throw Error('Select four different compounds.');
    const product = catalog.find(p => p.id === line.id);
    const variant = product?.variants.find(v => v.size === line.size);
    if (!variant || product.category !== 'injectables' || line.qty !== 1)
      throw Error('A selected compound or size is unavailable for the builder.');
    seen.add(line.id);
    const retail_cents = Math.round(variant.price * 100);
    selected.push({ id: product.id, name: product.name, size: variant.size, retail_cents,
      monthly_cents: retail_cents - Math.floor(retail_cents * 4000 / 10000) });
  }
  const retail_cents = selected.reduce((sum, x) => sum + x.retail_cents, 0);
  const discount_cents = selected.reduce((sum, x) => sum + x.retail_cents - x.monthly_cents, 0);
  return { lines: selected, retail_cents, discount_cents, monthly_cents: retail_cents - discount_cents,
    shipping_cents: 0, bundled: { id: 'bac-3', name: 'BAC Water 3ML', monthly_cents: 0 },
    currency: 'USD', estimate: true, subscription_available: false };
}

function catalog() { return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'lib/catalog.json'), 'utf8')); }
module.exports = { quote, catalog };
