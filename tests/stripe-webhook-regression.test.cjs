const test = require('node:test');
const assert = require('node:assert/strict');

const backendPath = require.resolve('../lib/backend');
const notificationsPath = require.resolve('../lib/order-notifications');
const originalBackend = require.cache[backendPath];
const originalNotifications = require.cache[notificationsPath];
const originalFetch = global.fetch;
const envKeys = ['STRIPE_WEBHOOK_SECRET', 'RESEND_API_KEY', 'ADMIN_ORDER_EMAIL'];
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

const paymentEvents = new Map();
const notifications = new Map();
const order = {
  id: 'order-test-001',
  order_number: 'ALTA-TEST001',
  customer_email: 'customer@example.test',
  customer_name: 'Test Customer',
  organization: 'Test Lab',
  payment_status: 'pending',
  fulfillment_status: 'unfulfilled',
  subtotal_cents: 5000,
  shipping_cents: 500,
  total_cents: 5500,
  shipping_address: {}
};
const orderItems = [{
  id: 'item-test-001',
  product_name: 'Test research item',
  variant_size: '10mg',
  quantity: 1,
  unit_price_cents: 5000
}];

let itemQueryCount = 0;
let rpcCount = 0;
const stripeEvent = {
  id: 'evt_test_webhook_once',
  type: 'checkout.session.completed',
  data: { object: { id: 'cs_test_webhook_once' } }
};
const session = {
  id: 'cs_test_webhook_once',
  metadata: { order_id: order.id },
  payment_status: 'paid',
  currency: 'usd',
  amount_subtotal: 5000,
  amount_total: 5500,
  total_details: { amount_shipping: 500, amount_tax: 0 },
  payment_intent: 'pi_test_webhook_once',
  shipping_details: null,
  receipt_url: null
};

const stripe = {
  webhooks: {
    constructEvent(rawBody, signature, secret) {
      assert.equal(secret, 'whsec_fixture_only');
      if (signature !== 'valid-test-signature') throw new Error('Invalid signature');
      assert.equal(rawBody.toString(), '{"fixture":"stripe-event"}');
      return stripeEvent;
    }
  },
  checkout: {
    sessions: {
      async retrieve(sessionId) {
        assert.equal(sessionId, session.id);
        return session;
      }
    }
  }
};

const db = {
  from(table) {
    if (table === 'store_orders') {
      return {
        select() {
          return {
            eq(column, value) {
              assert.equal(column, 'id');
              assert.equal(value, order.id);
              return {
                async single() { return { data: order, error: null }; }
              };
            }
          };
        }
      };
    }

    if (table === 'store_order_items') {
      return {
        select(columns) {
          assert.equal(columns, '*');
          return {
            async eq(column, value) {
              assert.equal(column, 'order_id');
              assert.equal(value, order.id);
              itemQueryCount += 1;
              return { data: orderItems, error: null };
            }
          };
        }
      };
    }

    if (table === 'store_payment_events') {
      return {
        select(columns) {
          assert.equal(columns, 'stripe_event_id');
          return {
            eq(column, value) {
              assert.equal(column, 'stripe_event_id');
              return {
                async maybeSingle() {
                  const found = paymentEvents.get(value);
                  return { data: found ? { stripe_event_id: value } : null, error: null };
                }
              };
            }
          };
        }
      };
    }

    throw new Error('Unexpected table: ' + table);
  },
  async rpc(name, args) {
    assert.equal(name, 'apply_store_checkout_event');
    assert.equal(args.p_event_id, stripeEvent.id);
    assert.equal(args.p_order_id, order.id);
    rpcCount += 1;
    paymentEvents.set(args.p_event_id, { stripe_event_id: args.p_event_id });
    order.payment_status = args.p_paid ? 'paid' : 'pending';
    return { data: true, error: null };
  }
};

require.cache[backendPath] = {
  id: backendPath,
  filename: backendPath,
  loaded: true,
  exports: {
    clients: () => ({ stripe, db }),
    checked(result) {
      if (result.error) throw result.error;
      return result.data;
    }
  }
};

require.cache[notificationsPath] = {
  id: notificationsPath,
  filename: notificationsPath,
  loaded: true,
  exports: {
    async queueStatusNotification(input) {
      const key = input.orderId + ':' + input.eventKey;
      if (notifications.has(key)) {
        return { created: false, id: notifications.get(key).id };
      }
      const notification = { id: 'notification-test-001', status: 'pending' };
      notifications.set(key, notification);
      return { created: true, id: notification.id };
    },
    async markNotificationSent(input) {
      const notification = [...notifications.values()].find((item) => item.id === input.notificationId);
      if (notification) notification.status = 'sent';
    },
    async markNotificationFailed() {}
  }
};

const handler = require('../api/stripe-webhook');

function responseRecorder() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    send(value) { this.body = value; return this; },
    end() { return this; }
  };
}

function request(signature) {
  const raw = Buffer.from('{"fixture":"stripe-event"}');
  return {
    method: 'POST',
    headers: { 'stripe-signature': signature },
    async *[Symbol.asyncIterator]() { yield raw; }
  };
}

test('Stripe webhook applies a payment once, reads items without created_at, deduplicates notifications, and rejects invalid signatures', async () => {
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_fixture_only';
  process.env.RESEND_API_KEY = 're_fixture_only';
  delete process.env.ADMIN_ORDER_EMAIL;
  global.fetch = async () => ({
    ok: true,
    async json() { return { id: 'email_fixture_001' }; }
  });

  const firstResponse = responseRecorder();
  await handler(request('valid-test-signature'), firstResponse);

  assert.equal(firstResponse.statusCode, 200);
  assert.deepEqual(firstResponse.body, { received: true });
  assert.equal(order.payment_status, 'paid', 'successful event updates the order');
  assert.equal(paymentEvents.size, 1, 'successful event is recorded');
  assert.equal(rpcCount, 1);
  assert.equal(itemQueryCount, 1, 'webhook retrieves order items without an order() sort on created_at');
  assert.equal(notifications.size, 1, 'first successful event queues one notification');

  const replayResponse = responseRecorder();
  await handler(request('valid-test-signature'), replayResponse);

  assert.equal(replayResponse.statusCode, 200);
  assert.equal(paymentEvents.size, 1, 'replay does not create a duplicate payment event');
  assert.equal(rpcCount, 1, 'replay does not reapply the payment event');
  assert.equal(notifications.size, 1, 'replay does not create a duplicate notification');

  const invalidResponse = responseRecorder();
  await handler(request('invalid-test-signature'), invalidResponse);
  assert.equal(invalidResponse.statusCode, 400, 'invalid Stripe signature is rejected');
});

test.after(() => {
  global.fetch = originalFetch;
  for (const key of envKeys) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
  if (originalBackend) require.cache[backendPath] = originalBackend;
  else delete require.cache[backendPath];
  if (originalNotifications) require.cache[notificationsPath] = originalNotifications;
  else delete require.cache[notificationsPath];
});
