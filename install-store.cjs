const fs = require('node:fs');
const vm = require('node:vm');
const sandbox = {};
vm.runInNewContext(fs.readFileSync('products.js', 'utf8') + '\n;globalThis.exported = CATALOG;', sandbox, {timeout: 1000});
fs.mkdirSync('lib', {recursive:true});
fs.writeFileSync('lib/catalog.json', JSON.stringify(sandbox.exported));
let html = fs.readFileSync('index.html','utf8');
if (!html.includes('src="checkout.js"')) {
  const bodyClose = html.lastIndexOf('</body>');
  if (bodyClose < 0) throw new Error('Cannot install checkout interceptor: </body> not found.');
  html = html.slice(0, bodyClose) + '<script src="checkout.js"></script>\n' + html.slice(bodyClose);
}
if (!fs.existsSync('checkout.js')) {
  throw new Error('Cannot build storefront: checkout.js is missing from the project root.');
}
html = html.replace('<h2>Order request</h2>', '<h2>Checkout</h2>');
html = html.replace('This is a local order summary. No payment is processed.', 'Secure Stripe checkout. Your payment is processed securely by Stripe after you confirm.');
html = html.replace('Place request <span', 'Continue to secure checkout <span');
html = html.replace('Continue to test payment <span', 'Continue to secure checkout <span');
html = html.replaceAll('Shipping billed separately.', 'US shipping: $25 per order. Prices in USD.');
fs.writeFileSync('index.html',html);
console.log('Generated server catalog and installed Stripe checkout script.');
