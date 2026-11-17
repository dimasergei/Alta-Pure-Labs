'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PDFDocument, PDFName, PDFNumber, degrees } = require('pdf-lib');
const { verify, pdfDimensions } = require('../scripts/verify-shippo.cjs');

const TEST_TOKEN = 'shippo_test_VerificationSecret123';
const LIVE_TOKEN = 'shippo_live_VerificationSecret456';
const environment = {
  SHIPPO_TEST_TOKEN: TEST_TOKEN,
  SHIPPO_API_TOKEN: LIVE_TOKEN,
  SHIPPO_MODE: 'live',
  SHIPPO_ALLOW_LIVE_PURCHASES: 'true'
};
const accountId = 'a'.repeat(32);
const rateId = 'b'.repeat(32);
const transactionId = 'c'.repeat(32);
const shipmentId = 'd'.repeat(32);
const pdfUrl = 'https://deliver.goshippo.com/test-only-label.pdf';
const clone = value => JSON.parse(JSON.stringify(value));
async function fixturePdf(box = '0 0 288 432', options = {}) {
  const document = await PDFDocument.create();
  const [x, y, right, top] = box.split(' ').map(Number);
  const page = document.addPage([right - x, top - y]);
  page.setMediaBox(x, y, right - x, top - y);
  if (options.crop) page.setCropBox(...options.crop);
  if (options.rotate) page.setRotation(degrees(options.rotate));
  if (options.userUnit) page.node.set(PDFName.of('UserUnit'), PDFNumber.of(options.userUnit));
  // Real object streams ensure verification does not depend on PDF text regexes.
  return Buffer.from(await document.save({ useObjectStreams: true }));
}
const json = value => ({ ok: true, status: 200, json: async () => clone(value) });

function harness(options = {}) {
  const calls = [], logs = [];
  let metadata = 'pure-verification:10000000-0000-4000-8000-000000000001';
  const transaction = () => ({
    object_id: transactionId, test: true, rate: rateId, metadata,
    status: 'SUCCESS', label_url: pdfUrl, label_file_type: 'PDF_4x6',
    ...(options.transactionChange || {})
  });
  const fetch = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    const call = { url, init, body };
    calls.push(call);
    if (options.beforeRequest) await options.beforeRequest(call);
    if (url === pdfUrl) {
      const bytes = await (options.pdf || fixturePdf());
      return { ok: true, status: 200, arrayBuffer: async () => bytes };
    }
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://api.goshippo.com', 'provider credentials stay on the Shippo API origin');
    if (parsed.pathname === '/carrier_accounts/') {
      assert.equal(init.method, 'GET');
      assert.equal(parsed.searchParams.get('results'), '100');
      return json({ results: [{ object_id: accountId, carrier: 'canada_post', active: true, is_shippo_account: true, ...(options.carrierChange || {}) }], next: null });
    }
    if (parsed.pathname === '/shipments/') {
      metadata = body.metadata;
      return json({
        object_id: shipmentId, test: true,
        rates: [{ object_id: rateId, amount: '12.34', currency: 'CAD', provider: 'Canada Post', servicelevel: { name: 'Expedited Parcel' } }],
        ...(options.shipmentChange || {})
      });
    }
    if (parsed.pathname === '/transactions/') {
      assert.equal(body.metadata, metadata);
      if (options.transactionError) throw options.transactionError;
      return json(transaction());
    }
    if (parsed.pathname === '/transactions/' + transactionId + '/') {
      assert.equal(init.method, 'GET');
      return json({ ...transaction(), ...(options.refreshChange || {}) });
    }
    throw new Error('Unexpected verification request path: ' + parsed.pathname);
  };
  return {
    calls, logs, fetch,
    run: env => verify({ env: env || environment, fetch, log: value => logs.push(clone(value)) })
  };
}

function transactionPosts(h) {
  return h.calls.filter(call => call.url === 'https://api.goshippo.com/transactions/' && call.init.method === 'POST');
}

