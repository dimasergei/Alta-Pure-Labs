const test = require('node:test');
const assert = require('node:assert/strict');
const { listAdminOrders } = require('../lib/admin-order-query');

function makeDb() {
  const calls = [];
  const query = {
    select(columns, options) { calls.push(['select', columns, options]); return this; },
    eq(column, value) { calls.push(['eq', column, value]); return this; },
    in(column, value) { calls.push(['in', column, value]); return this; },
    gte(column, value) { calls.push(['gte', column, value]); return this; },
    lt(column, value) { calls.push(['lt', column, value]); return this; },
    or(value) { calls.push(['or', value]); return this; },
    order(column, options) { calls.push(['order', column, options]); return this; },
    range(start, end) {
      calls.push(['range', start, end]);
      return Promise.resolve({ data: [], error: null, count: 0 });
    }
  };
  return { db: { from(table) { calls.push(['from', table]); return query; } }, calls };
}

test('admin order query applies independent payment and fulfillment filters', async () => {
  const { db, calls } = makeDb();
  await listAdminOrders(db, new URLSearchParams({
    status: 'all',
    payment_status: 'paid',
    fulfillment_status: 'unfulfilled'
  }));
  assert.ok(calls.some(([kind, column, value]) => kind === 'eq' && column === 'payment_status' && value === 'paid'));
  assert.ok(calls.some(([kind, column, value]) => kind === 'eq' && column === 'fulfillment_status' && value === 'unfulfilled'));
});

test('admin order search can match an internal UUID order ID', async () => {
  const { db, calls } = makeDb();
  const id = '20000000-0000-4000-8000-000000000001';
  await listAdminOrders(db, new URLSearchParams({ status: 'all', search: id }));
  const orFilter = calls.find(([kind]) => kind === 'or')?.[1] || '';
  assert.match(orFilter, new RegExp('id\\.eq\\.' + id));
});
