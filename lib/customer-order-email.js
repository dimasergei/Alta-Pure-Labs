const STATUS_COPY = {
  pending: {
    subject: 'We received your AltaPure Labs order',
    heading: 'Order received — payment pending',
    message: 'Your order has been saved. Payment is not yet confirmed. View the secure order to complete payment.'
  },
  refunded: {
    subject: 'A refund has been recorded for your AltaPure Labs order',
    heading: 'Refund recorded',
    message: 'The verified external refund was recorded. Your payment provider will determine when funds become available.'
  },
  confirmation: {
    subject: 'Your AltaPure Labs order is confirmed',
    heading: 'Your order is confirmed',
    message: 'Your payment was successful and your order is confirmed.'
  },
  processing: {
    subject: 'Your AltaPure Labs order is being prepared',
    heading: 'Your order is being prepared',
    message: 'We received your order and are preparing it for shipment.'
  },
  partially_shipped: {
    subject: 'Part of your AltaPure Labs order has shipped',
    heading: 'Part of your order has shipped',
    message: 'Part of your order has shipped. Any remaining items will be shipped separately.'
  },
  shipped: {
    subject: 'Your AltaPure Labs order has shipped',
    heading: 'Your order has shipped',
    message: 'Your order has shipped. Tracking information is included below when available.'
  },
  tracking_updated: {
    subject: 'Shipping information updated for your AltaPure Labs order',
    heading: 'Your shipping information was updated',
    message: 'The shipping or tracking information for your order has been updated.'
  },
  delivered: {
    subject: 'Your AltaPure Labs order was delivered',
    heading: 'Your order was delivered',
    message: 'Your order has been marked as delivered. If you did not receive it, please contact us promptly.'
  },
  canceled: {
    subject: 'Your AltaPure Labs order was canceled',
    heading: 'Your order was canceled',
    message: 'Your order has been canceled. This notice does not confirm a refund. Please contact us if you have questions about your payment.'
  }
};

const FULFILLMENT_LABELS = {
  unfulfilled: 'Unfulfilled',
  processing: 'Processing',
  awaiting_supplier: 'Awaiting Supplier',
  partially_shipped: 'Partially Shipped',
  shipped: 'Shipped',
  delivered: 'Delivered',
  canceled: 'Canceled'
};

const PAYMENT_LABELS = {
  pending: 'Pending',
  paid: 'Paid',
  failed: 'Failed',
  expired: 'Expired',
  partially_refunded: 'Partially Refunded',
  refunded: 'Refunded'
};

function formatStatus(value, labels = FULFILLMENT_LABELS) {
  return labels[value] || String(value || 'Unknown')
    .replaceAll('_', ' ')
    .replace(/\b\\w/g, (letter) => letter.toUpperCase());
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function money(cents, currency = 'usd') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: String(currency || 'usd').toUpperCase()
  }).format((Number(cents) || 0) / 100);
}

function addressLines(order) {
  const address = order.shipping_address || {};
  return [
    order.shipping_name || order.customer_name,
    address.line1,
    address.line2,
    [address.city, address.state, address.postal_code].filter(Boolean).join(', '),
    address.country
  ].filter(Boolean);
}

function trackingUrl(carrier, trackingNumber) {
  if (!trackingNumber) return null;
  const number = encodeURIComponent(String(trackingNumber).trim());
  const name = String(carrier || '').toLowerCase();
  if (/\busps\b|united states postal/.test(name)) {
    return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${number}`;
  }
  if (/\bups\b|united parcel/.test(name)) {
    return `https://www.ups.com/track?tracknum=${number}`;
  }
  if (/fedex/.test(name)) {
    return `https://www.fedex.com/fedextrack/?trknumber=${number}`;
  }
  if (/\bdhl\b/.test(name)) {
    return `https://www.dhl.com/en/express/tracking.html?AWB=${number}`;
  }
  return null;
}

