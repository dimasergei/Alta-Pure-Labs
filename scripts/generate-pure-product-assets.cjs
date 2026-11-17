'use strict';

// Rebuild exact catalog labels over the two imagegen-created photographic masters.
// Masters retain the original 1081 × 1455 framing used by the storefront vial clip.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'assets', 'products-pure');
const sandbox = {};
vm.runInNewContext(
  fs.readFileSync(path.join(root, 'products.js'), 'utf8') +
  '\n' + fs.readFileSync(path.join(root, 'product-images.js'), 'utf8') +
  '\n;globalThis.catalog = CATALOG;globalThis.images = PRODUCT_IMAGES;',
  sandbox,
  { timeout: 1000 }
);
const masters = Object.fromEntries(['black', 'white'].map(tone => [
  tone,
  'data:image/webp;base64,' + fs.readFileSync(path.join(output, 'masters', tone + '-blank.webp')).toString('base64')
]));
const escape = value => String(value).replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
}[character]));
const records = [];
for (const product of sandbox.catalog) {
  const images = sandbox.images[product.id];
  if (!images) continue; // Needles retain the existing supplier photo.
  for (const variant of product.variants) {
    const source = images[variant.size];
    if (!source) throw new Error('Missing catalog photo mapping: ' + product.id + ' / ' + variant.size);
    const filename = path.basename(source).replace(/\.(?:webp|svg)$/i, '.svg');
    const whiteLabel = product.id === 'bac-3' || product.id === 'bac-10';
    const tone = whiteLabel ? 'white' : 'black';
    const ink = whiteLabel ? '#111111' : '#ffffff';
    const nameSize = product.name.length > 12 ? 44 : 54;
    const title = 'PURE Labs ' + product.name + ' ' + variant.size;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1081" height="1455" viewBox="0 0 1081 1455" role="img" aria-labelledby="title description">
<title id="title">${escape(title)}</title>
<desc id="description">${escape(product.name)} ${escape(variant.size)} with a flat ${whiteLabel ? 'white' : 'black'} PURE Labs label. Research use only.</desc>
<image x="0" y="0" width="1081" height="1455" xlink:href="${masters[tone]}"/>
<g fill="${ink}" font-family="Arial, Helvetica, sans-serif">
  <text x="338" y="690" font-size="108" font-weight="800" letter-spacing="-2">PURE</text>
  <text x="342" y="735" font-size="27" font-weight="700" letter-spacing="6">LABS</text>
  <g transform="translate(654 610) scale(.75)" aria-hidden="true">
    <path d="M0 45H21L8 91H-13Z M27 21H48L28 108H7Z M54 32H75L60 96H39Z"/>
  </g>
  <text x="340" y="981" font-size="${nameSize}" font-weight="700">${escape(product.name)}</text>
  <text x="340" y="1044" font-size="42" font-weight="400">${escape(variant.size)}</text>
  <text x="340" y="1137" font-size="25" font-weight="400" letter-spacing=".6">RESEARCH USE ONLY</text>
</g>
</svg>\n`;
    fs.writeFileSync(path.join(output, filename), svg);
    records.push({ product_id: product.id, name: product.name, size: variant.size, file: 'assets/products-pure/' + filename, label: tone });
  }
}
const mappedCount = Object.values(sandbox.images).reduce((sum, variants) => sum + Object.keys(variants).length, 0);
if (records.length !== mappedCount || records.length !== 83) throw new Error('Catalog image coverage changed: ' + records.length + ' / ' + mappedCount);
fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(records, null, 2) + '\n');
console.log('Generated ' + records.length + ' exact PURE Labs product labels. Product names and strengths come from products.js.');
