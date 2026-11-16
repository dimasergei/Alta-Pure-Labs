'use strict';

// Supplier-facing exports are deliberately allowlisted. Never serialize an invoice,
// its payment snapshot, admin notes, or supplier API payload into a download.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHIPPING = { standard: 'Standard UPS', express: 'Express UPS', next_day: 'UPS Next Day' };
const INVOICE_COLUMNS = 'id,created_at,kind,status,customer_name,customer_email,request_data,pricing,tracking_carrier,tracking_number';
const LEGACY_COLUMNS = 'id,order_number,created_at,customer_name,customer_email,organization,payment_status,fulfillment_status,shipping_name,shipping_address,tracking_carrier,tracking_number,store_order_items(product_id,product_name,variant_size,quantity,supplier_sku,supplier_name,lot_number)';
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const text = value => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
const read = result => { if (result.error) throw new Error('Fulfillment records unavailable.'); return result.data; };
const variantKey = item => `${item.id}|${item.size}`;
function quantity(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 100000) fail(409, 'An order quantity needs review before exporting.');
  return value;
}

function addressFields(address = {}, name = '', organization = '', email = '', phone = '') {
  address = address && typeof address === 'object' ? address : {};
  return {
    recipient: text(address.name || name), organization: text(organization),
    line1: text(address.line1 || address.address1), line2: text(address.line2 || address.address2),
    city: text(address.city), region: text(address.region || address.state),
    postal_code: text(address.postal_code || address.postal || address.zip), country: text(address.country),
    email: text(email), phone: text(phone || address.phone)
  };
}

function shippingService(order) {
  const quoted = order.pricing?.delivery_tax?.delivery;
  if (quoted?.service) return [text(quoted.carrier), text(quoted.service)].filter(Boolean).join(' / ');
  const selection = order.pricing?.delivery?.selection || order.request_data?.checkout?.delivery;
  return SHIPPING[selection?.shipping] || 'Not recorded - confirm before shipping';
}

function commerceItems(order, allocations) {
  const requested = order.request_data?.items;
  if (!Array.isArray(requested) || !requested.length) fail(409, 'This order has no physical items to export.');
  const pricing = new Map((order.pricing?.lines || []).map(item => [variantKey(item), item]));
  const assigned = new Map();
  for (const allocation of allocations) {
    if (assigned.has(allocation.variant_key)) fail(409, 'Duplicate fulfillment allocations need review before exporting.');
    assigned.set(allocation.variant_key, allocation);
  }
  const keys = new Set();
  const rows = requested.map(item => {
    const key = variantKey(item);
    if (keys.has(key)) fail(409, 'Duplicate order variants need review before exporting.');
    keys.add(key);
    const allocation = assigned.get(key);
    // Do not silently omit a line or use an old quantity after an order edit.
    if (allocation && (variantKey(allocation.item || {}) !== key || allocation.item.qty !== item.qty)) {
      fail(409, 'Order quantities and fulfillment allocations differ. Reconcile them before exporting.');
    }
    return row(item, pricing.get(key), allocation);
  });
  for (const allocation of allocations) {
    if (keys.has(allocation.variant_key)) continue;
    // Gifts added by the paid-order trigger are physical units, too. Unknown
    // orphan allocations must be reconciled instead of becoming extra shipments.
    if (allocation.item?.membership_gift !== true) fail(409, 'An extra fulfillment allocation needs review before exporting.');
    rows.push(row(allocation.item, null, allocation));
  }
  return rows;
}

function row(item, priced, allocation) {
  const total = quantity(item.qty);
  const free = item.membership_gift === true ? total : (priced?.bogo_free_units ?? 0);
  if (!Number.isSafeInteger(free) || free < 0 || free > total) fail(409, 'Promotional quantities need review before exporting.');
  return {
    product: text(item.name), variant: text(item.size), product_id: text(item.id),
    purchased: total - free, free, total,
    supplier: text(allocation?.supplier_name), route: text(allocation?.route || 'unassigned'),
    supplier_sku: allocation?.route === 'lotus' && allocation.product != null
      ? `Lotus product ${allocation.product} / ${allocation.vials} vial pack` : '',
    lot: '', fulfillment_status: text(allocation?.status || 'unallocated')
  };
}

