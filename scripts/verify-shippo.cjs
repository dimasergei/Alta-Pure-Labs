'use strict';

// Opt-in server/build verification. This module never connects to PURE's database,
// never uses a customer address, and never POSTs with a live credential.
const { randomUUID } = require('node:crypto');
const shipping = require('../lib/admin-shipping-labels');
const ID = /^[a-f0-9]{32}$/i;
const fail = code => { throw Object.assign(new Error('Shippo verification failed.'), { verification_code: code }); };

// Public civic addresses are test fixtures only, not PURE's ship-from address.
// https://www.toronto.ca/city-government/council/city-council/city-hall/
// https://ottawa.ca/en/recreation-and-parks/facilities/place-listing/heritage-building-and-ottawa-city-hall
const sender = { name: 'PURE SANDBOX ONLY', street1: '100 Queen St W', city: 'Toronto', state: 'ON', zip: 'M5H 2N2', country: 'CA', phone: '4165550100' };
const recipient = { name: 'SAMPLE DO NOT MAIL', street1: '110 Laurier Ave W', city: 'Ottawa', state: 'ON', zip: 'K1P 1J1', country: 'CA', phone: '6135550100' };
const packed = { length: '20', width: '15', height: '10', distance_unit: 'cm', weight: '500', mass_unit: 'g' };

function pdfDimensions(bytes) {
  if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) fail('label_not_pdf');
  const boxes = [...bytes.toString('latin1').matchAll(/\/MediaBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/g)];
  if (!boxes.length) fail('pdf_dimensions_need_inspection');
  const sizes = boxes.map(x => [Math.abs(Number(x[3]) - Number(x[1])), Math.abs(Number(x[4]) - Number(x[2]))].sort((a, b) => a - b));
  if (sizes.some(([w, h]) => Math.abs(w - 288) > 1 || Math.abs(h - 432) > 1)) fail('pdf_is_not_4x6');
  return { width_inches: 4, height_inches: 6, verified_page_boxes: sizes.length };
}

