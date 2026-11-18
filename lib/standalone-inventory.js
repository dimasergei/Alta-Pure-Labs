'use strict';

// Personally owned stock only. This module never reads the storefront catalog,
// customer orders, supplier records, payment systems, or fulfillment services.
const { createHash } = require('node:crypto');
const { assertAdmin } = require('./admin-auth');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SKU = /^[A-Z0-9][A-Z0-9._-]{0,63}$/;
const UNITS = new Set(['vial', 'pen', 'bottle', 'pack', 'unit']);
const CURRENCIES = new Set(['CAD', 'USD']);
const MAX_QUANTITY = 2147483647;
const MAX_COST = 9999999999.99;
const MAX_ITEMS = 5000;
const MAX_IMPORT = 500;
const ITEM_COLUMNS = 'id,sku,product_name,strength,unit,quantity,minimum,unit_cost,currency,location,notes,archived,version,created_at,updated_at';
const EVENT_COLUMNS = 'id,item_id,action,mode,sku,product_name,strength,quantity_before,quantity_after,reason,changes,created_at';
const ITEM_FIELDS = ['sku', 'product_name', 'strength', 'unit', 'quantity', 'minimum', 'unit_cost', 'currency', 'location', 'notes'];
const META_FIELDS = ITEM_FIELDS.filter(key => key !== 'quantity');