function releaseState(sheet, job) {
  if (['void', 'canceled', 'cancelled', 'refunded'].includes(sheet.order_status) || sheet.payment_status === 'refunded') {
    return { ready: false, title: 'HOLD - DO NOT SHIP', reason: 'Order is canceled, void, or refunded. This sheet is for reference only.' };
  }
  if (['shipped', 'delivered', 'partially_shipped'].includes(sheet.order_status) || sheet.items.some(x => ['shipped', 'delivered'].includes(x.fulfillment_status))) {
    return { ready: false, title: 'REFERENCE ONLY - DO NOT SHIP AGAIN', reason: 'Shipment activity is already recorded. Reconcile the existing shipment.' };
  }
  if (sheet.payment_status === 'partially_refunded') {
    return { ready: false, title: 'HOLD - REFUND NEEDS RECONCILIATION', reason: 'DO NOT SHIP until the remaining quantities and refund have been confirmed.' };
  }
  if (sheet.payment_status !== 'paid') {
    return { ready: false, title: 'DRAFT - PAYMENT NOT CONFIRMED', reason: 'DO NOT SHIP. Confirm actual payment receipt before releasing fulfillment.' };
  }
  if (job?.supplier_id || job?.has_payload || sheet.items.some(x => x.fulfillment_status === 'ordered')) {
    return { ready: false, title: 'REFERENCE ONLY - SUPPLIER ACTIVITY EXISTS', reason: 'DO NOT SHIP AGAIN. Reconcile the existing supplier order before releasing another.' };
  }
  if (sheet.items.some(x => x.route === 'lotus')) {
    return { ready: false, title: 'LOTUS ROUTED - DO NOT SEND A DUPLICATE ORDER', reason: 'This order uses the Lotus integration. Check supplier sync before any manual release.' };
  }
  if (!['recipient', 'line1', 'city', 'region', 'postal_code', 'country'].every(k => sheet.ship_to[k]) || sheet.shipping_service.startsWith('Not recorded')) {
    return { ready: false, title: 'HOLD - SHIPPING DETAILS NEED REVIEW', reason: 'DO NOT SHIP until the recipient, full address, and shipping service are confirmed.' };
  }
  return { ready: true, title: 'PAYMENT CONFIRMED - FULFILLMENT SHEET', reason: 'Verify stock and destination before release. Downloading does not submit a supplier order.' };
}

function normalizeSheet({ order, source, allocations = [], jobs = [], generatedAt = new Date().toISOString() }) {
  if (!order || !UUID.test(order.id || '')) fail(404, 'Order not found.');
  let sheet;
  if (source === 'commerce') {
    if (order.kind !== 'goods') fail(409, 'Membership purchases have no physical fulfillment sheet.');
    const req = order.request_data || {};
    sheet = {
      id: order.id, source, order_number: `ORD-${order.id.slice(0, 8).toUpperCase()}`,
      order_type: req.bulk_order === true ? 'Bulk order' : req.research_builder === true ? 'Research builder order' : 'Product order',
      order_status: text(order.status),
      payment_status: ['paid', 'processing', 'shipped', 'delivered'].includes(order.status) ? 'paid' : order.status === 'refunded' ? 'refunded' : 'pending',
      ship_to: addressFields(req.address, req.name || order.customer_name, req.organization, order.customer_email, req.phone),
      shipping_service: shippingService(order),
      handling: req.checkout?.delivery?.extras?.includes('priority') ? 'Priority processing' : 'Standard processing',
      items: commerceItems(order, allocations), quantity_note: 'Purchased + free = total physical units to fulfill.'
    };
  } else if (source === 'store') {
    const items = order.store_order_items;
    if (!Array.isArray(items) || !items.length) fail(409, 'This order has no physical items to export.');
    sheet = {
      id: order.id, source, order_number: text(order.order_number || `ORD-${order.id.slice(0, 8).toUpperCase()}`),
      order_type: 'Product order', order_status: text(order.fulfillment_status), payment_status: text(order.payment_status),
      ship_to: addressFields(order.shipping_address, order.shipping_name || order.customer_name, order.organization, order.customer_email),
      shipping_service: text(order.shipping_address?.shipping_service || order.shipping_address?.service) || 'Not recorded - confirm before shipping',
      handling: 'Confirm handling requirements',
      items: items.map(x => ({ product: text(x.product_name), variant: text(x.variant_size), product_id: text(x.product_id),
        purchased: null, free: null, total: quantity(x.quantity), supplier: text(x.supplier_name), route: 'manual',
        supplier_sku: text(x.supplier_sku), lot: text(x.lot_number), fulfillment_status: text(order.fulfillment_status) })),
      quantity_note: 'Legacy records do not store a purchased/free breakdown. Total is the recorded physical quantity.'
    };
  } else fail(400, 'Invalid order source.');
  sheet.created_at = text(order.created_at);
  sheet.generated_at = text(generatedAt);
  sheet.tracking_carrier = text(order.tracking_carrier);
  sheet.tracking_number = text(order.tracking_number);
  const job = jobs[0];
  sheet.supplier_order = text(job?.supplier_id);
  sheet.supplier_reference = text(job?.reference);
  sheet.release = releaseState(sheet, job);
  return sheet;
}

