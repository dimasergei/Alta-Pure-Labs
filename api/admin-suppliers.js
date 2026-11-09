const crypto = require('crypto');
const { clients, checked } = require('../lib/backend');
const { createClient } = require('@supabase/supabase-js');
const { loadOverview } = require('../lib/operations-overview');
const { loadInventory } = require('../lib/enterprise-inventory-query');
const { normalizeInventoryIntake } = require('../lib/inventory-intake');
const { inventoryDb } = require('../lib/inventory-db');
const { inventoryIntake } = require('../lib/inventory-admin-intake');
const { intakeReport } = require('../lib/coa-admin-intake');

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SUPPLIER_COLUMNS =
  'id,name,contact_name,email,notes,active,created_at,updated_at';

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
      error: 'Supplier tools are not configured.'
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
      const params = new URL(req.url || '/api/admin-suppliers', 'https://admin.internal').searchParams;
      if (params.get('inventory') === '1') {
        const db = inventoryDb();
        const result = await loadInventory(db);
        return res.status(200).json(result);
      }
      if (params.get('overview') === '1') {
        if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
          return res.status(503).json({ error: 'Operational overview unavailable.' });
        }
        const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
          { auth: { persistSession: false, autoRefreshToken: false } });
        const result = await loadOverview(db);
        result.checkout_enabled = process.env.CHECKOUT_ENABLED === 'true';
        return res.status(200).json(result);
      }
      return await listSuppliers(req, res);
    }

    const contentType = String(
      req.headers['content-type'] || ''
    ).split(';')[0].trim().toLowerCase();

    if (contentType !== 'application/json') {
      throw httpError(415, 'JSON required.');
    }

    const body = await parseJson(req);

    if (req.method === 'POST') {
      if (body.action === 'intake_supplier_coa_reference') {
        const result = await intakeReport(inventoryDb(),body.report);
        return res.status(result.ok ? 201 : 400).json(result);
      }
      if (body.action === 'preview_inventory_import' ||
          body.action === 'commit_inventory_intake') {
        if (Buffer.byteLength(JSON.stringify(body), 'utf8') > 32768) {
          throw httpError(413, 'Request too large.');
        }
        if (!Array.isArray(body.rows) || body.rows.length !== 1) {
          throw httpError(400, 'Provide exactly one inventory lot.');
        }
        const commit = body.action === 'commit_inventory_intake';
        if (commit && body.confirm_quarantine_only !== true) {
          throw httpError(400, 'Explicit quarantine-only confirmation required.');
        }
        const result = await inventoryIntake(inventoryDb(), body.rows, commit);
        return res.status(result.saved ? 201 : result.valid ? 200 : 409).json(result);
      }
      return await createSupplier(res, body);
    }

    if (req.method === 'DELETE') {
      return await deleteSupplier(res, body);
    }

    return await updateSupplier(req, res, body);
  } catch (error) {
    const allowed = [400, 404, 409, 413, 415];
    const status = allowed.includes(error.status) ? error.status : 500;

    console.error('Supplier request failed', {
      method: req.method,
      name: error.name,
      code: error.code,
      status
    });

    return res.status(status).json({
      error: status < 500 ? error.message : 'Supplier request failed.'
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
  const maximumBytes = 32768;
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

async function listSuppliers(req, res) {
  const { db } = clients();

  const suppliers = checked(
    await db
      .from('suppliers')
      .select(SUPPLIER_COLUMNS)
      .order('name', { ascending: true })
      .limit(200)
  );

  return res.status(200).json({ suppliers });
}

async function createSupplier(res, body) {
  const name = cleanText(body.name, 120, 'Supplier name');

  if (!name) {
    throw httpError(400, 'Supplier name is required.');
  }

  const email = cleanText(body.email, 254, 'Email');

  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw httpError(400, 'Enter a valid supplier email.');
  }

  const { db } = clients();

  const existing = checked(
    await db
      .from('suppliers')
      .select('id,name,active')
      .ilike('name', name)
      .maybeSingle()
  );

  if (existing?.active) {
    throw httpError(409, 'That supplier already exists.');
  }

  const supplier = checked(
    await db
      .from('suppliers')
      .insert({
        name,
        contact_name: cleanText(body.contact_name, 120, 'Contact name'),
        email,
        notes: cleanText(body.notes, 5000, 'Notes')
      })
      .select(SUPPLIER_COLUMNS)
      .single()
  );

  return res.status(201).json({ supplier });
}


async function deleteSupplier(res, body) {
  const supplierId = body.supplier_id;
  if (typeof supplierId !== 'string' || !UUID_PATTERN.test(supplierId)) {
    throw httpError(400, 'Invalid supplier.');
  }
  const { db } = clients();
  const supplier = checked(await db.from('suppliers')
    .select('id,name').eq('id', supplierId).maybeSingle());
  if (!supplier) throw httpError(404, 'Supplier not found.');
  const references = checked(await db.from('supplier_batches')
    .select('id').eq('supplier_id', supplierId).limit(1));
  if (references.length) {
    throw httpError(409, 'This supplier is referenced by a batch. Archive it instead or reassign its batches first.');
  }
  checked(await db.from('suppliers').delete().eq('id', supplierId));
  return res.status(200).json({ deleted: true, supplier_id: supplierId });
}

async function updateSupplier(req, res, body) {
  const supplierId = body.supplier_id;

  if (typeof supplierId !== 'string' || !UUID_PATTERN.test(supplierId)) {
    throw httpError(400, 'Invalid supplier.');
  }

  const { db } = clients();

  const previous = checked(
    await db
      .from('suppliers')
      .select('*')
      .eq('id', supplierId)
      .maybeSingle()
  );

  if (!previous) {
    throw httpError(404, 'Supplier not found.');
  }

  const updates = {};

  if (body.name !== undefined) {
    const name = cleanText(body.name, 120, 'Supplier name');

    if (!name) {
      throw httpError(400, 'Supplier name is required.');
    }

    updates.name = name;
  }

  if (body.contact_name !== undefined) {
    updates.contact_name = cleanText(body.contact_name, 120, 'Contact name');
  }

  if (body.email !== undefined) {
    const email = cleanText(body.email, 254, 'Email');

    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw httpError(400, 'Enter a valid supplier email.');
    }

    updates.email = email;
  }

  if (body.notes !== undefined) {
    updates.notes = cleanText(body.notes, 5000, 'Notes');
  }

  if (body.active !== undefined) {
    if (typeof body.active !== 'boolean') {
      throw httpError(400, 'Active must be true or false.');
    }

    updates.active = body.active;
  }

  if (!Object.keys(updates).length) {
    throw httpError(400, 'No supplier changes were provided.');
  }

  updates.updated_at = new Date().toISOString();

  const supplier = checked(
    await db
      .from('suppliers')
      .update(updates)
      .eq('id', supplierId)
      .select(SUPPLIER_COLUMNS)
      .single()
  );

  return res.status(200).json({ supplier });
}
