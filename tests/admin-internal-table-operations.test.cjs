const test = require('node:test');
const assert = require('node:assert/strict');

const backendPath = require.resolve('../lib/backend');
const originalBackend = require(backendPath);
const password = 'fixture-admin-password-with-at-least-32-characters';
const calls = [];
let currentRows = [];

function builder(table) {
  const state = { table, operation: 'select', filters: {}, payload: null };
  const q = {
    select(columns) { state.columns = columns; return this; },
    order() { return this; },
    limit() { return this; },
    eq(column, value) { state.filters[column] = value; return this; },
    ilike(column, value) { state.filters[column] = value; return this; },
    or(value) { state.or = value; return this; },
    insert(value) { state.operation = 'insert'; state.payload = value; return this; },
    update(value) { state.operation = 'update'; state.payload = value; return this; },
    single() { return Promise.resolve({ data: table === 'suppliers' ? { id: 'supplier-1', name: 'Test Supplier', active: true } : { id: 'batch-1', name: 'Test Batch', status: 'draft', supplier_batch_items: [] }, error: null }); },
    maybeSingle() { return Promise.resolve({ data: null, error: null }); },
    then(resolve, reject) {
      calls.push({ table, operation: state.operation, filters: state.filters, columns: state.columns });
      return Promise.resolve({ data: currentRows, error: null }).then(resolve, reject);
    }
  };
  return q;
}
const db = {
  from(table) { return builder(table); },
  async rpc(name, args) { calls.push({ rpc: name, args }); return { data: { batch_id: 'batch-1' }, error: null }; }
};
require.cache[backendPath].exports = {
  clients: () => ({ db }),
  checked(result) { if (result.error) throw result.error; return result.data; }
};

const suppliers = require('../api/admin-suppliers');
const batches = require('../api/admin-supplier-batches');
const notifications = require('../api/admin-notifications');

function response() {
  return {
    statusCode: 200, headers: {}, body: null,
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}
async function invoke(handler, method, url, body) {
  const res = response();
  await handler({ method, url, body, headers: { 'x-admin-password': password, 'content-type': 'application/json' } }, res);
  return res;
}

test('admin supplier, supplier-batch, and notification queue reads use backend client', async () => {
  process.env.ADMIN_ORDERS_PASSWORD = password;
  currentRows = [{ id: 'n-1', status: 'pending' }];
  const supplierList = await invoke(suppliers, 'GET', '/api/admin-suppliers');
  assert.equal(supplierList.statusCode, 200);
  const batchList = await invoke(batches, 'GET', '/api/admin-supplier-batches');
  assert.equal(batchList.statusCode, 200);
  const queue = await invoke(notifications, 'GET', '/api/admin-notifications?status=pending');
  assert.equal(queue.statusCode, 200);
  assert.ok(calls.some(c => c.table === 'suppliers'));
  assert.ok(calls.some(c => c.table === 'supplier_batches'));
  assert.ok(calls.some(c => c.table === 'order_status_notifications'));
});

test('admin supplier creation and supplier-batch creation remain functional', async () => {
  process.env.ADMIN_ORDERS_PASSWORD = password;
  const supplier = await invoke(suppliers, 'POST', '/api/admin-suppliers', { name: 'Test Supplier' });
  assert.equal(supplier.statusCode, 201);
  const batch = await invoke(batches, 'POST', '/api/admin-supplier-batches', {
    supplier_id: '10000000-0000-4000-8000-000000000001',
    name: 'Test Batch',
    order_ids: ['20000000-0000-4000-8000-000000000001']
  });
  assert.equal(batch.statusCode, 201);
  assert.ok(calls.some(c => c.rpc === 'create_supplier_batch'));
});

test.after(() => {
  delete process.env.ADMIN_ORDERS_PASSWORD;
  require.cache[backendPath].exports = originalBackend;
});