test('verification reads live carriers, creates one Canadian test label, refreshes it, and verifies a 4×6 PDF', async () => {
  const h = harness();
  const result = await h.run();
  assert.equal(result.status, 'passed');
  assert.equal(result.live_authentication, 'passed');
  assert.equal(result.test, true);
  assert.equal(result.live_postage_purchases, 0);
  assert.equal(result.test_label_transactions, 1);
  assert.equal(result.test_label_status, 'SUCCESS');
  assert.equal(result.test_transaction_id, transactionId);
  assert.equal(result.refresh, 'passed');
  assert.equal(result.pdf.nominal_width_inches, 4);
  assert.equal(result.pdf.nominal_height_inches, 6);
  assert.equal(result.pdf.verified_page_boxes, 1);
  assert.deepEqual(result.pdf.page_geometry, [{ page: 1, media_box: { x: 0, y: 0, width: 288, height: 432 },
    crop_box: { x: 0, y: 0, width: 288, height: 432 }, user_unit: 1, rotation: 0, effective_width_points: 288, effective_height_points: 432 }]);
  assert.equal(result.reported_label_file_type, 'PDF_4x6');

  assert.equal(h.calls.length, 6);
  assert.equal(h.calls[0].init.headers.Authorization, 'ShippoToken ' + LIVE_TOKEN);
  assert.equal(h.calls[1].init.headers.Authorization, 'ShippoToken ' + TEST_TOKEN);
  const shipment = h.calls.find(call => call.url === 'https://api.goshippo.com/shipments/');
  assert.equal(shipment.body.address_from.country, 'CA');
  assert.equal(shipment.body.address_to.country, 'CA');
  assert.match(shipment.body.address_from.name, /SANDBOX/);
  assert.match(shipment.body.address_to.name, /DO NOT MAIL/);
  assert.deepEqual(shipment.body.carrier_accounts, [accountId]);
  assert.equal(shipment.body.async, false);
  assert.deepEqual(shipment.body.parcels, [{ length: '20', width: '15', height: '10', distance_unit: 'cm', weight: '500', mass_unit: 'g' }]);
  const [purchase] = transactionPosts(h);
  assert.equal(purchase.body.rate, rateId);
  assert.equal(purchase.body.label_file_type, 'PDF_4x6');
  assert.equal(purchase.body.metadata, shipment.body.metadata);
  assert.match(purchase.body.metadata, /^pure-verification:/);
  assert.ok(h.calls.some(call => call.url === 'https://api.goshippo.com/transactions/' + transactionId + '/' && call.init.method === 'GET'));
});

test('verification never writes with the live token even when live mode and purchases are enabled', async () => {
  const h = harness();
  await h.run({ ...environment, SHIPPO_MODE: 'live', SHIPPO_ALLOW_LIVE_PURCHASES: 'true' });
  const live = h.calls.filter(call => call.init.headers?.Authorization === 'ShippoToken ' + LIVE_TOKEN);
  assert.equal(live.length, 1);
  assert.ok(live.every(call => call.init.method === 'GET' && !call.init.body));
  const writes = h.calls.filter(call => call.init.method === 'POST');
  assert.equal(writes.length, 2, 'only one sandbox shipment and one sandbox transaction are created');
  for (const call of writes) assert.equal(call.init.headers.Authorization, 'ShippoToken ' + TEST_TOKEN);
});

test('missing or incorrect test credentials fail before any network request without a live fallback', async () => {
  for (const testToken of [undefined, '', LIVE_TOKEN, 'malformed-token']) {
    const h = harness();
    await assert.rejects(h.run({ ...environment, SHIPPO_TEST_TOKEN: testToken, SHIPPO_API_KEY: LIVE_TOKEN }), {
      verification_code: 'valid_test_token_required'
    });
    assert.equal(h.calls.length, 0);
    assert.equal(h.logs.at(-1).stage, 'configuration');
    assert.equal(h.logs.at(-1).live_postage_purchases, 0);
  }
});

test('a missing or non-test shipment flag prevents every transaction POST', async () => {
  for (const testFlag of [undefined, false, 'true']) {
    const h = harness({ shipmentChange: { test: testFlag } });
    await assert.rejects(h.run(), { verification_code: 'test_shipment_not_confirmed' });
    assert.equal(transactionPosts(h).length, 0);
    assert.equal(h.logs.at(-1).stage, 'canadian_test_rates');
  }
});

test('mismatched transaction metadata, mode or rate cannot be accepted or downloaded', async () => {
  for (const transactionChange of [
    { metadata: 'another-shipment' },
    { test: false },
    { test: undefined },
    { rate: 'e'.repeat(32) }
  ]) {
    const h = harness({ transactionChange });
    await assert.rejects(h.run(), { verification_code: 'test_transaction_mismatch' });
    assert.equal(transactionPosts(h).length, 1);
    assert.equal(h.calls.some(call => call.url === pdfUrl), false);
    assert.equal(h.logs.at(-1).stage, 'test_label');
  }
});

