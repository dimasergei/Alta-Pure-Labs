'use strict';

// Opt-in server/build verification. This module never connects to PURE's database,
// never uses a customer address, and never POSTs with a live credential.
const { randomUUID } = require('node:crypto');
const { PDFDocument, PDFName, PDFNumber } = require('pdf-lib');
const shipping = require('../lib/admin-shipping-labels');
const ID = /^[a-f0-9]{32}$/i;
const VERIFICATION_METADATA = /^pure-verification:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LABEL_FORMATS = ['PDF', 'PDF_4x6', 'PDF_4x8', 'PDF_A4', 'PDF_A6', 'PNG', 'ZPLII'];
const fail = (code, details = {}) => { throw Object.assign(new Error('Shippo verification failed.'), { verification_code: code, ...details }); };

// Public civic addresses are test fixtures only, not PURE's ship-from address.
// https://www.toronto.ca/city-government/council/city-council/city-hall/
// https://ottawa.ca/en/recreation-and-parks/facilities/place-listing/heritage-building-and-ottawa-city-hall
const sender = { name: 'PURE SANDBOX ONLY', street1: '100 Queen St W', city: 'Toronto', state: 'ON', zip: 'M5H 2N2', country: 'CA', phone: '4165550100' };
const recipient = { name: 'SAMPLE DO NOT MAIL', street1: '110 Laurier Ave W', city: 'Ottawa', state: 'ON', zip: 'K1P 1J1', country: 'CA', phone: '6135550100' };
const packed = { length: '20', width: '15', height: '10', distance_unit: 'cm', weight: '500', mass_unit: 'g' };

