const test = require('node:test');
const assert = require('node:assert/strict');

const backendPath = require.resolve('../lib/backend');
const queryPath = require.resolve('../lib/admin-order-query');
const originalBackend = require(backendPath);
const originalQuery = require(queryPath);
const password = 'fixture-admin-password-with-at-least-32-characters';
let receivedDb;

require.cache[backendPath].exports = {
  clients: () => {
    receivedDb = { marker: 'service-role-backed-db' };
    return { db: receivedDb };
  },
  checked(result) { if (result.error) throw result.error; return result.data; }
};
require.cache[queryPath].exports = {
  listAdminOrders: async (db, params) => {
    assert.equal(db, receivedDb);
    assert.equal(params.get('status'), 'all');
    return { orders: [{ order_number: 'ALTA-ADMIN-1', admin_notes: 'internal' }] };
  }
};
const handler = require('../api/admin-orders');

test('admin order list continues through the backend client after customer policy removal', async () => {
  const previous = process.env.ADMIN_ORDERS_PASSWORD;
  process.env.ADMIN_ORDERS_PASSWORD = password;
  const res = {
    statusCode: 200, headers: {}, body: null,
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
  try {
    await handler({
      method: 'GET',
      url: '/api/admin-orders',
      headers: { 'x-admin-password': password }
    }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.orders[0].order_number, 'ALTA-ADMIN-1');
    assert.equal(res.body.orders[0].admin_notes, 'internal');
  } finally {
    if (previous === undefined) delete process.env.ADMIN_ORDERS_PASSWORD;
    else process.env.ADMIN_ORDERS_PASSWORD = previous;
  }
});

test.after(() => {
  require.cache[backendPath].exports = originalBackend;
  require.cache[queryPath].exports = originalQuery;
});
