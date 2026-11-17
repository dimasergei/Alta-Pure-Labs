'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { buildStatusEmail, orderTotalRows, STATUS_COPY } = require('../lib/customer-order-email');
const { envelope } = require('../lib/invoice-notifications');

const id = '60840bf9-db00-4000-8000-000000000001';
const orderUrl = 'https://getpurelabs.com/account/purchases?id=' + id;
const env = { ORDER_CONFIRMATION_FROM: 'PURE <orders@example.test>', ADMIN_ORDER_EMAIL: 'team@example.test' };
const order = {
  order_number: 'AP60840BF9DB', customer_name: 'Researcher <script>unsafe</script>',
  customer_email: 'researcher@example.test', payment_status: 'pending', fulfillment_status: 'canceled',
  currency: 'USD', subtotal_cents: 14600, shipping_cents: 2500, total_cents: 17100,
  items: [{ product_name: 'Research compound <img src=x>', variant_size: '10 mg', quantity: 2, unit_price_cents: 7300 }],
  shipping_address: { line1: '100 Example Lane', city: 'Example City', state: 'CA', postal_code: '90000', country: 'US' },
  tracking_carrier: 'UPS', tracking_number: '1Z <test>'
};

function assertSummaryAction(html, expectedUrl, expectedLabel = 'View secure order') {
  const document = new JSDOM(html).window.document;
  const summary = document.querySelector('[data-pure-order-summary]');
  assert.ok(summary, 'summary box is present');
  assert.deepEqual([...summary.querySelectorAll(':scope > p > strong')].map(el => el.textContent), [
    'Order number:', 'Payment status:', 'Order status:', 'Customer email:'
  ]);
  const action = summary.querySelector('[data-pure-order-action]');
  assert.ok(action, 'action belongs to the same summary box');
  assert.equal(action.previousElementSibling.querySelector('strong').textContent, 'Customer email:');
  assert.equal(summary.lastElementChild, action, 'nothing separates summary details from the action');
  assert.equal(action.querySelector('a').getAttribute('href'), expectedUrl);
  assert.equal(action.querySelector('a').textContent, expectedLabel);
  assert.equal(document.querySelectorAll('[data-pure-order-action]').length, 1, 'one order action');
  assert.equal(document.querySelector('[data-pure-email-footer] [data-pure-order-action]'), null, 'no order action in footer');
  return document;
}