async function pdfDimensions(bytes) {
  if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) fail('label_not_pdf');
  let document;
  try { document = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: true }); }
  catch { fail('label_pdf_unreadable'); }
  const pages = document.getPages();
  if (!pages.length || pages.length > 20) fail('unexpected_pdf_page_count');
  let geometry;
  try {
    geometry = pages.map((page, index) => {
      const media = page.getMediaBox(), crop = page.getCropBox();
      const userUnit = page.node.lookupMaybe(PDFName.of('UserUnit'), PDFNumber)?.asNumber() ?? 1;
      const rotation = ((page.getRotation().angle % 360) + 360) % 360;
      const values = [...Object.values(media), ...Object.values(crop), userUnit, rotation];
      if (!values.every(Number.isFinite) || userUnit <= 0 || rotation % 90 !== 0) fail('invalid_pdf_page_geometry');
      // CropBox defines the displayed/printed region, bounded by the MediaBox.
      const width = Math.max(0, Math.min(media.x + media.width, crop.x + crop.width) - Math.max(media.x, crop.x)) * userUnit;
      const height = Math.max(0, Math.min(media.y + media.height, crop.y + crop.height) - Math.max(media.y, crop.y)) * userUnit;
      const rotated = rotation === 90 || rotation === 270;
      const round = value => Math.round(value * 1000) / 1000;
      return { page: index + 1, media_box: Object.fromEntries(Object.entries(media).map(([k, v]) => [k, round(v)])),
        crop_box: Object.fromEntries(Object.entries(crop).map(([k, v]) => [k, round(v)])), user_unit: round(userUnit), rotation,
        effective_width_points: round(rotated ? height : width), effective_height_points: round(rotated ? width : height) };
    });
  } catch (error) { fail(error.verification_code || 'invalid_pdf_page_geometry'); }
  // Shippo documents both 4×6 inches and 102×153 mm for PDF_4x6. UPS Canada
  // returns the metric size (289.134×433.701 points); do not crop its label.
  // https://docs.goshippo.com/shipments/shipping-label-sizes
  const supportedSizes = [[288, 432], [102 * 72 / 25.4, 153 * 72 / 25.4]];
  if (geometry.some(page => {
    const [width, height] = [page.effective_width_points, page.effective_height_points].sort((a, b) => a - b);
    return !supportedSizes.some(([w, h]) => Math.abs(width - w) <= 1 && Math.abs(height - h) <= 1);
  })) fail('pdf_is_not_4x6', { pdf_geometry: geometry });
  return { format: 'PDF_4x6', nominal_width_inches: 4, nominal_height_inches: 6, verified_page_boxes: geometry.length, page_geometry: geometry };
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
    const resumeId = env.SHIPPO_VERIFY_TRANSACTION_ID || '';
    if (resumeId && (typeof resumeId !== 'string' || !ID.test(resumeId))) fail('invalid_resume_transaction');
    const secrets = [shipping.config(modes.test).key, shipping.config(modes.live).key, env.SHIPPO_API_KEY].filter(x => typeof x === 'string' && x);
    function sanitize(value, max = 300) {
      let result = typeof value === 'string' ? value : '';
      for (const secret of secrets) result = result.split(secret).join('[redacted]');
      return result.replace(/shippo_(?:live|test)_[A-Za-z0-9]+/g, '[redacted]')
        .replace(/https?:\/\/[^\s<>]+/g, '[url omitted]').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max);
    }
    async function request(mode, path, body) {
      if (mode === 'live' && body) fail('live_write_forbidden');
      if (resumeId && body) fail('resume_write_forbidden');
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
      return accounts.map(x => {
        const authentication = x.object_info?.authentication?.status;
        return { carrier: /^[a-z0-9_]{1,50}$/.test(x.carrier) ? sanitize(x.carrier, 50) : 'other', active: x.active === true, shippo_account: x.is_shippo_account === true,
          ...(typeof authentication === 'string' && /^[A-Za-z0-9_ -]{1,80}$/.test(authentication) ? { authentication_status: sanitize(authentication, 80) } : {}) };
      });
    }
    function carrierMessages(shipment) {
      return [shipment.messages, ...(Array.isArray(shipment.rates) ? shipment.rates.map(x => x.messages) : [])]
        .flatMap(messages => Array.isArray(messages) ? messages : []).slice(0, 20)
        .map(message => ({ source: sanitize(message?.source, 80), code: sanitize(message?.code, 80), text: sanitize(message?.text, 350) }));
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

    let metadata, rate, transaction, transactionId;
    if (resumeId) {
      stage = 'resume_test_label';
      transactionId = resumeId.toLowerCase();
      transaction = await request('test', '/transactions/' + transactionId + '/', null);
      metadata = transaction.metadata;
      rate = { id: typeof transaction.rate === 'string' ? transaction.rate : transaction.rate?.object_id };
      if (!VERIFICATION_METADATA.test(metadata || '') || !ID.test(rate.id || '') || !['SUCCESS', 'WAITING', 'QUEUED'].includes(transaction.status)) fail('invalid_resumed_test_transaction');
      report.reused_test_transaction = true;
    } else {
      stage = 'canadian_test_rates';
      metadata = 'pure-verification:' + randomUUID();
      const shipment = await request('test', '/shipments/', {
        address_from: shipping.address(sender, 'Sender'), address_to: shipping.address(recipient, 'Recipient'),
        parcels: [shipping.parcel(packed)], carrier_accounts: canadianAccounts.map(x => x.object_id), async: false, metadata
      });
      if (shipment.test !== true || !ID.test(shipment.object_id)) fail('test_shipment_not_confirmed');
      report.carrier_messages = carrierMessages(shipment);
      if (report.carrier_messages.length) log({ stage, carrier_messages: report.carrier_messages });
      const rates = shipping.ratesFrom(shipment);
      if (!rates.length) fail('no_canadian_test_rates');
      // Prefer Canada Post, whose Shippo account explicitly supports Canadian tests.
      rate = rates.find(x => /canada\s*post/i.test(x.carrier)) || rates[0];
      report.test_rate_count = rates.length;
      report.test_carrier = sanitize(rate.carrier, 80);
      report.test_service = sanitize(rate.service, 100);
      log({ stage, status: 'passed', rate_count: rates.length, carrier: report.test_carrier, service: report.test_service, currency: rate.currency });
      stage = 'test_label';
      transaction = await request('test', '/transactions/', { rate: rate.id, label_file_type: 'PDF_4x6', async: false, metadata });
      transactionId = transaction.object_id;
    }
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
    if (LABEL_FORMATS.includes(transaction.label_file_type)) report.reported_label_file_type = transaction.label_file_type;
    log({ stage, status: 'passed', test: true, transaction_id: transactionId, ...(report.reported_label_file_type ? { reported_label_file_type: report.reported_label_file_type } : {}) });

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
    report.pdf = await pdfDimensions(bytes);
    report.status = 'passed';
    report.test_label_transactions = transactionPosts;
    log(report);
    return report;
  } catch (error) {
    // Raw provider payloads, request headers, environment and URLs never enter logs.
    log({ status: 'failed', stage, code: error.verification_code || 'provider_request_failed',
      ...(Number.isInteger(error.status) ? { http_status: error.status } : {}),
      ...(error.pdf_geometry ? { pdf_geometry: error.pdf_geometry } : {}),
      ...(report.reported_label_file_type ? { reported_label_file_type: report.reported_label_file_type } : {}), live_postage_purchases: 0 });
    throw Object.assign(new Error('Shippo verification did not pass; see the sanitized verification result.'), { verification_code: error.verification_code || 'provider_request_failed' });
  }
}

if (require.main === module) {
  if (process.argv.includes('--if-enabled') && process.env.SHIPPO_VERIFY_ON_BUILD !== '1') {
    console.log('Shippo provider verification is opt-in; no provider requests made.');
  } else verify().catch(() => { process.exitCode = 1; });
}

module.exports = { verify, pdfDimensions };
