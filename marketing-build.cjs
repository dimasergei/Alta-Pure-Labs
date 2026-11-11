'use strict';
const fs = require('node:fs');
const path = require('node:path');
const out = path.join(process.cwd(), 'public-build');
const guide = '/research-documentation.html';
let sitemap = fs.readFileSync(path.join(out, 'sitemap.xml'), 'utf8');
if (!sitemap.includes(guide)) sitemap = sitemap.replace('</urlset>', '<url><loc>https://altapurelabs.com' + guide + '</loc></url></urlset>');
fs.writeFileSync(path.join(out, 'sitemap.xml'), sitemap);
const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => new URL(m[1]).pathname);
// The sitemap contains a tracking-login landing page; explicitly exclude it.
const publicPaths = urls.filter(p => !/^\/(?:track-order|account|my-account|admin|api|pay|invoice|checkout)(?:[-/.]|$)/.test(p));
publicPaths.push('/privacy-policy.html');
const normalized = publicPaths.map(p => p.replace(/\.html$/, '').replace(/\/$/, '') || '/');
const loader = fs.readFileSync('marketing-analytics.js', 'utf8').replace('/* PUBLIC_PATHS */ []', JSON.stringify(normalized));
fs.writeFileSync(path.join(out, 'marketing-analytics.js'), loader);
for (const url of publicPaths) {
  const file = url === '/' ? 'index.html' : url.slice(1) + (url.endsWith('.html') ? '' : '.html');
  const fullPath = path.join(out, file);
  if (!fs.existsSync(fullPath)) throw Error('Public marketing page missing: ' + file);
  let html = fs.readFileSync(fullPath, 'utf8');
  if (!html.includes('src="/marketing-analytics.js"')) html = html.replace('</head>', '<script defer src="/marketing-analytics.js"></script></head>');
  fs.writeFileSync(fullPath, html);
}
console.log('Public-page analytics and research documentation guide built; private/payment pages excluded.');
