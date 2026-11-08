const crypto = require('crypto');
const { clients, checked } = require('../lib/backend');

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BATCH_STATUSES = ['draft', 'sent', 'fulfilled', 'canceled'];

function passwordMatches(provided, expected) {
  const a = crypto.createHash('sha256').update(String(provided)).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  const adminPassword = process.env.ADMIN_ORDERS_PASSWORD;

  if (typeof adminPassword !== 'string' || adminPassword.length < 32) {
    return res.status(503).json({
      error: 'Supplier batches are not configured.'
    });
  }

  const providedPassword = req.headers['x-admin-password'];

  if (!providedPassword || !passwordMatches(providedPassword, adminPassword)) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  if (!['GET', 'POST', 'PATCH'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST, PATCH');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  try {
    if (req.method === 'GET') {
      return await listBatches(req, res);
    }

    const contentType = String(
      req.headers['content-type'] || ''
    ).split(';')[0].trim().toLowerCase();

    if (contentType !== 'application/json') {
      throw httpError(415, 'JSON required.');
    }

    const body = await parseJson(req);

    if (req.method === 'POST') {
      return await createBatch(res, body);
    }

    return await updateBatch(res, body);
  } catch (error) {
    const allowed = [400, 404, 409, 413, 415];
    const status = allowed.includes(error.status) ? error.status : 500;

    console.error('Supplier batch request failed', {
      method: req.method,
      name: error.name,
      code: error.code,
      status
    });

    return res.status(status).json({
      error: status < 500 ? error.message : 'Supplier batch request failed.'
    });
  }
};

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function cleanText(value, maximumLength, label) {
  if (value === undefined || value === null) return null;

  if (typeof value !== 'string') {
    throw httpError(400, `${label} must be text.`);
  }

  const text = value.trim();

  if (text.length > maximumLength) {
    throw httpError(
      400,
      `${label} is too long. Maximum ${maximumLength} characters.`
    );
  }

  return text || null;
}

async function parseJson(req) {
  const maximumBytes = 65536;
  let raw;

  if (req.body !== undefined && req.body !== null) {
    if (Buffer.isBuffer(req.body)) {
      raw = req.body.toString('utf8');
    } else if (typeof req.body === 'string') {
      raw = req.body;
    } else {
      raw = JSON.stringify(req.body);
    }
  } else {
    const chunks = [];
    let bytes = 0;

    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);

      bytes += buffer.length;

      if (bytes > maximumBytes) {
        throw httpError(413, 'Request too large.');
      }

      chunks.push(buffer);
    }

    raw = Buffer.concat(chunks).toString('utf8');
  }

  let body;

  try {
    body = JSON.parse(raw);
  } catch {
    throw httpError(400, 'Invalid JSON.');
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw httpError(400, 'A JSON object is required.');
  }

  return body;
}

async function listBatches(req, res) {
  const { db } = clients();

  const batches = checked(
    await db
      .from('supplier_batches')
      .select(
        `
        id,
        name,
        status,
        created_at,
        updated_at,
        suppliers (
          id,
          name,
          contact_name,
          email
        ),
        supplier_batch_items (
          id,
          order_id,
          order_item_id,
          product_name,
          variant_size,
          quantity,
          supplier_sku,
          supplier_name,
          lot_number,
          fulfillment_notes
        )
      `
      )
      .order('created_at', { ascending: false })
      .limit(50)
  );

  return res.status(200).json({ batches });
}