test('refresh results must retain the same transaction identity and test mode', async () => {
  for (const refreshChange of [
    { object_id: 'f'.repeat(32) },
    { metadata: 'another-shipment' },
    { test: false },
    { rate: 'e'.repeat(32) }
  ]) {
    const h = harness({ refreshChange });
    await assert.rejects(h.run(), { verification_code: 'test_transaction_mismatch' });
    assert.equal(transactionPosts(h).length, 1);
    assert.equal(h.calls.some(call => call.url === pdfUrl), false);
    assert.equal(h.logs.at(-1).stage, 'refresh_test_label');
  }
});

test('an uncertain transaction POST stops verification and is never automatically repeated', async () => {
  const h = harness({ transactionError: new Error('timeout after receiving ' + TEST_TOKEN) });
  await assert.rejects(h.run(), { verification_code: 'provider_request_failed' });
  assert.equal(transactionPosts(h).length, 1);
  assert.equal(h.calls.filter(call => call.url.includes('/transactions/')).length, 1);
  assert.equal(h.logs.at(-1).stage, 'test_label');
  assert.equal(h.logs.at(-1).live_postage_purchases, 0);
  assert.ok(!JSON.stringify(h.logs).includes(TEST_TOKEN));
});

test('PDF download carries no API authorization, headers or cookies', async () => {
  const h = harness();
  await h.run();
  const pdf = h.calls.find(call => call.url === pdfUrl);
  assert.ok(pdf);
  assert.equal(pdf.init.method, 'GET');
  assert.equal(pdf.init.redirect, 'error');
  assert.equal(pdf.init.headers, undefined);
  assert.equal(pdf.init.credentials, undefined);
  assert.equal(pdf.init.body, undefined);
  assert.ok(!JSON.stringify(pdf).includes(TEST_TOKEN));
  assert.ok(!JSON.stringify(pdf).includes(LIVE_TOKEN));
});

test('a PDF with incorrect dimensions fails after one test label without claiming a successful verification', async () => {
  const h = harness({ pdf: fixturePdf('0 0 612 792') });
  await assert.rejects(h.run(), { verification_code: 'pdf_is_not_4x6' });
  assert.equal(transactionPosts(h).length, 1);
  assert.equal(h.logs.at(-1).stage, 'test_pdf');
  assert.equal(h.logs.at(-1).status, 'failed');
  assert.equal(h.logs.some(log => log.status === 'passed' && log.pdf), false);
  assert.equal(h.logs.at(-1).reported_label_file_type, 'PDF_4x6');
  assert.deepEqual(h.logs.at(-1).pdf_geometry, [{ page: 1, media_box: { x: 0, y: 0, width: 612, height: 792 },
    crop_box: { x: 0, y: 0, width: 612, height: 792 }, user_unit: 1, rotation: 0, effective_width_points: 612, effective_height_points: 792 }]);
  const landscape = await pdfDimensions(await fixturePdf('0 0 432 288'));
  assert.equal(landscape.nominal_width_inches, 4);
  assert.equal(landscape.nominal_height_inches, 6);
});

test('successful and failed logs exclude credentials and raw provider exception text', async () => {
  const success = harness();
  await success.run();
  const providerMessage = 'private provider diagnostic ' + LIVE_TOKEN + ' ' + TEST_TOKEN;
  const failure = harness({ beforeRequest: () => { throw new Error(providerMessage); } });
  await assert.rejects(failure.run(), error => {
    assert.ok(!error.message.includes(providerMessage));
    assert.ok(!error.message.includes(LIVE_TOKEN));
    assert.ok(!error.message.includes(TEST_TOKEN));
    return error.verification_code === 'provider_request_failed';
  });
  const serialized = JSON.stringify([...success.logs, ...failure.logs]);
  for (const secret of [LIVE_TOKEN, TEST_TOKEN, providerMessage, pdfUrl]) assert.ok(!serialized.includes(secret));
  assert.deepEqual(failure.logs.at(-1), {
    status: 'failed', stage: 'live_read_only_connection', code: 'provider_request_failed', http_status: 503, live_postage_purchases: 0
  });
});

test('PDF parser resolves object streams, crop boxes, rotation and user units', async () => {
  const bytes = await fixturePdf('0 0 612 792', { crop: [10, 20, 144, 216], rotate: 90, userUnit: 2 });
  assert.ok(!bytes.toString('latin1').includes('/MediaBox'), 'the fixture uses compressed PDF objects');
  const result = await pdfDimensions(bytes);
  assert.equal(result.nominal_width_inches, 4);
  assert.equal(result.nominal_height_inches, 6);
  assert.deepEqual(result.page_geometry[0], {
    page: 1, media_box: { x: 0, y: 0, width: 612, height: 792 }, crop_box: { x: 10, y: 20, width: 144, height: 216 },
    user_unit: 2, rotation: 90, effective_width_points: 432, effective_height_points: 288
  });
});

