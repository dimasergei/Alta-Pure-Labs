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

  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
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

    if (req.method === 'DELETE') {
      return await deleteBatch(res, body);
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

  const result = checked(
    await db.rpc('create_supplier_batch', {
      p_supplier_id: supplierId,
      p_name: name,
      p_order_ids: uniqueOrderIds
    })
  );

  if (!result || !result.batch_id) {
    throw httpError(500, 'Supplier batch could not be created.');
  }

  const batch = checked(
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
      .eq('id', result.batch_id)
      .single()
  );

  return res.status(201).json({
    batch,
    items: batch.supplier_batch_items || []
  });
}

async function updateBatch(res, body) {
  const batchId = body.batch_id;
  if (typeof batchId !== 'string' || !UUID_PATTERN.test(batchId)) {
    throw httpError(400, 'Invalid batch update.');
  }
  const { db } = clients();
  const previous = checked(await db.from('supplier_batches')
    .select('id,status,archived_at').eq('id', batchId).maybeSingle());
  if (!previous) throw httpError(404, 'Batch not found.');
  if (previous.status === 'fulfilled' &&
      (body.name !== undefined || body.status !== undefined)) {
    throw httpError(409, 'Fulfilled batches cannot be renamed or have their status changed.');
  }
  const updates = { updated_at: new Date().toISOString() };
  if (body.name !== undefined) {
    const name = cleanText(body.name, 120, 'Batch name');
    if (!name) throw httpError(400, 'Batch name is required.');
    updates.name = name;
  }
  if (body.status !== undefined) {
    if (!BATCH_STATUSES.includes(body.status)) throw httpError(400, 'Invalid batch status.');
    updates.status = body.status;
  }
  if (body.archived !== undefined) {
    if (typeof body.archived !== 'boolean') throw httpError(400, 'Archived must be true or false.');
    updates.archived_at = body.archived ? new Date().toISOString() : null;
  }
  if (Object.keys(updates).length === 1) throw httpError(400, 'No batch changes were provided.');
  const batch = checked(await db.from('supplier_batches').update(updates)
    .eq('id', batchId).select('id,name,status,created_at,updated_at,supplier_id,archived_at').single());
  return res.status(200).json({ batch });
}

async function deleteBatch(res, body) {
  const batchId = body.batch_id;
  if (typeof batchId !== 'string' || !UUID_PATTERN.test(batchId)) {
    throw httpError(400, 'Invalid batch.');
  }
  const { db } = clients();
  const result = checked(await db.rpc('admin_delete_supplier_batch', { p_batch_id: batchId }));
  if (!result || result.deleted !== true) throw httpError(500, 'Batch deletion was not confirmed.');
  return res.status(200).json({ deleted: true, batch_id: batchId, audit_id: result.audit_id });
}
