const crypto = require('crypto');
const { clients, checked } = require('../lib/backend');
const { buildSupplierBatchPdf } = require('../lib/supplier-batch-pdf');

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  try {
    const batchId = new URL(
      req.url,
      'https://admin.internal'
    ).searchParams.get('batch_id');

    if (typeof batchId !== 'string' || !UUID_PATTERN.test(batchId)) {
      return res.status(400).json({ error: 'Invalid batch.' });
    }

    const { db } = clients();

    const batch = checked(
      await db
        .from('supplier_batches')
        .select(
          `
          id,
          name,
          status,
          created_at,
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
  fulfillment_notes,
  store_orders (
    order_number
  )
)
        `
        )
        .eq('id', batchId)
        .single()
    );

    const items = (batch.supplier_batch_items || []).map((item) => ({
      order_number: item.order_number,
      order_id: item.order_id,
      product_name: item.product_name,
      variant_size: item.variant_size,
      quantity: item.quantity,
      supplier_sku: item.supplier_sku,
      supplier_name: item.supplier_name,
      lot_number: item.lot_number,
      fulfillment_notes: item.fulfillment_notes
    }));

    const pdf = buildSupplierBatchPdf({
      batch: { name: batch.name, items },
      supplier: batch.suppliers || { name: 'Unknown supplier' },
      generatedAt: new Date().toISOString()
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${batch.name.replace(/[^a-z0-9-_]/gi, '_')}.pdf"`
    );

    return res.status(200).send(pdf);
  } catch (error) {
    console.error('Supplier batch PDF failed', {
      name: error.name,
      code: error.code
    });

    return res.status(500).json({ error: 'PDF could not be generated.' });
  }
};
