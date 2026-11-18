'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const documents = require('../lib/admin-shipping-documents');

const env = { SHIPPO_MODE: 'live', SHIPPO_API_TOKEN: 'shippo_live_fixture', SHIPPO_TEST_TOKEN: 'shippo_test_fixture', SHIPPO_ALLOW_LIVE_PURCHASES: 'true' };
const rateId = 'a'.repeat(32), transactionId = 'b'.repeat(32);
const labelUrl = 'https://deliver.goshippo.com/fixture-label.pdf?token=fixture';
const customsUrl = 'https://shippo-delivery.s3.amazonaws.com/fixture-customs.pdf';
const pdf = Buffer.from('%PDF-1.4\nFixture shipping document\n%%EOF\n');
const pdfResponse = () => new Response(pdf, { headers: { 'content-type': 'application/pdf', 'content-length': String(pdf.length) } });

function fixture(changes = {}) {
  const row = { id: randomUUID(), order_id: randomUUID(), source: 'commerce', status: 'created', test_mode: false,
    selected_rate: { id: rateId, amount_cents: 1257, currency: 'CAD', carrier: 'UPS', service: 'Standard' },
    transaction_id: transactionId, created_at: new Date(Date.now() - 300000).toISOString(), purchased_at: new Date(Date.now() - 120000).toISOString(),
    label_url: labelUrl, customs_url: customsUrl, ...changes };
  const records = [];
  const db = {
    from(table) {
      assert.equal(table, 'admin_shipping_labels');
      const filters = [];
      const query = { select() { return query; }, eq(key, value) { filters.push(item => item[key] === value); return query; },
        async maybeSingle() { return { data: filters.every(matches => matches(row)) ? { ...row } : null }; } };
      return query;
    },
    async rpc(name, args) {
      assert.equal(name, 'pure_shipping_label_record', 'documents and reconciliation must never claim a purchase');
      records.push(args);
      const status = { SUCCESS: 'created', REFUNDED: 'refunded', REFUNDPENDING: 'review', ERROR: 'failed' }[args.p_provider_status] || 'purchasing';
      Object.assign(row, args.p_result, { transaction_id: args.p_transaction, provider_status: args.p_provider_status, status });
      return { data: { ...row } };
    }
  };
  const input = { id: row.order_id, source: row.source, label_id: row.id };
  const transaction = { object_id: transactionId, metadata: 'pure-label:' + row.id, rate: rateId, test: row.test_mode,
    status: 'SUCCESS', label_url: labelUrl, commercial_invoice_url: customsUrl, tracking_number: '1ZFIXTURE' };
  return { row, db, input, transaction, records };
}

function providerResponse(data) { return { ok: true, json: async () => data }; }
function assertReadOnly(request) { assert.equal(request.method, 'GET'); assert.equal(request.body, undefined); }

test('PDF URLs accept only exact HTTPS delivery hosts without credentials or alternate ports', () => {
  assert.equal(documents.documentUrl(labelUrl + '#page=1').href, labelUrl);
  assert.equal(documents.documentUrl(customsUrl).hostname, 'shippo-delivery.s3.amazonaws.com');
  for (const value of ['not a URL', 'http://deliver.goshippo.com/label.pdf', 'https://user:pass@deliver.goshippo.com/label.pdf',
    'https://deliver.goshippo.com:444/label.pdf', 'https://deliver.goshippo.com.evil.example/label.pdf',
    'https://evil.s3.amazonaws.com/label.pdf', 'https://127.0.0.1/label.pdf', 'https://[::1]/label.pdf', 'file:///etc/passwd']) {
    assert.throws(() => documents.documentUrl(value), error => error.status === 502);
  }
});

test('PDF downloads follow only verified redirects and never send provider credentials', async () => {
  const calls = [];
  const bytes = await documents.downloadPdf(labelUrl, { fetch: async (url, request) => {
    calls.push(url); assertReadOnly(request); assert.equal(request.redirect, 'manual'); assert.equal(request.credentials, 'omit');
    assert.deepEqual(request.headers, { Accept: 'application/pdf' });
    return calls.length === 1 ? new Response(null, { status: 302, headers: { location: customsUrl } }) : pdfResponse();
  } });
  assert.deepEqual(calls, [labelUrl, customsUrl]); assert.deepEqual(bytes, pdf);
  let deniedCalls = 0;
  await assert.rejects(documents.downloadPdf(labelUrl, { fetch: async () => {
    deniedCalls++; return new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/private' } });
  } }), error => error.status === 502);
  assert.equal(deniedCalls, 1, 'an untrusted redirect must never be requested');
});