test('every order status uses a summary-contained secure action and the same monochrome header', () => {
  for (const notificationType of Object.keys(STATUS_COPY)) {
    const mail = buildStatusEmail({ order, notificationType, orderUrl });
    const document = assertSummaryAction(mail.html, orderUrl);
    const images = [...document.querySelectorAll('[data-pure-email-header] img')];
    assert.deepEqual(images.map(img => img.getAttribute('src')), [
      'https://getpurelabs.com/assets/pure-icon-96.png',
      'https://getpurelabs.com/assets/pure-wordmark-dark.png'
    ]);
    assert.equal(images[0].closest('tr'), images[1].closest('tr'), 'symbol and name sit side by side');
    assert.equal(images[1].alt, 'PURE');
    assert.equal(document.querySelector('script'), null);
    assert.ok(document.body.textContent.includes('Research compound <img src=x>'), 'item text is escaped');
    assert.equal(document.querySelector('[data-pure-email-footer] a').getAttribute('href'), 'mailto:support@getpurelabs.com');
    for (const color of mail.html.match(/#[a-f0-9]{6}\b/gi) || []) {
      assert.ok(color.slice(1, 3) === color.slice(3, 5) && color.slice(3, 5) === color.slice(5, 7), 'neutral color: ' + color);
    }
    assert.ok(mail.text.includes('\nOrder number: '));
    assert.ok(mail.text.includes('View secure order: ' + orderUrl));
    assert.ok(mail.text.includes(STATUS_COPY[notificationType].message), 'status meaning is preserved');
  }
});

test('checkout and invoice envelopes keep recipients, support replies, and audience-specific secure destinations', () => {
  for (const checkout of [true, false]) {
    for (const audience of ['customer', 'admin']) {
      const mail = envelope({
        audience, event_action: 'status_changed',
        snapshot: { id, ...(checkout ? { checkout_version: 'fixture' } : {}), customer_name: order.customer_name, customer_email: order.customer_email, currency: 'USD', status: 'void', total_cents: 17100, event_at: '2026-11-17T20:00:00Z' },
        detail: { pricing: { lines: [{ name: 'Synthetic research item', size: '10 mg', qty: 2, line_total_cents: 14600 }] }, subtotal_cents: 14600, shipping_cents: 2500 }
      }, env);
      const expectedUrl = audience === 'customer' ? orderUrl : 'https://getpurelabs.com/' + (checkout ? 'admin-orders.html' : 'admin-payments.html');
      assertSummaryAction(mail.html, expectedUrl, !checkout && audience === 'admin' ? 'Open secure payment desk' : 'View secure order');
      assert.deepEqual(mail.to, [audience === 'customer' ? order.customer_email : env.ADMIN_ORDER_EMAIL]);
      assert.equal(mail.reply_to, 'support@getpurelabs.com');
      assert.equal(mail.from, env.ORDER_CONFIRMATION_FROM);
      assert.ok(mail.text.includes(expectedUrl));
      assert.doesNotMatch(mail.html, /#143832|#17382f|#f3f5f5|#f4f6ef|#f8f4e8|#5f5638|#cfe3de/i);
      if (checkout) assert.ok(mail.html.includes('This notice does not confirm a refund.'));
    }
  }
});

test('order actions reject external or active-content URLs and keep legacy updates on the authenticated order page', () => {
  for (const url of ['javascript:alert(1)', 'https://example.test/order', 'https://user:secret@getpurelabs.com/account/purchases']) {
    assert.throws(() => buildStatusEmail({ order, notificationType: 'canceled', orderUrl: url }), /PURE website/);
  }
  const mail = buildStatusEmail({ order, notificationType: 'tracking_updated' });
  assertSummaryAction(mail.html, 'https://getpurelabs.com/account/purchases');
  assert.ok(mail.html.includes('https://www.ups.com/track?tracknum=1Z%20%3Ctest%3E'), 'carrier tracking link stays intact');
});

test('checkout email explains exact historical coupon, crypto, tax, and redeemed balances without repricing', () => {
  const pricing = {
    promotion_version: 'historical-fixture', coupon_code: 'OLD15', subtotal_cents: 9999, discount_cents: 1925,
    coupon_discount_cents: 1500, crypto_discount_cents: 425, redeemed_points: 200, credit_cents: 100,
    lines: [{ name: 'Historical research item', size: '10 mg', qty: 3, unit_price_cents: 3333, gross_cents: 9999, discount_cents: 1925, line_total_cents: 8074 }]
  };
  const detail = { pricing, subtotal_cents: 9999, discount_cents: 1925, shipping_cents: 1495, tax_cents: 647, points_redeemed: 200, credit_redeemed_cents: 100 };
  const before = JSON.stringify(detail);
  const mail = envelope({ audience: 'customer', event_action: 'payment_recorded', snapshot: { id, checkout_version: 'historic-checkout', status: 'paid', customer_email: order.customer_email, customer_name: 'Researcher', currency: 'USD', total_cents: 9916 }, detail }, env);
  const document = new JSDOM(mail.html).window.document;
  assert.deepEqual([...document.querySelectorAll('[data-pure-order-totals] p')].map(node => node.textContent), [
    'Subtotal: $99.99', 'Coupon discount (OLD15): −$15.00', 'Crypto discount: −$4.25',
    'Shipping: $14.95', 'Tax: $6.47', 'Points redeemed: −$2.00', 'Store credit: −$1.00', 'Total: $99.16'
  ]);
  const item = document.querySelector('[data-pure-email-body] > table td');
  assert.equal(item.nextElementSibling.textContent.trim(), '$99.99', 'item list uses exact recorded gross, not a rounded discounted unit price');
  assert.ok(mail.text.includes('Crypto discount: -$4.25'));
  assert.ok(mail.text.includes('Tax: $6.47'));
  assert.ok(mail.text.includes('Total: $99.16'));
  const rows = orderTotalRows({ ...detail, total_cents: 9916 });
  assert.equal(rows.filter(row => !row.total).reduce((sum, row) => sum + (row.deduction ? -row.cents : row.cents), 0), 9916);
  assert.equal(JSON.stringify(detail), before, 'recorded pricing is not mutated');
});

test('legacy or inconsistent discount metadata uses the recorded aggregate and hides zero tax', () => {
  for (const pricing of [undefined, { coupon_discount_cents: 9000, crypto_discount_cents: 1000 }, { coupon_discount_cents: -20, crypto_discount_cents: 250 }]) {
    const mail = buildStatusEmail({ order: { ...order, subtotal_cents: 10000, discount_cents: 250, shipping_cents: 500, tax_cents: 0, total_cents: 10250, pricing }, notificationType: 'confirmation' });
    const totals = new JSDOM(mail.html).window.document.querySelector('[data-pure-order-totals]').textContent;
    assert.ok(totals.includes('Discount: −$2.50'));
    assert.ok(totals.includes('Total: $102.50'));
    assert.doesNotMatch(totals, /Coupon discount|Crypto discount|Tax:/);
    assert.ok(mail.text.includes('Discount: -$2.50'));
  }
});
