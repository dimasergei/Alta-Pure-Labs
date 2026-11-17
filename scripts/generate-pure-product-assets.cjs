'use strict';

// Exact catalog copy, reference-traced PURE artwork, and outlined label type.
// Photographic masters preserve the 1081 × 1455 storefront vial framing.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'assets', 'products-pure');
const { fonts } = require('./label-type/glyphs.json');
const sandbox = {};
vm.runInNewContext(
  fs.readFileSync(path.join(root, 'products.js'), 'utf8') +
  '\n' + fs.readFileSync(path.join(root, 'product-images.js'), 'utf8') +
  '\n;globalThis.catalog = CATALOG;globalThis.images = PRODUCT_IMAGES;',
  sandbox, { timeout: 1000 }
);
const masters = Object.fromEntries(['black', 'black-water'].map(tone => [
  tone,
  'data:image/webp;base64,' + fs.readFileSync(path.join(output, 'masters', tone + '-blank.webp')).toString('base64')
]));
const escape = value => String(value).replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
}[character]));
const round = value => Math.round(value * 10000) / 10000;
const wordmark = fs.readFileSync(path.join(root, 'assets', 'pure-wordmark-vial.svg'), 'utf8');
const wordmarkViewBox = wordmark.match(/viewBox="([^"]+)"/)[1];
const wordmarkPaths = wordmark.replace(/^[\s\S]*?<svg\b[^>]*>/, '').replace(/<\/svg>\s*$/, '')
  .replace(/<(?:title|desc)\b[^>]*>[\s\S]*?<\/(?:title|desc)>/g, '');

function outlinedText(text, { x, y, size, weight = 'regular', maxWidth = Infinity, width, right = false }) {
  const font = fonts[weight];
  const letters = Array.from(text, character => {
    if (!font.glyphs[character]) throw new Error('Missing outlined label character: ' + character);
    return font.glyphs[character];
  });
  const advance = letters.reduce((sum, glyph) => sum + glyph.advance, 0);
  let scale = size / font.unitsPerEm;
  scale = Math.min(scale, maxWidth / advance);
  const scaleX = width ? width / advance : scale;
  const offset = right ? x - advance * scaleX : x;
  let cursor = 0;
  const paths = letters.map(glyph => {
    const svg = glyph.path ? `<path transform="translate(${cursor} 0)" d="${glyph.path}"/>` : '';
    cursor += glyph.advance;
    return svg;
  }).join('');
  return `<g aria-label="${escape(text)}" transform="translate(${round(offset)} ${y}) scale(${round(scaleX)} ${round(-scale)})">${paths}</g>`;
}

function strengthArtwork(size) {
  const parts = size.split('/');
  if (parts.length === 2) {
    return `<g aria-label="${escape(size)}">${outlinedText(parts[0], { x: 757, y: 1088, size: 39, maxWidth: 112, right: true })}${outlinedText('/' + parts[1], { x: 757, y: 1128, size: 39, maxWidth: 112, right: true })}</g>`;
  }
  return outlinedText(size, { x: 757, y: 1118, size: 57, maxWidth: 112, right: true });
}

const records = [];
for (const product of sandbox.catalog) {
  const images = sandbox.images[product.id];
  if (!images) continue; // Needles retain their actual supplier photo.
  for (const variant of product.variants) {
    const source = images[variant.size];
    if (!source) throw new Error('Missing catalog photo mapping: ' + product.id + ' / ' + variant.size);
    const filename = path.basename(source).replace(/\.(?:webp|svg)$/i, '.svg');
    const water = product.id === 'bac-3' || product.id === 'bac-10';
    const tone = water ? 'black-water' : 'black';
    const title = 'PURE ' + product.name + ' ' + variant.size;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1081" height="1455" viewBox="0 0 1081 1455" role="img" aria-labelledby="title description">
<title id="title">${escape(title)}</title>
<desc id="description">${escape(product.name)} ${escape(variant.size)}. Matte black PURE label with white artwork matching the supplied packaging reference. Research use only.</desc>
<image x="0" y="0" width="1081" height="1455" xlink:href="${masters[tone]}"/>
<g fill="#ffffff">
  <svg x="338" y="617" width="415" height="134" viewBox="${wordmarkViewBox}" preserveAspectRatio="none" aria-label="PURE">${wordmarkPaths}</svg>
  ${outlinedText(product.name, { x: 333, y: 1015, size: 72, weight: 'bold', maxWidth: 316 })}
  <g transform="translate(698 949) scale(1.42)" aria-hidden="true">
    <path d="M8 12H16L8 44H0Z M21 1H29L16 54H8Z M31 8H38L29 47H22Z"/>
  </g>
  ${outlinedText('RESEARCH USE ONLY', { x: 334, y: 1108, size: 28, width: 223 })}
  <path d="M598 1070V1122" fill="none" stroke="#ffffff" stroke-width="2.4"/>
  ${strengthArtwork(variant.size)}
</g>
</svg>\n`;
    fs.writeFileSync(path.join(output, filename), svg);
    records.push({ product_id: product.id, name: product.name, size: variant.size, file: 'assets/products-pure/' + filename, label: 'black', contents: water ? 'clear liquid' : 'lyophilized compound' });
  }
}
const mappedCount = Object.values(sandbox.images).reduce((sum, variants) => sum + Object.keys(variants).length, 0);
if (records.length !== mappedCount || records.length !== 83) throw new Error('Catalog image coverage changed: ' + records.length + ' / ' + mappedCount);
fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(records, null, 2) + '\n');
console.log('Generated ' + records.length + ' PURE product labels from the reference artwork. Catalog names and strengths unchanged.');