test('PDF downloads reject HTML, wrong magic, oversized headers, oversized streams, and redirect loops', async () => {
  const cases = [
    () => new Response('<html>Provider login</html>', { headers: { 'content-type': 'text/html' } }),
    () => new Response('Not a PDF', { headers: { 'content-type': 'application/pdf' } }),
    () => new Response(pdf, { headers: { 'content-type': 'application/pdf', 'content-length': '4194305' } }),
    () => new Response(new ReadableStream({ start(controller) { controller.enqueue(Buffer.concat([pdf, Buffer.alloc(4 * 1024 * 1024)])); controller.close(); } }), { headers: { 'content-type': 'application/octet-stream' } })
  ];
  for (const response of cases) await assert.rejects(documents.downloadPdf(labelUrl, { fetch: async () => response() }), error => error.status === 502);
  let calls = 0;
  await assert.rejects(documents.downloadPdf(labelUrl, { fetch: async () => {
    calls++; return new Response(null, { status: 307, headers: { location: labelUrl } });
  } }), /redirect could not be verified/);
  assert.equal(calls, 4);
});

test('download network and HTTP failures return controlled errors without leaking the signed URL', async () => {
  for (const fetch of [async () => { throw new Error('Private network details ' + labelUrl); }, async () => new Response('Private response', { status: 403 })]) {
    await assert.rejects(documents.downloadPdf(labelUrl, { fetch }), error => [502, 503].includes(error.status) && !error.message.includes('token=') && !error.message.includes('Private'));
  }
});

test('stored labels refresh by GET and serve PDFs without sending Shippo authorization to delivery hosts', async () => {
  const h = fixture(), calls = [];
  const result = await documents.readDocument(h.db, h.input, { env, fetch: async (url, request) => {
    assertReadOnly(request); calls.push(url);
    if (url.startsWith('https://api.goshippo.com/')) {
      assert.equal(request.headers.Authorization, 'ShippoToken shippo_live_fixture');
      return providerResponse(h.transaction);
    }
    assert.deepEqual(request.headers, { Accept: 'application/pdf' }); return pdfResponse();
  } });
  assert.deepEqual(calls, ['https://api.goshippo.com/transactions/' + transactionId + '/', labelUrl]);
  assert.deepEqual(result.bytes, pdf); assert.equal(result.filename, `PURE-label-${h.row.order_id.slice(0, 8)}-${h.row.id.slice(0, 8)}.pdf`);
  assert.equal(h.records.length, 1);
});

test('customs documents and historical test labels use their stored transaction and matching test token', async () => {
  const h = fixture({ test_mode: true }), calls = [];
  const result = await documents.readDocument(h.db, { ...h.input, kind: 'customs', url: 'https://127.0.0.1/private' }, { env, fetch: async (url, request) => {
    assertReadOnly(request); calls.push(url);
    if (url.startsWith('https://api.goshippo.com/')) {
      assert.equal(request.headers.Authorization, 'ShippoToken shippo_test_fixture'); return providerResponse(h.transaction);
    }
    return pdfResponse();
  } });
  assert.equal(calls[1], customsUrl, 'browser-supplied URLs are ignored'); assert.match(result.filename, /^PURE-customs-/);
  assert.equal(h.row.test_mode, true);
});

test('document reads reject wrong order ownership, unsupported kind, and unpurchased quotes before provider access', async () => {
  const h = fixture(), options = { env, fetch: async () => { throw new Error('provider must not be called'); } };
  await assert.rejects(documents.readDocument(h.db, { ...h.input, id: randomUUID() }, options), error => error.status === 404);
  await assert.rejects(documents.readDocument(h.db, { ...h.input, kind: 'invoice' }, options), error => error.status === 400);
  h.row.status = 'quoted';
  await assert.rejects(documents.readDocument(h.db, h.input, options), error => error.status === 409);
  assert.equal(h.records.length, 0);
});