function buildStatusEmail({ order, notificationType }) {
  const copy = STATUS_COPY[notificationType];
  if (!copy) throw new Error('Unsupported customer notification type.');

  const orderNumber = order.order_number || 'Unavailable';
  const items = order.store_order_items || order.items || [];
  const currency = order.currency || 'usd';
  const itemRows = items.map((item) => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;">
        <strong>${escapeHtml(item.product_name)}</strong><br>
        <span style="color:#6b7280;font-size:13px;">${escapeHtml(item.variant_size || '')} × ${Number(item.quantity) || 0}</span>
      </td>
      <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;text-align:right;white-space:nowrap;">
        ${money((Number(item.quantity) || 0) * (Number(item.unit_price_cents) || 0), currency)}
      </td>
    </tr>
  `).join('');
  const address = addressLines(order);
  const link = trackingUrl(order.tracking_carrier, order.tracking_number);
  const tracking = order.tracking_carrier || order.tracking_number
    ? `<div style="margin-top:22px;padding:16px;background:#f3f5f5;border-radius:8px;">
        <strong>Tracking information</strong>
        ${order.tracking_carrier ? `<p>Carrier: ${escapeHtml(order.tracking_carrier)}</p>` : ''}
        ${order.tracking_number ? `<p>Tracking number: ${escapeHtml(order.tracking_number)}</p>` : ''}
        ${link ? `<p><a href="${escapeHtml(link)}">Track your shipment</a></p>` : ''}
      </div>`
    : '';
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:620px;margin:0 auto;color:#111314;">
      <div style="background:#143832;color:#fff;padding:28px 32px;border-radius:12px 12px 0 0;">
        <h1 style="margin:0;font-size:22px;letter-spacing:.08em;">ALTAPURE LABS</h1>
        <p style="margin:10px 0 0;color:#cfe3de;font-size:14px;">${notificationType === 'confirmation' ? 'Order confirmation' : 'Order update'}</p>
      </div>
      <div style="background:#fff;padding:32px;border:1px solid #e5e7eb;border-top:0;">
        <h2>${escapeHtml(copy.heading)}</h2>
        <p>Dear ${escapeHtml(order.customer_name || 'Customer')},</p>
        <p>${escapeHtml(copy.message)}</p>
        <div style="background:#f3f5f5;padding:18px;border-radius:10px;">
          <p><strong>Order number:</strong> ${escapeHtml(orderNumber)}</p>
          <p><strong>Payment status:</strong> ${escapeHtml(formatStatus(order.payment_status, PAYMENT_LABELS))}</p>
          <p><strong>Order status:</strong> ${escapeHtml(formatStatus(order.fulfillment_status))}</p>
          <p><strong>Customer email:</strong> ${escapeHtml(order.customer_email)}</p>
        </div>
        <h3>Order items</h3>
        <table style="width:100%;border-collapse:collapse;">${itemRows}</table>
        <div style="margin-top:18px;padding-top:14px;border-top:1px solid #e5e7eb;">
          <p>Subtotal: <strong>${money(order.subtotal_cents, currency)}</strong></p>
          <p>Shipping: <strong>${money(order.shipping_cents, currency)}</strong></p>
          <p style="font-size:18px;">Total: <strong>${money(order.total_cents, currency)}</strong></p>
        </div>
        ${address.length ? `<h3>Shipping address</h3><p>${address.map(escapeHtml).join('<br>')}</p>` : ''}
        ${tracking}
        <div style="margin-top:28px;padding:18px;background:#f8f4e8;border-radius:8px;font-size:13px;color:#5f5638;">
          <strong>Research use only.</strong> Products are supplied for controlled laboratory research and are not for human or veterinary use, ingestion, injection, diagnosis, treatment, or consumption.
        </div>
      </div>
      <div style="padding:20px 32px;color:#6b7280;font-size:12px;">AltaPure Labs · Research use only · Not for human consumption</div>
    </div>`;
  const textLines = [
    'AltaPure Labs',
    copy.heading,
    copy.message,
    `Order number: ${orderNumber}`,
    `Customer: ${order.customer_name || 'Customer'}`,
    `Customer email: ${order.customer_email || ''}`,
    `Payment status: ${formatStatus(order.payment_status, PAYMENT_LABELS)}`,
    `Order status: ${formatStatus(order.fulfillment_status)}`,
    '',
    'Order items:',
    ...items.map((item) => `- ${item.product_name} ${item.variant_size || ''} × ${item.quantity}: ${money((Number(item.quantity) || 0) * (Number(item.unit_price_cents) || 0), currency)}`),
    `Subtotal: ${money(order.subtotal_cents, currency)}`,
    `Shipping: ${money(order.shipping_cents, currency)}`,
    `Total: ${money(order.total_cents, currency)}`,
    '',
    'Shipping address:',
    ...address,
    ...(order.tracking_carrier ? [`Carrier: ${order.tracking_carrier}`] : []),
    ...(order.tracking_number ? [`Tracking number: ${order.tracking_number}`] : []),
    ...(link ? [`Track shipment: ${link}`] : []),
    '',
    'Research use only. Products are supplied for controlled laboratory research and are not for human or veterinary use, ingestion, injection, diagnosis, treatment, or consumption.'
  ];
  return {
    subject: `${copy.subject} — ${orderNumber}`,
    html,
    text: textLines.join('\\n')
  };
}

module.exports = {
  STATUS_COPY,
  FULFILLMENT_LABELS,
  PAYMENT_LABELS,
  formatStatus,
  trackingUrl,
  buildStatusEmail
};