async function loadFulfillmentSheet(db, params, options = {}) {
  const id = params.get('id'), source = params.get('source') || '';
  if (!UUID.test(id || '')) fail(400, 'Choose a valid order.');
  if (source === 'research_subscription') fail(409, 'Export the paid delivery order, not the recurring subscription record.');
  if (source && !['commerce', 'store'].includes(source)) fail(400, 'Invalid order source.');
  if (source !== 'store') {
    const order = read(await db.from('commerce_invoices').select(INVOICE_COLUMNS).eq('id', id).maybeSingle());
    if (order) {
      if (order.kind !== 'goods') fail(409, 'Membership purchases have no physical fulfillment sheet.');
      const [a, j] = await Promise.all([
        db.from('commerce_fulfillment_items').select('variant_key,item,route,supplier_name,product,vials,status').eq('invoice_id', id),
        db.from('commerce_supplier_jobs').select('supplier_id,reference,payload').eq('invoice_id', id)
      ]);
      const allocations = read(a) || [];
      const jobs = (read(j) || []).map(({ payload, ...job }) => ({ ...job, has_payload: payload != null }));
      return normalizeSheet({ order, source: 'commerce', allocations, jobs, ...options });
    }
    if (source === 'commerce') fail(404, 'Order not found.');
  }
  const order = read(await db.from('store_orders').select(LEGACY_COLUMNS).eq('id', id).maybeSingle());
  if (!order) fail(404, 'Order not found.');
  return normalizeSheet({ order, source: 'store', ...options });
}

