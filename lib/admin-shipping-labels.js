'use strict';

const { randomUUID } = require('node:crypto');
const { loadFulfillmentSheet } = require('./admin-fulfillment-sheet');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHIPPO_ID = /^[a-f0-9]{32}$/i;
const ACTIVE = ['purchasing', 'created', 'review'];
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const checked = result => { if (result.error) throw result.error; return result.data; };

function clean(value, max = 200) {
  if (value == null) return '';
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value) || value.length > max) fail(400, 'A shipping field is invalid or too long.');
  return value.trim();
}
function config(env = process.env) {
  const key = env.SHIPPO_API_KEY || '';
  return { key, configured: /^shippo_(?:live|test)_[A-Za-z0-9]+$/.test(key), test: key.startsWith('shippo_test_') };
}
function identity(input) {
  const id = input.id || input.order_id;
  const source = input.source;
  if (!UUID.test(id || '') || !['commerce', 'store'].includes(source)) fail(400, 'Choose a physical order to create a shipping label.');
  return { id, source };
}
function address(input, label) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, `${label} address is required.`);
  const output = Object.fromEntries(['name', 'company', 'street1', 'street2', 'city', 'state', 'zip', 'country', 'phone', 'email'].map(k => [k, clean(input[k], k === 'email' ? 254 : 120)]));
  output.country = output.country.toUpperCase();
  if (!['name', 'street1', 'city', 'zip', 'country'].every(k => output[k]) || !/^[A-Z]{2}$/.test(output.country)) fail(400, `Complete the ${label.toLowerCase()} name and address, including a two-letter country code.`);
  if (['US', 'CA'].includes(output.country) && !output.state) fail(400, `${label} state or province is required.`);
  if (output.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(output.email)) fail(400, `${label} email is invalid.`);
  return output;
}
function decimal(value, label, maximum = 10000) {
  const raw = String(value ?? '');
  if (!/^\d+(?:\.\d{1,4})?$/.test(raw) || Number(raw) <= 0 || Number(raw) > maximum) fail(400, `Enter a valid ${label}.`);
  return raw;
}
function parcel(input = {}) {
  if (!['in', 'cm'].includes(input.distance_unit) || !['lb', 'oz', 'g', 'kg'].includes(input.mass_unit)) fail(400, 'Choose valid parcel units.');
  return {
    length: decimal(input.length, 'parcel length', 300), width: decimal(input.width, 'parcel width', 300),
    height: decimal(input.height, 'parcel height', 300), weight: decimal(input.weight, 'packed weight', 100000),
    distance_unit: input.distance_unit, mass_unit: input.mass_unit
  };
}
function toAddress(sheet) {
  const a = sheet.ship_to;
  return { name: a.recipient, company: a.organization, street1: a.line1, street2: a.line2, city: a.city, state: a.region, zip: a.postal_code, country: a.country, phone: a.phone, email: a.email };
}
function snapshot(order, source) {
  if (source === 'commerce') return { version: order.version, status: order.status, address: order.request_data?.address ?? null, items: order.request_data?.items ?? null };
  return { payment_status: order.payment_status, fulfillment_status: order.fulfillment_status, shipping_address: order.shipping_address ?? null, shipping_name: order.shipping_name ?? null, tracking_number: order.tracking_number ?? null };
}
async function loadOrder(db, input) {
  const { id, source } = identity(input);
  const order = checked(await db.from(source === 'commerce' ? 'commerce_invoices' : 'store_orders').select('*').eq('id', id).maybeSingle());
  if (!order) fail(404, 'Order not found.');
  const sheet = await loadFulfillmentSheet(db, new URLSearchParams({ id, source }));
  let reason = sheet.release.ready ? '' : sheet.release.reason;
  // An earlier order may not record its service. Selecting a quoted carrier
  // service here resolves that omission; it does not excuse an incomplete address.
  if (sheet.release.title === 'HOLD - SHIPPING DETAILS NEED REVIEW' && sheet.shipping_service.startsWith('Not recorded') &&
      ['recipient', 'line1', 'city', 'region', 'postal_code', 'country'].every(k => sheet.ship_to[k])) reason = '';
  if (order.cancellation_status) reason = 'This order has a cancellation request. Resolve it before purchasing postage.';
  if (order.tracking_number) reason = 'Tracking is already recorded. Review the existing shipment before creating another label.';
  return { id, source, order, sheet, reason, order_snapshot: snapshot(order, source) };
}
function moneyCents(value) {
  const raw = String(value ?? '');
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) return null;
  const [whole, fraction = ''] = raw.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) && cents > 0 && cents <= 10000000 ? cents : null;
}
function ratesFrom(shipment) {
  return (Array.isArray(shipment.rates) ? shipment.rates : []).flatMap(rate => {
    const cents = moneyCents(rate.amount);
    if (!SHIPPO_ID.test(rate.object_id || '') || cents === null || !['USD', 'CAD'].includes(rate.currency)) return [];
    return [{ id: rate.object_id, amount_cents: cents, currency: rate.currency, carrier: clean(rate.provider, 80), service: clean(rate.servicelevel?.name || rate.servicelevel?.token, 100), estimated_days: Number.isSafeInteger(rate.estimated_days) ? rate.estimated_days : null }];
  }).sort((a, b) => a.currency.localeCompare(b.currency) || a.amount_cents - b.amount_cents);
}
function carrierMessages(shipment) {
  const messages = [shipment.messages || [], ...(shipment.rates || []).map(x => x.messages || [])].flat();
  return [...new Set(messages.map(x => [x.source, x.code, x.text].filter(v => typeof v === 'string').join(' · ').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 500)).filter(Boolean))].slice(0, 12);
}
function safeUrl(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password ? u.href : null; } catch { return null; }
}
function publicLabel(row) {
  return {
    id: row.id, status: row.status, test: row.test_mode, created_at: row.created_at, expires_at: row.expires_at,
    rates: row.status === 'quoted' ? row.rate_options : [], rate: row.selected_rate, warnings: row.warnings || [],
    tracking_number: row.tracking_number || '', label_url: safeUrl(row.label_url), tracking_url: safeUrl(row.tracking_url),
    customs_url: safeUrl(row.customs_url), transaction_id: row.transaction_id || '', message: row.message || '',
    recipient: row.recipient, sender: row.sender, parcel: row.parcel
  };
}
function customs(input, context, sender, packed) {
  if (sender.country === context.sheet.ship_to.country) return null;
  if (!input || input.certify !== true || !clean(input.certify_signer, 120)) fail(400, 'Complete and certify the customs declaration for this international shipment.');
  if (!Array.isArray(input.items) || input.items.length !== context.sheet.items.length) fail(400, 'Provide customs details for every order item.');
  const items = input.items.map((item, i) => {
    const orderItem = context.sheet.items[i];
    const description = clean(item.description, 256), origin = clean(item.origin_country, 2).toUpperCase(), tariff = clean(item.tariff_number, 12);
    if (description.length < 3 || !/^[A-Z]{2}$/.test(origin) || !/^\d{6,10}$/.test(tariff)) fail(400, 'Each customs item needs an accurate description, country of manufacture, and 6–10 digit tariff code.');
    return { description, quantity: orderItem.total, net_weight: decimal(item.net_weight, 'total net item weight'), mass_unit: packed.mass_unit,
      value_amount: decimal(item.value_amount, 'total declared item value', 1000000), value_currency: context.order.currency || 'USD', origin_country: origin, tariff_number: tariff };
  });
  if (items.reduce((sum, x) => sum + Number(x.net_weight), 0) > Number(packed.weight) + 0.0001) fail(400, 'Total net item weight cannot exceed the packed parcel weight.');
  // Shippo's generic recipient-paid enum is DDU; DAP is supported by only a
  // subset of carriers and would suppress rates during unrestricted shopping.
  const output = { contents_type: 'MERCHANDISE', contents_explanation: 'Sale of the declared merchandise', non_delivery_option: 'RETURN', certify: true, certify_signer: clean(input.certify_signer, 120), items, incoterm: input.incoterm === 'DDP' ? 'DDP' : 'DDU' };
  if (sender.country === 'US') {
    output.eel_pfc = clean(input.eel_pfc, 100);
    if (!output.eel_pfc) fail(400, 'Enter the applicable US export filing reference or exemption for this shipment.');
  }
  if (sender.country === 'CA' && input.b13a_filing_option) {
    const option = clean(input.b13a_filing_option, 50);
    if (!['FILED_ELECTRONICALLY', 'SUMMARY_REPORTING', 'NOT_REQUIRED'].includes(option)) fail(400, 'Choose a valid Canadian export filing option.');
    output.b13a_filing_option = option;
    if (input.b13a_number) output.b13a_number = clean(input.b13a_number, 100);
  }
  return output;
}
async function shippo(path, body, options = {}) {
  const settings = config(options.env);
  if (!settings.configured) fail(503, 'Connect a Shippo account before requesting rates or buying labels.');
  const fetcher = options.fetch || fetch;
  let response;
  try {
    response = await fetcher('https://api.goshippo.com' + path, {
      method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(25000),
      headers: { Authorization: 'ShippoToken ' + settings.key, 'Content-Type': 'application/json', 'SHIPPO-API-VERSION': '2018-02-08' },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
  } catch { fail(503, 'The shipping provider did not confirm the request.'); }
  let result;
  try { result = await response.json(); } catch { fail(503, 'The shipping provider returned an unreadable response.'); }
  if (!response.ok) {
    const message = response.status === 401 || response.status === 403 ? 'Shippo could not authorize this account. Check the shipping connection.' : 'Shippo rejected the request. Check the address, parcel, customs details, and carrier account.';
    throw Object.assign(new Error(message), { status: 502, provider_rejected: [400, 401, 403, 404, 422].includes(response.status) });
  }
  return result;
}
async function state(db, input, options = {}) {
  const context = await loadOrder(db, input);
  const rows = checked(await db.from('admin_shipping_labels').select('*').eq('order_id', context.id).eq('source', context.source).order('created_at', { ascending: false }).limit(10)) || [];
  const settings = config(options.env);
  return {
    configured: settings.configured, test_mode: settings.test, eligible: !context.reason, reason: context.reason,
    recipient: toAddress(context.sheet), items: context.sheet.items.map(x => ({ description: [x.product, x.variant].filter(Boolean).join(' '), quantity: x.total })),
    currency: context.order.currency || 'USD', shipping_service: context.sheet.shipping_service,
    sender: rows[0]?.sender || { name: 'PURE', email: 'support@getpurelabs.com' }, labels: rows.map(publicLabel)
  };
}
async function quote(db, input, options = {}) {
  const settings = config(options.env);
  if (!settings.configured) fail(503, 'Connect a Shippo account before requesting rates or buying labels.');
  const context = await loadOrder(db, input);
  if (context.reason) fail(409, context.reason);
  const prior = checked(await db.from('admin_shipping_labels').select('id').eq('order_id', context.id).eq('source', context.source).eq('test_mode', settings.test).in('status', ACTIVE).limit(1));
  if (prior?.length) fail(409, 'A label purchase already exists. Review its status before creating another shipment.');
  const sender = address(input.sender, 'Sender'), recipient = address(toAddress(context.sheet), 'Recipient'), packed = parcel(input.parcel);
  // The recipient comes from the saved order. Address changes use the audited order editor.
  const declaration = customs(input.customs, context, sender, packed), id = randomUUID();
  const shipment = await shippo('/shipments/', { address_from: sender, address_to: recipient, parcels: [packed], async: false, metadata: 'pure-label:' + id, ...(declaration ? { customs_declaration: declaration } : {}) }, options);
  if (!SHIPPO_ID.test(shipment.object_id || '')) fail(502, 'Shippo did not return a shipment reference.');
  const rateOptions = ratesFrom(shipment);
  if (!rateOptions.length) fail(409, 'No USD or CAD carrier rates were returned. Review the carrier account, address, parcel and customs details in Shippo.');
  if (shipment.test !== undefined && shipment.test !== settings.test) fail(409, 'Shippo returned a different test/live mode. Recheck the account connection.');
  const row = checked(await db.from('admin_shipping_labels').insert({ id, source: context.source, order_id: context.id, status: 'quoted', test_mode: settings.test,
    order_snapshot: context.order_snapshot, shipment_id: shipment.object_id, sender, recipient, parcel: packed, customs: declaration,
    rate_options: rateOptions, warnings: carrierMessages(shipment), expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString() }).select('*').single());
  return { label: publicLabel(row) };
}
async function labelRow(db, input) {
  const order = identity(input);
  if (!UUID.test(input.label_id || '')) fail(400, 'Choose a shipping label.');
  const row = checked(await db.from('admin_shipping_labels').select('*').eq('id', input.label_id).eq('order_id', order.id).eq('source', order.source).maybeSingle());
  if (!row) fail(404, 'Shipping label not found.');
  return row;
}
async function recordTransaction(db, row, transaction) {
  const id = transaction.object_id;
  const rateId = typeof transaction.rate === 'string' ? transaction.rate : transaction.rate?.object_id;
  if (!SHIPPO_ID.test(id || '') || transaction.metadata !== 'pure-label:' + row.id || !SHIPPO_ID.test(rateId || '') || rateId.toLowerCase() !== String(row.selected_rate?.id || '').toLowerCase() || transaction.test !== row.test_mode || row.transaction_id && row.transaction_id.toLowerCase() !== id.toLowerCase()) fail(409, 'The provider transaction does not match this shipping label. Review it in Shippo.');
  const providerStatus = ['WAITING', 'QUEUED', 'SUCCESS', 'ERROR', 'REFUNDPENDING', 'REFUNDREJECTED', 'REFUNDED'].includes(transaction.status) ? transaction.status : 'UNKNOWN';
  const messages = {
    SUCCESS: safeUrl(transaction.label_url) || safeUrl(row.label_url) ? (row.test_mode ? 'Test label only — not valid postage.' : 'Label purchased. Mark the order shipped only after carrier handoff.') : 'The carrier accepted this label, but its file is not available yet. Check status before buying another label.',
    ERROR: 'The carrier rejected this label. Review the shipment in Shippo before requesting new rates.',
    REFUNDPENDING: 'The postage refund is pending. Do not use this label or buy a replacement until Shippo confirms the refund.',
    REFUNDREJECTED: 'The postage refund was rejected. The existing label remains valid; review it before carrier handoff.',
    REFUNDED: 'Shippo confirmed the postage refund. This label is no longer valid. You may request a fresh rate.',
    UNKNOWN: 'The provider returned an unrecognized label status. Review this transaction in Shippo before continuing.'
  };
  // The row lock and transition rules live in SQL: a slow WAITING response must
  // never erase a label or tracking already confirmed by a concurrent refresh.
  const updated = checked(await db.rpc('pure_shipping_label_record', {
    p_id: row.id, p_transaction: id.toLowerCase(), p_rate: rateId.toLowerCase(), p_test_mode: transaction.test, p_provider_status: providerStatus,
    p_result: { label_url: safeUrl(transaction.label_url), tracking_number: clean(transaction.tracking_number, 180) || null,
      tracking_url: safeUrl(transaction.tracking_url_provider), customs_url: safeUrl(transaction.commercial_invoice_url),
      message: messages[providerStatus] || 'The carrier is still processing this label. Check status; do not buy another label.' }
  }));
  return { label: publicLabel(updated) };
}
async function purchase(db, input, options = {}) {
  const settings = config(options.env), row = await labelRow(db, input);
  if (!settings.configured || settings.test !== row.test_mode) fail(409, 'The shipping connection changed. Get a fresh rate before purchasing.');
  if (input.confirm_purchase !== true) fail(400, 'Review the postage price and confirm the label purchase.');
  const rate = (row.rate_options || []).find(x => x.id === input.rate_id);
  if (!rate || input.amount_cents !== rate.amount_cents || input.currency !== rate.currency) fail(409, 'The postage price changed. Review a fresh rate before purchasing.');
  // Atomic claim serializes duplicate tabs, verifies the paid order/address again,
  // and stores the purchase attempt BEFORE any charge can reach the provider.
  const claimResult = await db.rpc('pure_shipping_label_claim', { p_id: row.id, p_rate: rate.id, p_amount: rate.amount_cents, p_currency: rate.currency });
  if (claimResult.error) fail(409, 'This order or rate changed, or another label is already being purchased. Refresh the shipping details.');
  const claim = claimResult.data;
  if (!claim?.claimed) return { label: publicLabel(claim?.label || row) };
  const current = claim.label;
  try {
    // Never retry this POST automatically. A timeout is an unknown financial outcome.
    const result = await shippo('/transactions/', { rate: rate.id, label_file_type: 'PDF_4x6', async: false, metadata: 'pure-label:' + row.id }, options);
    return await recordTransaction(db, current, result);
  } catch (error) {
    const rejected = error.provider_rejected === true;
    const updated = checked(await db.from('admin_shipping_labels').update({ status: rejected ? 'failed' : 'review', message: rejected ? error.message + ' No label was purchased; request new rates after correcting the issue.' : 'Purchase outcome is unconfirmed. Check Shippo for this reference before retrying: pure-label:' + row.id, updated_at: new Date().toISOString() }).eq('id', row.id).in('status', ['purchasing', 'review']).select('*').maybeSingle());
    return { label: publicLabel(updated || current) };
  }
}
async function refresh(db, input, options = {}) {
  const row = await labelRow(db, input), settings = config(options.env);
  if (!settings.configured || settings.test !== row.test_mode) fail(409, 'Use the same shipping account mode that created this label.');
  const transactionId = row.transaction_id || clean(input.transaction_id, 32);
  if (!SHIPPO_ID.test(transactionId)) fail(409, 'Find this purchase in Shippo and enter its transaction ID to reconcile it. Do not purchase a duplicate label.');
  if (row.status === 'quoted') fail(409, 'This quote has not been purchased.');
  return recordTransaction(db, row, await shippo('/transactions/' + transactionId + '/', null, options));
}
async function handleAction(db, input, options = {}) {
  if (input.action === 'shipping_label_quote') return quote(db, input, options);
  if (input.action === 'shipping_label_buy') return purchase(db, input, options);
  if (input.action === 'shipping_label_refresh') return refresh(db, input, options);
  fail(400, 'Unknown shipping label action.');
}

module.exports = { state, handleAction, config, address, parcel, customs, ratesFrom, moneyCents, safeUrl, publicLabel, snapshot, shippo, recordTransaction, purchase };