async function verify({ env = process.env, fetch: fetcher = fetch, log = value => console.log('PURE_SHIPPO_VERIFY ' + JSON.stringify(value)) } = {}) {
  let stage = 'configuration';
  let transactionPosts = 0;
  const report = { test: true, live_postage_purchases: 0 };
  try {
    const modes = {
      test: { ...env, SHIPPO_MODE: 'test' },
      live: { ...env, SHIPPO_MODE: 'live', SHIPPO_ALLOW_LIVE_PURCHASES: 'false' }
    };
    if (!shipping.config(modes.test).configured) fail('valid_test_token_required');
    if (!shipping.config(modes.live).configured) fail('valid_live_token_required');
    async function request(mode, path, body) {
      if (mode === 'live' && body) fail('live_write_forbidden');
      if (body && !/^shippo_test_[A-Za-z0-9]+$/.test(shipping.config(modes[mode]).key)) fail('test_token_required_for_write');
      if (path === '/transactions/' && body) {
        if (transactionPosts++) fail('transaction_retry_forbidden');
      }
      return shipping.shippo(path, body, { env: modes[mode], fetch: fetcher });
    }
    async function carriers(mode) {
      const all = [];
      for (let page = 1; page <= 10; page++) {
        // Construct each page locally; never forward authorization to a next URL.
        const result = await request(mode, '/carrier_accounts/?results=100&page=' + page, null);
        if (!Array.isArray(result.results)) fail('invalid_carrier_response');
        all.push(...result.results);
        if (!result.next) return all;
      }
      fail('too_many_carrier_pages');
    }
    function carrierSummary(accounts) {
      return accounts.map(x => ({ carrier: /^[a-z0-9_]{1,50}$/.test(x.carrier) ? x.carrier : 'other', active: x.active === true, shippo_account: x.is_shippo_account === true }));
    }

    stage = 'live_read_only_connection';
    const liveAccounts = await carriers('live');
    report.live_authentication = 'passed';
    report.live_carriers = carrierSummary(liveAccounts);
    log({ stage, ...report });
    if (!liveAccounts.some(x => x.active === true && ['canada_post', 'ups'].includes(x.carrier))) fail('no_active_canadian_carrier');

    stage = 'test_connection';
    const testAccounts = await carriers('test');
    report.test_carriers = carrierSummary(testAccounts);
    const canadianAccounts = testAccounts.filter(x => x.active === true && ['canada_post', 'ups'].includes(x.carrier) && ID.test(x.object_id));
    if (!canadianAccounts.length) fail('no_active_canadian_test_carrier');
    log({ stage, test_carriers: report.test_carriers });

    stage = 'canadian_test_rates';
    const metadata = 'pure-verification:' + randomUUID();
    const shipment = await request('test', '/shipments/', {
      address_from: shipping.address(sender, 'Sender'), address_to: shipping.address(recipient, 'Recipient'),
      parcels: [shipping.parcel(packed)], carrier_accounts: canadianAccounts.map(x => x.object_id), async: false, metadata
    });
    if (shipment.test !== true || !ID.test(shipment.object_id)) fail('test_shipment_not_confirmed');
    const rates = shipping.ratesFrom(shipment);
    if (!rates.length) fail('no_canadian_test_rates');
    // Prefer Canada Post, whose Shippo account explicitly supports Canadian tests.
    const rate = rates.find(x => /canada\s*post/i.test(x.carrier)) || rates[0];
    report.test_rate_count = rates.length;
    report.test_carrier = rate.carrier;
    report.test_service = rate.service;
    log({ stage, status: 'passed', rate_count: rates.length, carrier: rate.carrier, service: rate.service, currency: rate.currency });

    stage = 'test_label';
    let transaction = await request('test', '/transactions/', { rate: rate.id, label_file_type: 'PDF_4x6', async: false, metadata });
    const transactionId = transaction.object_id;
    if (!ID.test(transactionId)) fail('missing_test_transaction');
    function checkTransaction(value) {
      const returnedRate = typeof value.rate === 'string' ? value.rate : value.rate?.object_id;
      if (value.test !== true || value.object_id !== transactionId || returnedRate !== rate.id || value.metadata !== metadata) fail('test_transaction_mismatch');
    }
    checkTransaction(transaction);
    // A pending result is read again; the transaction POST is never repeated.
    for (let i = 0; i < 4 && ['WAITING', 'QUEUED'].includes(transaction.status); i++) {
      await new Promise(resolve => setTimeout(resolve, 1500));
      transaction = await request('test', '/transactions/' + transactionId + '/', null);
      checkTransaction(transaction);
    }
    if (transaction.status !== 'SUCCESS' || !shipping.safeUrl(transaction.label_url)) fail('test_label_not_successful');
    report.test_transaction_id = transactionId;
    report.test_label_status = transaction.status;
    log({ stage, status: 'passed', test: true, transaction_id: transactionId });

    stage = 'refresh_test_label';
    transaction = await request('test', '/transactions/' + transactionId + '/', null);
    checkTransaction(transaction);
    const pdfUrl = shipping.safeUrl(transaction.label_url);
    if (transaction.status !== 'SUCCESS' || !pdfUrl) fail('test_label_refresh_failed');
    report.refresh = 'passed';

    stage = 'test_pdf';
    // No Shippo credential is ever included in the label download.
    const pdf = await fetcher(pdfUrl, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(25000) });
    if (!pdf.ok) fail('test_pdf_download_failed');
    const bytes = Buffer.from(await pdf.arrayBuffer());
    if (bytes.length > 10 * 1024 * 1024) fail('unexpected_pdf_size');
    report.pdf = pdfDimensions(bytes);
    report.status = 'passed';
    report.test_label_transactions = transactionPosts;
    log(report);
    return report;
  } catch (error) {
    // Raw provider payloads, request headers, environment and URLs never enter logs.
    log({ status: 'failed', stage, code: error.verification_code || 'provider_request_failed',
      ...(Number.isInteger(error.status) ? { http_status: error.status } : {}), live_postage_purchases: 0 });
    throw Object.assign(new Error('Shippo verification did not pass; see the sanitized verification result.'), { verification_code: error.verification_code || 'provider_request_failed' });
  }
}

if (require.main === module) {
  if (process.argv.includes('--if-enabled') && process.env.SHIPPO_VERIFY_ON_BUILD !== '1') {
    console.log('Shippo provider verification is opt-in; no provider requests made.');
  } else verify().catch(() => { process.exitCode = 1; });
}

module.exports = { verify, pdfDimensions };