function csvCell(value) {
  let output = String(value ?? '');
  // Supplier-provided product names and customer address fields are not trusted
  // spreadsheet formulas. Preserve text while disabling formula execution.
  if (/^[\s]*[=+@-]/.test(output)) output = "'" + output;
  return '"' + output.replaceAll('"', '""') + '"';
}
function buildFulfillmentCsv(sheet) {
  const rows = [
    ['AltaPure Labs - Supplier Fulfillment Sheet'], [sheet.release.title], [sheet.release.reason],
    ['Order', sheet.order_number], ['Order ID', sheet.id], ['Type', sheet.order_type],
    ['Created', sheet.created_at], ['Generated', sheet.generated_at],
    ['Payment status', sheet.payment_status], ['Order status', sheet.order_status],
    ['Recipient', sheet.ship_to.recipient], ['Organization', sheet.ship_to.organization],
    ['Address line 1', sheet.ship_to.line1], ['Address line 2', sheet.ship_to.line2],
    ['City', sheet.ship_to.city], ['State / Province', sheet.ship_to.region],
    ['Postal code', sheet.ship_to.postal_code], ['Country', sheet.ship_to.country],
    ['Contact email', sheet.ship_to.email], ['Contact phone', sheet.ship_to.phone],
    ['Shipping service', sheet.shipping_service], ['Handling', sheet.handling],
    ['Existing carrier', sheet.tracking_carrier], ['Existing tracking', sheet.tracking_number],
    ['Supplier order', sheet.supplier_order], ['Supplier reference', sheet.supplier_reference], [],
    ['Product', 'Strength / size', 'Product ID', 'Purchased quantity', 'Free quantity', 'Total fulfillment quantity', 'Supplier', 'Route', 'Supplier SKU / pack', 'Lot', 'Fulfillment status'],
    ...sheet.items.map(x => [x.product, x.variant, x.product_id, x.purchased ?? 'Not recorded', x.free ?? 'Not recorded', x.total, x.supplier, x.route, x.supplier_sku, x.lot, x.fulfillment_status]),
    [], ['Quantity note', sheet.quantity_note],
    ['Packing instructions', 'Verify exact products, strengths and total quantities. No substitutions without approval.'],
    ['Dispatch record', 'Carrier: __________________  Tracking: __________________  Packed by: __________________'],
    ['Research use only. Not for human or veterinary use.']
  ];
  return Buffer.from('\ufeff' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n', 'utf8');
}

// A dependency-free, selectable-text PDF. Fixed-width body text makes wrapping
// deterministic. Unsupported address glyphs fail clearly instead of being lost.
function pdfText(value) {
  const valueText = text(value).replace(/[\u2010-\u2015\u2212]/g, '-').replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/\u2026/g, '...');
  if (/[^\x20-\x7e\xa0-\xff]/.test(valueText)) fail(400, 'This order contains characters the PDF font cannot preserve. Download the UTF-8 CSV to keep the exact shipping details.');
  return valueText.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
}
function wrap(value, width = 91) {
  const result = []; let line = '';
  for (let word of text(value).split(' ')) {
    while (word.length > width) { if (line) result.push(line); result.push(word.slice(0, width)); word = word.slice(width); line = ''; }
    if (line && line.length + word.length + 1 > width) { result.push(line); line = word; }
    else line += (line ? ' ' : '') + word;
  }
  result.push(line); return result;
}
function buildFulfillmentPdf(sheet) {
  const rows = [];
  const add = (value = '', bold = false) => wrap(value).forEach(line => rows.push({ line, bold }));
  add(`${sheet.order_type} | Created: ${sheet.created_at}`);
  add(`Order ID: ${sheet.id}`);
  add(`Payment: ${sheet.payment_status.toUpperCase()} | Status: ${sheet.order_status}`);
  add(); add('SHIP TO', true);
  const a = sheet.ship_to;
  [a.recipient, a.organization, a.line1, a.line2, [a.city, a.region, a.postal_code].filter(Boolean).join(', '), a.country].filter(Boolean).forEach(v => add(v));
  add(`Email: ${a.email || 'Not recorded'} | Phone: ${a.phone || 'Not recorded'}`);
  add(`Shipping service: ${sheet.shipping_service}`); add(`Handling: ${sheet.handling}`);
  if (sheet.tracking_carrier || sheet.tracking_number) add(`Existing tracking: ${sheet.tracking_carrier} ${sheet.tracking_number}`);
  if (sheet.supplier_order) add(`Existing supplier order: ${sheet.supplier_order}`);
  if (sheet.supplier_reference) add(`Supplier reference: ${sheet.supplier_reference}`);
  add(); add('ITEMS TO FULFILL', true);
  for (const [index, item] of sheet.items.entries()) {
    add(`${index + 1}. ${item.product} | ${item.variant}`, true);
    add(`Purchased: ${item.purchased ?? 'not recorded'} | Free: ${item.free ?? 'not recorded'} | TOTAL UNITS: ${item.total}`);
    add(`Supplier: ${item.supplier || 'Unassigned'} | Route: ${item.route} | Status: ${item.fulfillment_status}`);
    if (item.supplier_sku || item.lot) add(`Supplier SKU: ${item.supplier_sku || 'Not recorded'} | Lot: ${item.lot || 'Not recorded'}`);
    add();
  }
  add(sheet.quantity_note);
  add('Verify exact products, strengths and total quantities. No substitutions without approval.');
  add(); add('DISPATCH RECORD', true);
  add('Carrier: __________________________ Tracking: ___________________________________');
  add('Packed by: ________________________ Dispatch date: ______________________________');
  add('Research use only. Not for human or veterinary use.');
  const pages = [];
  for (let i = 0; i < rows.length; i += 39) pages.push(rows.slice(i, i + 39));
  const objects = [];
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(`<< /Type /Pages /Kids [${pages.map((_, i) => `${6 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>');
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>');
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>');
  pages.forEach((page, i) => {
    const cmds = ['0.28 0.1 0.52 rg 0 768 612 24 re f'];
    const print = (v, font, size, x, y, color = '0.12 0.1 0.17') => cmds.push(`${color} rg BT /${font} ${size} Tf 1 0 0 1 ${x} ${y} Tm (${pdfText(v)}) Tj ET`);
    print('ALTAPURE LABS', 'F1', 17, 42, 737, '0.28 0.1 0.52');
    print('Supplier Fulfillment Sheet', 'F1', 13, 42, 714);
    print(sheet.order_number, 'F1', 11, 42, 693);
    cmds.push(`${sheet.release.ready ? '0.92 0.97 0.94' : '0.99 0.93 0.93'} rg 42 638 528 43 re f`);
    print(sheet.release.title, 'F1', 9.4, 50, 667, sheet.release.ready ? '0.1 0.35 0.2' : '0.55 0.13 0.13');
    wrap(sheet.release.reason, 94).forEach((s, n) => print(s, 'F2', 8.5, 50, 653 - n * 10));
    page.forEach((r, n) => print(r.line, r.bold ? 'F3' : 'F2', 9.4, 42, 617 - n * 13.5));
    cmds.push('0.85 0.81 0.91 RG 42 65 m 570 65 l S');
    print(`Generated ${sheet.generated_at}`, 'F2', 8, 42, 49);
    print(`Page ${i + 1} of ${pages.length}`, 'F2', 8, 491, 49);
    const stream = cmds.join('\n');
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents ${7 + i * 2} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
  });
  let pdf = '%PDF-1.4\n'; const offsets = [];
  objects.forEach((value, i) => { offsets.push(Buffer.byteLength(pdf, 'latin1')); pdf += `${i + 1} 0 obj\n${value}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(n => String(n).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

module.exports = { loadFulfillmentSheet, normalizeSheet, buildFulfillmentCsv, buildFulfillmentPdf };
