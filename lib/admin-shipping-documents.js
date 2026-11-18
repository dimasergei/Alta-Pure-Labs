'use strict';

const shipping = require('./admin-shipping-labels');
const ID = /^[a-f0-9]{32}$/i;
// Leave room below Vercel's 4.5 MB buffered response limit.
const PDF_LIMIT = 4 * 1024 * 1024;
// Exact delivery hosts in Shippo's official transaction response examples.
// Never accept a browser-supplied URL or a general-purpose S3 hostname.
const DELIVERY_HOSTS = new Set(['deliver.goshippo.com', 'shippo-delivery.s3.amazonaws.com']);
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const discardBody = async response => { try { await response.body?.cancel?.(); } catch {} };

function documentUrl(value) {
  let url;
  try { url = new URL(value); } catch { fail(502, 'The label file address could not be verified. Refresh the label and retry.'); }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !DELIVERY_HOSTS.has(url.hostname)) {
    fail(502, 'The label file host could not be verified. Refresh the label and retry.');
  }
  url.hash = '';
  return url;
}

async function downloadPdf(value, options = {}) {
  let url = documentUrl(value);
  const fetcher = options.fetch || fetch;
  const signal = AbortSignal.timeout(20000);
  for (let redirects = 0; redirects <= 3; redirects++) {
    let response;
    try {
      response = await fetcher(url.href, { method: 'GET', redirect: 'manual', credentials: 'omit',
        headers: { Accept: 'application/pdf' }, signal });
    } catch { fail(503, 'The label file is temporarily unavailable. Refresh the label and retry.'); }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await discardBody(response);
      if (!location || redirects === 3) fail(502, 'The label file redirect could not be verified.');
      try { url = documentUrl(new URL(location, url).href); }
      catch (error) { if (error.status) throw error; fail(502, 'The label file redirect could not be verified.'); }
      continue;
    }
    if (!response.ok) { await discardBody(response); fail(502, 'The label file could not be downloaded. Refresh the label and retry.'); }
    const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (type && !['application/pdf', 'application/octet-stream', 'binary/octet-stream'].includes(type)) {
      await discardBody(response);
      fail(502, 'The shipping provider did not return a PDF.');
    }
    const declaredSize = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredSize) && declaredSize > PDF_LIMIT) {
      await discardBody(response);
      fail(502, 'The label file exceeds the supported size.');
    }
    let bytes;
    try {
      if (response.body?.getReader) {
        const reader = response.body.getReader(), chunks = [];
        let length = 0;
        while (true) {
          const { value: chunk, done } = await reader.read();
          if (done) break;
          length += chunk.byteLength;
          if (length > PDF_LIMIT) { try { await reader.cancel(); } catch {} fail(502, 'The label file exceeds the supported size.'); }
          chunks.push(Buffer.from(chunk));
        }
        bytes = Buffer.concat(chunks, length);
      } else bytes = Buffer.from(await response.arrayBuffer());
    } catch (error) { if (error.status) throw error; fail(503, 'The label file download was interrupted. Please retry.'); }
    if (bytes.length > PDF_LIMIT) fail(502, 'The label file exceeds the supported size.');
    if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) fail(502, 'The shipping provider did not return a PDF.');
    return bytes;
  }
  fail(502, 'The label file could not be downloaded.');
}

async function readDocument(db, input, options = {}) {
  const kind = input.kind || 'label';
  if (!['label', 'customs'].includes(kind)) fail(400, 'Choose a label or customs PDF.');
  const row = await shipping.labelRow(db, input);
  if (row.status !== 'created' || !ID.test(row.transaction_id || '')) fail(409, 'This label is not ready to download. Check its status first.');
  // Always refresh from the stored, verified transaction. This is a GET, never
  // a purchase. It also detects provider refunds before serving the document.
  const refreshed = await shipping.handleAction(db, { ...input, action: 'shipping_label_refresh' }, options);
  if (refreshed.label.status !== 'created') fail(409, 'This label is no longer available for shipping. Refresh the order to review its status.');
  const url = kind === 'customs' ? refreshed.label.customs_url : refreshed.label.label_url;
  if (!url) fail(404, kind === 'customs' ? 'No customs PDF is available for this label.' : 'The label PDF is not available yet. Check its status again.');
  const bytes = await downloadPdf(url, options);
  return { bytes, filename: `PURE-${kind}-${row.order_id.slice(0, 8)}-${row.id.slice(0, 8)}.pdf` };
}

async function reconcile(db, input, options = {}) {
  const row = await shipping.labelRow(db, input);
  if (row.transaction_id) return shipping.handleAction(db, { ...input, action: 'shipping_label_refresh' }, options);
  if (!['purchasing', 'review'].includes(row.status)) fail(409, 'There is no pending label purchase to check.');
  const optionsForRow = { ...options, env: { ...(options.env || process.env), SHIPPO_MODE: row.test_mode ? 'test' : 'live' } };
  const started = Date.parse(row.purchased_at || row.created_at);
  if (!Number.isFinite(started)) fail(409, 'The purchase date needs review before this label can be reconciled.');
  const fetcher = options.fetch || fetch;
  const deadline = AbortSignal.timeout(40000);
  optionsForRow.fetch = (url, request) => fetcher(url, { ...request, signal: AbortSignal.any([request.signal, deadline]) });
  const lower = new Date(Math.min(started, Date.now()) - 120000).toISOString();
  const upper = new Date(Date.now()).toISOString();
  const matches = new Map();
  let complete = false;
  for (let page = 1; page <= 5; page++) {
    const query = new URLSearchParams({ results: '100', page: String(page), object_created_gte: lower, object_created_lte: upper });
    const result = await shipping.shippo('/transactions/?' + query, null, optionsForRow);
    if (!Array.isArray(result.results)) fail(502, 'The shipping provider returned an unreadable purchase history.');
    for (const transaction of result.results) {
      if (transaction.metadata !== 'pure-label:' + row.id) continue;
      const rate = typeof transaction.rate === 'string' ? transaction.rate : transaction.rate?.object_id;
      if (!ID.test(transaction.object_id || '') || transaction.test !== row.test_mode || rate?.toLowerCase() !== row.selected_rate?.id?.toLowerCase()) {
        fail(409, 'A provider record needs review before this purchase can be reconciled.');
      }
      matches.set(transaction.object_id, transaction);
    }
    if (matches.size > 1) fail(409, 'More than one provider transaction matches this purchase. Keep the order on hold while the duplicate is reviewed.');
    if (!result.next) { complete = true; break; }
  }
  if (!complete) fail(409, 'The provider history is too large to confirm this purchase automatically. The purchase remains on hold for review.');
  if (matches.size !== 1) fail(409, 'No matching label has been confirmed yet. Check again shortly. A repeat purchase remains blocked.');
  const match = [...matches.values()][0];
  // Retrieve the match individually for its current status and fresh PDF URLs.
  const transaction = await shipping.shippo('/transactions/' + match.object_id + '/', null, optionsForRow);
  return shipping.recordTransaction(db, row, transaction);
}

module.exports = { readDocument, reconcile, downloadPdf, documentUrl };