test('resume verifies an existing sandbox transaction using only GET requests and no new shipment', async () => {
  const h = harness();
  const result = await h.run({ ...environment, SHIPPO_VERIFY_TRANSACTION_ID: transactionId });
  assert.equal(result.status, 'passed');
  assert.equal(result.reused_test_transaction, true);
  assert.equal(result.test_label_transactions, 0);
  assert.equal(result.live_postage_purchases, 0);
  assert.equal(result.test_transaction_id, transactionId);
  assert.equal(result.reported_label_file_type, 'PDF_4x6');
  assert.equal(result.refresh, 'passed');
  assert.equal(h.calls.length, 5);
  assert.ok(h.calls.every(call => call.init.method === 'GET' && !call.init.body));
  assert.equal(h.calls.some(call => call.url.includes('/shipments/')), false);
  assert.equal(transactionPosts(h).length, 0);
  const gets = h.calls.filter(call => call.url.includes('/transactions/'));
  assert.equal(gets.length, 2);
  assert.ok(gets.every(call => call.init.headers.Authorization === 'ShippoToken ' + TEST_TOKEN));
});

test('invalid resume references fail before any provider request', async () => {
  for (const reference of ['../transactions', 'not-an-id', 'a'.repeat(31), 123]) {
    const h = harness();
    await assert.rejects(h.run({ ...environment, SHIPPO_VERIFY_TRANSACTION_ID: reference }), { verification_code: 'invalid_resume_transaction' });
    assert.equal(h.calls.length, 0);
  }
});

test('resume requires a test transaction with matching ID, valid rate, verification metadata and acceptable status', async () => {
  for (const [transactionChange, code] of [
    [{ test: false }, 'test_transaction_mismatch'],
    [{ object_id: 'f'.repeat(32) }, 'test_transaction_mismatch'],
    [{ rate: 'invalid-rate' }, 'invalid_resumed_test_transaction'],
    [{ metadata: 'pure-label:10000000-0000-4000-8000-000000000001' }, 'invalid_resumed_test_transaction'],
    [{ metadata: 'pure-verification:invalid-id' }, 'invalid_resumed_test_transaction'],
    [{ status: 'ERROR' }, 'invalid_resumed_test_transaction']
  ]) {
    const h = harness({ transactionChange });
    await assert.rejects(h.run({ ...environment, SHIPPO_VERIFY_TRANSACTION_ID: transactionId }), { verification_code: code });
    assert.ok(h.calls.every(call => call.init.method === 'GET' && !call.init.body));
    assert.equal(h.calls.some(call => call.url === pdfUrl), false);
    assert.equal(transactionPosts(h).length, 0);
  }
});

test('carrier diagnostics include bounded messages and authentication status while redacting secrets and URLs', async () => {
  const h = harness({
    carrierChange: { object_info: { authentication: { status: 'SUCCESS' } } },
    shipmentChange: { messages: [
      { source: 'Canada Post', code: 'fixture_warning', text: 'Account ' + TEST_TOKEN + ' is unavailable. ' + LIVE_TOKEN + ' https://example.test/private' },
      { source: TEST_TOKEN, code: LIVE_TOKEN, text: 'x'.repeat(1000) }
    ] }
  });
  const result = await h.run();
  assert.equal(result.live_carriers[0].authentication_status, 'SUCCESS');
  assert.equal(result.test_carriers[0].authentication_status, 'SUCCESS');
  assert.equal(result.carrier_messages.length, 2);
  assert.equal(result.carrier_messages[0].source, 'Canada Post');
  assert.equal(result.carrier_messages[0].code, 'fixture_warning');
  assert.match(result.carrier_messages[0].text, /\[redacted\]/);
  assert.match(result.carrier_messages[0].text, /\[url omitted\]/);
  assert.equal(result.carrier_messages[1].text.length, 350);
  const logs = JSON.stringify(h.logs);
  for (const secret of [TEST_TOKEN, LIVE_TOKEN, 'https://example.test/private']) assert.ok(!logs.includes(secret));
});

test('PDF_4x6 accepts Shippo documented 102×153 mm UPS Canada output without altering the label', async () => {
  const result = await pdfDimensions(await fixturePdf('0 0 289.134 433.701'));
  assert.equal(result.format, 'PDF_4x6');
  assert.equal(result.page_geometry[0].effective_width_points, 289.134);
  assert.equal(result.page_geometry[0].effective_height_points, 433.701);
  await assert.rejects(pdfDimensions(await fixturePdf('0 0 297.638 419.528')), error => error.verification_code === 'pdf_is_not_4x6', 'A6 is a different label format');
});