function fail(status, message, code = 'INVALID_INPUT') {
  throw Object.assign(new Error(message), { status, code });
}
function object(value, message) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, message);
  return value;
}
function fields(value, allowed) {
  if (Object.keys(value).some(key => !allowed.includes(key))) fail(400, 'The inventory request contains an unsupported field.');
}
function text(value, label, maximum, required = false, multiline = false) {
  if (typeof value !== 'string' || value.length > maximum ||
      (multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(value)) {
    fail(400, `Enter a valid ${label}, up to ${maximum} characters.`);
  }
  const clean = value.trim();
  if (required && !clean) fail(400, `Enter ${label}.`);
  return clean;
}
function integer(value, label, { nullable = false, positive = false } = {}) {
  if (nullable && value === null) return null;
  if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0) || value > MAX_QUANTITY) {
    fail(400, `${label} must be a whole number from ${positive ? 1 : 0} to ${MAX_QUANTITY}.`);
  }
  return value;
}
function normalizeItem(value, partial = false) {
  object(value, 'Enter inventory item details.');
  fields(value, partial ? META_FIELDS : ITEM_FIELDS);
  if (partial && !Object.keys(value).length) fail(400, 'Choose at least one item detail to update.');
  const input = partial ? { ...value } : {
    strength: '', unit: 'vial', quantity: null, minimum: 0, unit_cost: null,
    currency: 'USD', location: '', notes: '', ...value
  };
  if (!partial && (!Object.hasOwn(input, 'sku') || !Object.hasOwn(input, 'product_name'))) {
    fail(400, 'Enter a SKU and product name.');
  }
  const output = {};
  for (const key of ITEM_FIELDS) {
    if (!Object.hasOwn(input, key)) continue;
    const v = input[key];
    switch (key) {
      case 'sku': {
        const sku = text(v, 'SKU', 64, true).toUpperCase();
        if (!SKU.test(sku)) fail(400, 'SKU must start with a letter or number and use only letters, numbers, dots, underscores, or hyphens.');
        output.sku = sku; break;
      }
      case 'product_name': output[key] = text(v, 'product name', 160, true); break;
      case 'strength': output[key] = text(v, 'strength or size', 80); break;
      case 'location': output[key] = text(v, 'location', 120); break;
      case 'notes': output[key] = text(v, 'notes', 2000, false, true); break;
      case 'unit':
        if (!UNITS.has(v)) fail(400, 'Choose vial, pen, bottle, pack, or unit.');
        output[key] = v; break;
      case 'currency':
        if (!CURRENCIES.has(v)) fail(400, 'Choose CAD or USD for the unit cost.');
        output[key] = v; break;
      case 'quantity': output[key] = integer(v, 'Quantity', { nullable: true }); break;
      case 'minimum': output[key] = integer(v, 'Minimum'); break;
      case 'unit_cost':
        if (v !== null && (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > MAX_COST ||
            Math.abs(v * 100 - Math.round(v * 100)) > 0.0001)) {
          fail(400, 'Unit cost must be blank or a nonnegative number with at most two decimal places.');
        }
        output[key] = v === null ? null : Math.round(v * 100) / 100; break;
    }
  }
  return output;
}
function normalizeBatch(items) {
  if (!Array.isArray(items) || items.length < 1 || items.length > MAX_IMPORT) {
    fail(400, `Import between 1 and ${MAX_IMPORT} new items.`);
  }
  const seen = new Set();
  return items.map((value, index) => {
    let item;
    try { item = normalizeItem(value); }
    catch (error) {
      if (error.status === 400) fail(400, `Row ${index + 1}: ${error.message}`);
      throw error;
    }
    if (seen.has(item.sku)) fail(409, `Row ${index + 1}: SKU ${item.sku} appears more than once in this import.`, 'DUPLICATE_SKU');
    seen.add(item.sku);
    return item;
  });
}
function parseBody(req) {
  if (String(req.headers?.['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'application/json') fail(415, 'JSON required.');
  let raw;
  try { raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body); }
  catch { fail(400, 'Invalid inventory request.'); }
  if (!raw) fail(400, 'Invalid inventory request.');
  if (Buffer.byteLength(raw, 'utf8') > 2 * 1024 * 1024) fail(413, 'Inventory request is too large. Import at most 500 rows.');
  let body;
  try { body = JSON.parse(raw); } catch { fail(400, 'Invalid inventory request.'); }
  object(body, 'Invalid inventory request.');
  return body;
}
function normalizeCommand(body) {
  object(body, 'Invalid inventory request.');
  if (!UUID.test(body.request_id || '')) fail(400, 'A valid request ID is required.');
  const common = ['action', 'request_id', 'reason'];
  let payload;
  if (body.action === 'create') {
    fields(body, [...common, 'item']);
    payload = { action: 'create', item: normalizeItem(body.item) };
  } else if (body.action === 'import' || body.action === 'preview_import') {
    fields(body, [...common, 'items']);
    payload = { action: body.action, items: normalizeBatch(body.items) };
  } else if (['update', 'adjust', 'archive'].includes(body.action)) {
    const allowed = body.action === 'update' ? ['item'] : body.action === 'adjust' ? ['mode', 'quantity'] : ['archived'];
    fields(body, [...common, 'id', 'expected_version', ...allowed]);
    if (!UUID.test(body.id || '')) fail(400, 'Choose an inventory item.');
    integer(body.expected_version, 'Item version', { positive: true });
    payload = { action: body.action, id: body.id.toLowerCase(), expected_version: body.expected_version };
    if (body.action === 'update') payload.item = normalizeItem(body.item, true);
    if (body.action === 'adjust') {
      if (!['add', 'remove', 'set'].includes(body.mode)) fail(400, 'Choose add, remove, or set for the stock count.');
      payload.mode = body.mode;
      payload.quantity = integer(body.quantity, 'Quantity', { positive: body.mode !== 'set' });
    }
    if (body.action === 'archive') {
      if (typeof body.archived !== 'boolean') fail(400, 'Choose whether to archive or restore the item.');
      payload.archived = body.archived;
    }
  } else fail(400, 'Unknown inventory action.');
  payload.reason = text(body.reason ?? '', 'a reason', 500, body.action === 'adjust', true);
  return { request_id: body.request_id.toLowerCase(), payload };
}
function checked(result) {
  if (!result?.error) return result?.data;
  const error = result.error;
  if (error.code === '40001') fail(409, 'This item changed. Refresh it before saving again.', 'VERSION_CONFLICT');
  if (error.code === '23505') fail(409, 'That SKU already exists, including archived items. Choose a different SKU or restore the existing item.', 'DUPLICATE_SKU');
  if (error.code === 'P0002') fail(404, 'Inventory item not found.', 'NOT_FOUND');
  const messages = {
    STOCK_REQUEST_CONFLICT: ['This request ID was already used for a different change. Refresh and try again.', 'REQUEST_CONFLICT'],
    STOCK_QUANTITY_UNCONFIRMED: ['Set the counted quantity before adding or removing stock.', 'INVALID_QUANTITY'],
    STOCK_NEGATIVE_QUANTITY: ['The adjustment would make the quantity negative.', 'INVALID_QUANTITY'],
    STOCK_QUANTITY_OVERFLOW: ['The adjusted quantity is too large.', 'INVALID_QUANTITY'],
    STOCK_ITEM_ARCHIVED: ['Restore this item before adjusting its quantity.', 'ITEM_ARCHIVED'],
    STOCK_ITEM_LIMIT: ['This inventory has reached its 5,000-item limit. Contact support before adding more items.', 'LIMIT_EXCEEDED']
  };
  if (messages[error.message]) fail(409, ...messages[error.message]);
  if (['22023', '23514', '22P02', '22003'].includes(error.code)) fail(400, 'Check the inventory details and try again.');
  fail(503, 'Inventory is temporarily unavailable. Your request ID can be retried safely.', 'UNAVAILABLE');
}
async function listItems(db) {
  const items = [];
  let cursor;
  for (;;) {
    const remaining = MAX_ITEMS + 1 - items.length;
    let query = db.from('pure_stock_items').select(ITEM_COLUMNS).order('id', { ascending: true }).limit(Math.min(1000, remaining));
    if (cursor) query = query.gt('id', cursor);
    const page = checked(await query);
    if (!Array.isArray(page)) fail(503, 'Inventory is temporarily unavailable.', 'UNAVAILABLE');
    items.push(...page);
    if (items.length > MAX_ITEMS) fail(503, 'Inventory exceeds the 5,000-item display limit. No rows were omitted; contact support to increase the limit.', 'LIMIT_EXCEEDED');
    if (page.length < Math.min(1000, remaining)) break;
    const next = page.at(-1)?.id;
    if (!next || next === cursor) fail(503, 'Inventory pagination could not be completed.', 'UNAVAILABLE');
    cursor = next;
  }
  return { items };
}
function queryInteger(value, fallback, maximum, label, minimum = 0) {
  if (value === null) return fallback;
  if (!/^\d{1,8}$/.test(value) || Number(value) < minimum || Number(value) > maximum) fail(400, `Invalid ${label}.`);
  return Number(value);
}
async function listActivity(db, params) {
  const offset = queryInteger(params.get('offset'), 0, 1000000, 'activity offset');
  const pageSize = queryInteger(params.get('page_size'), 50, 100, 'activity page size', 1);
  const rows = checked(await db.from('pure_stock_events').select(EVENT_COLUMNS)
    .order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + pageSize));
  if (!Array.isArray(rows)) fail(503, 'Inventory history is temporarily unavailable.', 'UNAVAILABLE');
  return { events: rows.slice(0, pageSize), has_more: rows.length > pageSize };
}
async function previewImport(db, items) {
  for (let start = 0; start < items.length; start += 100) {
    const existing = checked(await db.from('pure_stock_items').select('sku').in('sku', items.slice(start, start + 100).map(item => item.sku)));
    if (!Array.isArray(existing)) fail(503, 'Inventory import preview is temporarily unavailable.', 'UNAVAILABLE');
    if (existing.length) fail(409, `SKU ${existing[0].sku} already exists, including archived items. Imports add new rows only.`, 'DUPLICATE_SKU');
  }
  return { items, count: items.length };
}
function actorReference(auth) {
  return auth.method === 'session'
    ? 'admin-session:' + createHash('sha256').update(auth.token).digest('hex').slice(0, 32)
    : 'admin-legacy';
}
async function handle(req, res, deps = {}) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Vary', 'Cookie');
  try {
    const auth = await assertAdmin(req, deps);
    if (!['GET', 'POST'].includes(req.method)) {
      res.setHeader('Allow', 'GET, POST');
      fail(405, 'Use GET or POST.');
    }
    const db = deps.db || require('./inventory-db').inventoryDb();
    const params = new URL(req.url || '/api/customer-config?inventory=1', 'https://inventory.internal').searchParams;
    if (req.method === 'GET') {
      const view = params.get('view');
      if (view && view !== 'activity') fail(400, 'Unknown inventory view.');
      return res.status(200).json(view === 'activity' ? await listActivity(db, params) : await listItems(db));
    }
    const command = normalizeCommand(parseBody(req));
    if (command.payload.action === 'preview_import') return res.status(200).json(await previewImport(db, command.payload.items));
    const result = checked(await db.rpc('pure_stock_command', {
      p_request_id: command.request_id, p_payload: command.payload, p_actor: actorReference(auth)
    }));
    if (!result || typeof result !== 'object' || Array.isArray(result)) fail(503, 'Inventory change could not be confirmed. Retry with the same request ID.', 'UNAVAILABLE');
    return res.status(200).json(result);
  } catch (error) {
    const allowed = [400, 401, 403, 404, 405, 409, 413, 415, 429, 503];
    const status = allowed.includes(error.status) ? error.status : 503;
    return res.status(status).json({ error: allowed.includes(error.status) ? error.message : 'Inventory is temporarily unavailable.',
      ...(typeof error.code === 'string' && /^[A-Z_]+$/.test(error.code) ? { code: error.code } : {}) });
  }
}

module.exports = { handle, normalizeItem, normalizeBatch, normalizeCommand, listItems, listActivity, previewImport,
  MAX_ITEMS, MAX_IMPORT, ITEM_COLUMNS, EVENT_COLUMNS };
