const LINES_PER_PAGE = 48;
const WRAP_AT = 95;

// Standard PDF fonts only cover Latin-1; replace anything else.
function latin1(value) {
  return String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');
}

function escapePdfText(value) {
  return latin1(value)
    .replaceAll('\\', '\\\\')
    .replaceAll('(', '\\(')
    .replaceAll(')', '\\)');
}

function wrap(text, width) {
  const words = latin1(text).split(' ');
  const out = [];
  let line = '';

  words.forEach((word) => {
    while (word.length > width) {
      if (line) {
        out.push(line);
        line = '';
      }
      out.push(word.slice(0, width));
      word = word.slice(width);
    }

    if (!line) {
      line = word;
    } else if ((line + ' ' + word).length <= width) {
      line += ' ' + word;
    } else {
      out.push(line);
      line = word;
    }
  });

  out.push(line);
  return out;
}

function buildSupplierBatchPdf({ batch, supplier, generatedAt }) {
  const items = Array.isArray(batch.items) ? batch.items : [];

  const raw = [];

  raw.push('AltaPure Labs');
  raw.push('Supplier Fulfillment Batch');
  raw.push('');
  raw.push(`Batch: ${batch.name}`);
  raw.push(`Supplier: ${supplier.name}`);
  raw.push(`Generated: ${generatedAt}`);
  raw.push('');
  raw.push('Order Number | Product | Variant | Quantity | Supplier SKU | Lot Number | Notes');
  raw.push('');

  items.forEach((item) => {
    raw.push(
      [
        item.order_number || item.order_id,
        item.product_name,
        item.variant_size,
        item.quantity,
        item.supplier_sku,
        item.lot_number,
        item.fulfillment_notes
      ]
        .map((value) => String(value ?? ''))
        .join(' | ')
    );
  });

  raw.push('');
  raw.push('Research use only. Not for human or veterinary use, ingestion, injection, diagnosis, treatment, or consumption.');

  const lines = raw.flatMap((line) => wrap(line, WRAP_AT));

  const pages = [];
  for (let i = 0; i < lines.length; i += LINES_PER_PAGE) {
    pages.push(lines.slice(i, i + LINES_PER_PAGE));
  }

  // Object layout: 1 catalog, 2 pages, 3 font, then (page, content) pairs.
  const objects = [];
  const kids = pages.map((_, index) => `${4 + index * 2} 0 R`).join(' ');

  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  objects.push(
    `2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>\nendobj\n`
  );
  objects.push(
    '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n'
  );

  pages.forEach((pageLines, index) => {
    const pageId = 4 + index * 2;
    const contentId = pageId + 1;

    const stream =
      `BT /F1 10 Tf 50 750 Td 14 TL\n${pageLines
        .map((line) => `(${escapePdfText(line)}) Tj T*`)
        .join('\n')}\nET`;

    objects.push(
      `${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>\nendobj\n`
    );

    objects.push(
      `${contentId} 0 obj\n<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream\nendobj\n`
    );
  });

  let pdf = '%PDF-1.4\n';
  const offsets = [];

  objects.forEach((object) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += object;
  });

  const xrefStart = Buffer.byteLength(pdf, 'latin1');

  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;

  offsets.forEach((offset) => {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });

  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return Buffer.from(pdf, 'latin1');
}

module.exports = {
  buildSupplierBatchPdf
};
