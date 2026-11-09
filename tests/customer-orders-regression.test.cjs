const test = require('node:test');
const assert = require('node:assert/strict');

const backendPath = require.resolve('../lib/backend');
const originalBackend = require(backendPath);
const orders = [
  {
    order_number: 'ALTA-1001',
    created_at: '2026-11-01T12:00:00Z',
    customer_name: 'Customer One',
    customer_email: 'one@example.test',
    payment_status: 'paid',
    fulfillment_status: 'processing',
    currency: 'USD',
    subtotal_cents: 5000,
    shipping_cents: 500,
    total_cents: 5500,
    shipping_name: 'Customer One',
    shipping_address: { city: 'Example' },
    tracking_carrier: null,
    tracking_number: null,
    internal_admin_notes: 'DO NOT RETURN',
    stripe_payment_intent_id: 'pi_private',
    supplier_cost_cents: 999,
    store_order_items: [{
      id: 'item-1', product_name: 'Research item', variant_size: '10mg',
      quantity: 1, unit_price_cents: 5000, supplier_sku: 'PRIVATE-SKU',
      internal_cost: 10
    }]
  },
  {
    order_number: 'ALTA-2002',
    created_at: '2026-11-02T12:00:00Z',
    customer_name: 'Customer Two',
    customer_email: 'two@example.test',
    payment_status: 'paid',
    fulfillment_status: 'shipped',
    currency: 'USD',
    subtotal_cents: 6000,
    shipping_cents: 500,
    total_cents: 6500,
    shipping_name: 'Customer Two',
    shipping_address: { city: 'Other' },
    tracking_carrier: null,
    tracking_number: null,
    store_order_items: []
  }
];

let currentUser;
let lastSelect;
const db = {
  auth: {
    async getUser(token) {
      assert.equal(token, 'test-session-token-12345');
      return { data: { user: currentUser }, error: null };
    }
  },
  from(table) {
    assert.equal(table, 'store_orders');
    const query = {
      select(columns) { lastSelect = columns; return this; },
      ilike(column, value) {
        assert.equal(column, 'customer_email');
        this.email = value.toLowerCase();
        return this;
      },
      eq(column, value) { assert.equal(column, 'order_number'); this.number = value; return this; },
      order() { return this; },
      limit() { return Promise.resolve({ data: orders.filter(o => o.customer_email.toLowerCase() === this.email), error: null }); },
      maybeSingle() {
        const row = orders.find(o => o.customer_email.toLowerCase() === this.email && o.order_number === this.number);
        return Promise.resolve({ data: row || null, error: null });
      }
    };
    return query;
  }
};
require.cache[backendPath].exports = {
  clients: () => ({ db }),
  checked(result) { if (result.error) throw result.error; return result.data; }
};
const handler = require('../api/customer-orders');

function response() {
  return {
    statusCode: 200, headers: {}, body: null,
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}
async function request(url) {
  const res = response();
  await handler({ method: 'GET', url, headers: { authorization: 'Bearer test-session-token-12345' } }, res);
  return res;
}

test('email-password and Google sessions both list only the authenticated customer orders', async () => {
  for (const provider of ['email', 'google']) {
    currentUser = {
      id: 'user-one', email: 'ONE@example.test', email_confirmed_at: '2026-01-01T00:00:00Z',
      app_metadata: { provider }
    };
    const res = await request('/api/customer-orders');
    assert.equal(res.statusCode, 200, provider);
    assert.deepEqual(res.body.orders.map(o => o.order_number), ['ALTA-1001']);
    assert.equal(res.body.orders[0].customer_email, 'one@example.test');
  }
});

test('customer order detail is returned for owner and denied cross-customer', async () => {
  currentUser = { id: 'user-one', email: 'one@example.test', email_confirmed_at: '2026-01-01T00:00:00Z', app_metadata: { provider: 'email' } };
  const own = await request('/api/customer-orders?orderNumber=ALTA-1001');
  assert.equal(own.statusCode, 200);
  assert.equal(own.body.order.order_number, 'ALTA-1001');
  const other = await request('/api/customer-orders?orderNumber=ALTA-2002');
  assert.equal(other.statusCode, 404);
  assert.deepEqual(other.body, { error: 'Order not found.' });
});

test('customer API never selects or returns internal fields', async () => {
  currentUser = { id: 'user-one', email: 'one@example.test', email_confirmed_at: '2026-01-01T00:00:00Z', app_metadata: { provider: 'google' } };
  const res = await request('/api/customer-orders?orderNumber=ALTA-1001');
  assert.equal(res.statusCode, 200);
  for (const forbidden of ['internal_admin_notes', 'stripe_payment_intent_id', 'supplier_cost_cents', 'supplier_sku', 'internal_cost']) {
    assert.equal(lastSelect.includes(forbidden), false, forbidden + ' must not be selected');
    assert.equal(JSON.stringify(res.body).includes(forbidden), false, forbidden + ' must not be returned');
  }
});

test.after(() => { require.cache[backendPath].exports = originalBackend; });
