const test = require('node:test');
const assert = require('node:assert/strict');

const handler = require('../api/admin-supplier-batches');

function responseRecorder() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    }
  };
}

test('supplier-batch admin API rejects requests without the admin password', async () => {
  const previous = process.env.ADMIN_ORDERS_PASSWORD;
  process.env.ADMIN_ORDERS_PASSWORD = 'fixture-admin-password-that-is-long-enough-123';

  try {
    const res = responseRecorder();
    await handler({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: {
        supplier_id: '10000000-0000-4000-8000-000000000001',
        name: 'Unauthorized batch',
        order_ids: ['20000000-0000-4000-8000-000000000001']
      }
    }, res);

    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.body, { error: 'Unauthorized.' });
    assert.equal(res.headers['Cache-Control'], 'no-store');
  } finally {
    if (previous === undefined) delete process.env.ADMIN_ORDERS_PASSWORD;
    else process.env.ADMIN_ORDERS_PASSWORD = previous;
  }
});