async function createBatch(res, body) {
  const supplierId = body.supplier_id;
  const name = cleanText(body.name, 120, 'Batch name');

  if (
    typeof supplierId !== 'string' ||
    !UUID_PATTERN.test(supplierId) ||
    !name
  ) {
    throw httpError(400, 'Choose a supplier and enter a batch name.');
  }

  const orderIds = body.order_ids;

  if (
    !Array.isArray(orderIds) ||
    !orderIds.length ||
    orderIds.length > 200 ||
    orderIds.some((id) => typeof id !== 'string' || !UUID_PATTERN.test(id))
  ) {
    throw httpError(400, 'Select between 1 and 200 valid orders.');
  }

  const uniqueOrderIds = [...new Set(orderIds)];

  const { db } = clients();

  const supplier = checked(
    await db
      .from('suppliers')
      .select('id,name,active')
      .eq('id', supplierId)
      .maybeSingle()
  );

  if (!supplier || !supplier.active) {
    throw httpError(404, 'Active supplier not found.');
  }

  const duplicate = checked(
    await db
      .from('supplier_batches')
      .select('id')
      .eq('name', name)
      .maybeSingle()
  );

  if (duplicate) {
    throw httpError(409, 'That batch name is already in use.');
  }

  const orders = checked(
    await db
      .from('store_orders')
      .select(
        `
        id,
        order_number,
        payment_status,
        fulfillment_status,
        archived,
        store_order_items (
          id,
          product_id,
          product_name,
          variant_size,
          quantity,
          supplier_sku,
          supplier_name,
          lot_number,
          fulfillment_notes
        )
      `
      )
      .in('id', uniqueOrderIds)
  );

  if (orders.length !== uniqueOrderIds.length) {
    throw httpError(404, 'One or more selected orders no longer exist.');
  }

  const unavailableOrders = orders.filter(
    (order) =>
      order.archived ||
      !['paid', 'partially_refunded'].includes(order.payment_status) ||
      !['unfulfilled', 'processing', 'awaiting_supplier'].includes(
        order.fulfillment_status
      )
  );

  if (unavailableOrders.length) {
    throw httpError(
      409,
      'Only active, paid, unfulfilled orders can be added to a new supplier batch.'
    );
  }

  const items = [];

  orders.forEach((order) => {
    const orderItems = Array.isArray(order.store_order_items)
      ? order.store_order_items
      : [];

    if (!orderItems.length) {
      throw httpError(
        409,
        `Order ${order.order_number || order.id} has no items.`
      );
    }

    orderItems.forEach((item) => {
      items.push({
        order_id: order.id,
        order_item_id: item.id,
        product_name: item.product_name,
        variant_size: item.variant_size,
        quantity: item.quantity,
        supplier_sku: item.supplier_sku,
        supplier_name: item.supplier_name,
        lot_number: item.lot_number,
        fulfillment_notes: item.fulfillment_notes
      });
    });
  });

  if (!items.length) {
    throw httpError(409, 'No eligible order items were found.');
  }

  const batch = checked(
    await db
      .from('supplier_batches')
      .insert({ supplier_id: supplierId, name, status: 'draft' })
      .select('id,name,status,created_at,updated_at,supplier_id')
      .single()
  );

  const insertedItems = checked(
    await db
      .from('supplier_batch_items')
      .insert(items.map((item) => ({ ...item, batch_id: batch.id })))
      .select('*')
  );

  return res.status(201).json({
    batch: {
      ...batch,
      supplier: { id: supplier.id, name: supplier.name }
    },
    items: insertedItems
  });
}

async function updateBatch(res, body) {
  const batchId = body.batch_id;
  const status = body.status;

  if (
    typeof batchId !== 'string' ||
    !UUID_PATTERN.test(batchId) ||
    !BATCH_STATUSES.includes(status)
  ) {
    throw httpError(400, 'Invalid batch update.');
  }

  const { db } = clients();

  const previous = checked(
    await db
      .from('supplier_batches')
      .select('id,status')
      .eq('id', batchId)
      .maybeSingle()
  );

  if (!previous) {
    throw httpError(404, 'Batch not found.');
  }

  if (previous.status === 'fulfilled') {
    throw httpError(409, 'Fulfilled batches cannot be reopened.');
  }

  const batch = checked(
    await db
      .from('supplier_batches')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', batchId)
      .select('id,name,status,created_at,updated_at,supplier_id')
      .single()
  );

  return res.status(200).json({ batch });
}
