const fs = require('node:fs');
const vm = require('node:vm');
const sandbox = {};
vm.runInNewContext(fs.readFileSync('products.js', 'utf8') + '\n;globalThis.exported = CATALOG;', sandbox, {timeout: 1000});
fs.mkdirSync('lib', {recursive:true});
fs.writeFileSync('lib/catalog.json', JSON.stringify(sandbox.exported));
let html = fs.readFileSync('index.html','utf8');
if (!html.includes('src="checkout.js"')) {
  html = html.replace('</body>', '<script src="checkout.js"></script>\n</body>');
}
html = html.replace('This is a local order summary. No payment is processed.', 'Test checkout only. No real payments. USD; US shipping is $25 per order.');
html = html.replace('No. The order flow prepares a local request summary; it does not process payment or place an order.', 'Checkout is currently in test mode. No real payments are accepted. US shipping is $25 per order.');
html = html.replace('Place request <span', 'Continue to test payment <span');
html = html.replaceAll('Shipping billed separately.', 'US shipping: $25 per order. Prices in USD.');
fs.writeFileSync('index.html',html);
console.log('Generated server catalog and installed test checkout script.');