test('provider refund or transaction mismatch prevents document delivery', async () => {
  for (const change of [{ status: 'REFUNDED' }, { metadata: 'pure-label:' + randomUUID() }, { test: true }, { rate: 'c'.repeat(32) }]) {
    const h = fixture(); let calls = 0;
    await assert.rejects(documents.readDocument(h.db, h.input, { env, fetch: async (url, request) => {
      calls++; assertReadOnly(request); assert.match(url, /^https:\/\/api\.goshippo\.com\/transactions\//);
      return providerResponse({ ...h.transaction, ...change });
    } }), error => error.status === 409);
    assert.equal(calls, 1, 'invalid or refunded transactions must not request their document');
    assert.equal(h.records.length, change.status === 'REFUNDED' ? 1 : 0);
  }
});

test('missing customs PDF is explicit and does not fetch an unrelated document', async () => {
  const h = fixture(); let calls = 0;
  await assert.rejects(documents.readDocument(h.db, { ...h.input, kind: 'customs' }, { env, fetch: async () => {
    calls++; return providerResponse({ ...h.transaction, commercial_invoice_url: null });
  } }), error => error.status === 404 && /customs PDF/.test(error.message));
  assert.equal(calls, 1);
});

test('unknown purchases reconcile through bounded GET history and exact metadata, without another purchase', async () => {
  const h = fixture({ status: 'review', transaction_id: null }), calls = [];
  const result = await documents.reconcile(h.db, h.input, { env, fetch: async (url, request) => {
    calls.push(url); assertReadOnly(request); assert.equal(request.headers.Authorization, 'ShippoToken shippo_live_fixture');
    const parsed = new URL(url);
    if (parsed.pathname === '/transactions/') {
      assert.equal(parsed.searchParams.get('results'), '100'); assert.equal(parsed.searchParams.get('page'), '1');
      assert.ok(Date.parse(parsed.searchParams.get('object_created_gte')) < Date.parse(h.row.purchased_at));
      assert.ok(Date.parse(parsed.searchParams.get('object_created_lte')) <= Date.now());
      return providerResponse({ results: [{ ...h.transaction, metadata: 'another-order', object_id: 'd'.repeat(32) }, h.transaction], next: null });
    }
    assert.equal(parsed.pathname, '/transactions/' + transactionId + '/'); return providerResponse(h.transaction);
  } });
  assert.equal(result.label.status, 'created'); assert.equal(result.label.transaction_id, transactionId);
  assert.equal(calls.length, 2); assert.equal(h.records.length, 1);
});

test('history pagination stays on Shippo, checks every page for duplicates, and retains the saved test mode', async () => {
  const h = fixture({ status: 'purchasing', transaction_id: null, test_mode: true }), pages = [];
  const result = await documents.reconcile(h.db, h.input, { env, fetch: async (url, request) => {
    assertReadOnly(request); assert.equal(request.headers.Authorization, 'ShippoToken shippo_test_fixture');
    const parsed = new URL(url); assert.equal(parsed.origin, 'https://api.goshippo.com');
    if (!parsed.search) return providerResponse(h.transaction);
    const page = parsed.searchParams.get('page'); pages.push(page);
    return providerResponse(page === '1' ? { results: [], next: 'https://evil.example/page-two' } : { results: [h.transaction], next: null });
  } });
  assert.deepEqual(pages, ['1', '2']); assert.equal(result.label.test, true); assert.equal(result.label.status, 'created');
});

test('ambiguous, mismatched, missing and unreadable history preserves the hold without a provider purchase', async () => {
  const cases = [
    h => ({ results: [h.transaction, { ...h.transaction, object_id: 'c'.repeat(32) }], next: null }),
    h => ({ results: [{ ...h.transaction, test: true }], next: null }),
    h => ({ results: [{ ...h.transaction, rate: 'd'.repeat(32) }], next: null }),
    h => ({ results: [{ ...h.transaction, metadata: 'another-order' }], next: null }),
    () => ({ results: 'unreadable' })
  ];
  for (const history of cases) {
    const h = fixture({ status: 'review', transaction_id: null }); let calls = 0;
    await assert.rejects(documents.reconcile(h.db, h.input, { env, fetch: async (url, request) => {
      calls++; assertReadOnly(request); assert.match(url, /\/transactions\/\?/); return providerResponse(history(h));
    } }), error => [409, 502].includes(error.status));
    assert.equal(calls, 1); assert.equal(h.records.length, 0); assert.equal(h.row.status, 'review'); assert.equal(h.row.transaction_id, null);
  }
});

test('reconciliation stops after five history pages and keeps a possible purchase blocked', async () => {
  const h = fixture({ status: 'review', transaction_id: null }); let calls = 0;
  await assert.rejects(documents.reconcile(h.db, h.input, { env, fetch: async (_, request) => {
    calls++; assertReadOnly(request); return providerResponse({ results: calls === 1 ? [h.transaction] : [], next: 'more-results' });
  } }), error => error.status === 409 && /too large/.test(error.message));
  assert.equal(calls, 5); assert.equal(h.records.length, 0); assert.equal(h.row.status, 'review');
});

test('known transactions refresh directly, while never-purchased quotes cannot be reconciled', async () => {
  const h = fixture(); let calls = 0;
  const options = { env, fetch: async (url, request) => {
    calls++; assertReadOnly(request); assert.equal(url, 'https://api.goshippo.com/transactions/' + transactionId + '/'); return providerResponse(h.transaction);
  } };
  assert.equal((await documents.reconcile(h.db, h.input, options)).label.status, 'created');
  assert.equal(calls, 1);
  h.row.status = 'quoted'; h.row.transaction_id = null;
  await assert.rejects(documents.reconcile(h.db, h.input, options), error => error.status === 409);
  assert.equal(calls, 1);
});

test('a changed individual transaction is rejected even after a matching history result', async () => {
  const h = fixture({ status: 'review', transaction_id: null }); let calls = 0;
  await assert.rejects(documents.reconcile(h.db, h.input, { env, fetch: async (url, request) => {
    calls++; assertReadOnly(request);
    return providerResponse(url.includes('?') ? { results: [h.transaction], next: null } : { ...h.transaction, metadata: 'other-order' });
  } }), error => error.status === 409);
  assert.equal(calls, 2); assert.equal(h.records.length, 0); assert.equal(h.row.status, 'review');
});
