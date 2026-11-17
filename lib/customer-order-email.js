const { emailLayout, orderSummary, researchNotice, SUPPORT_EMAIL } = require('./order-email-layout');

const STATUS_COPY = {
  pending: {
    subject: 'We received your PURE order',
    heading: 'Order received — payment pending',
    message: 'Your order has been saved. Payment is not yet confirmed. View the secure order to complete payment.'
  },
  refunded: {
    subject: 'A refund has been recorded for your PURE order',
    heading: 'Refund recorded',
    message: 'The verified external refund was recorded. Your payment provider will determine when funds become available.'
  },
  confirmation: {
    subject: 'Your PURE order is confirmed',
    heading: 'Your order is confirmed',
    message: 'Your payment was successful and your order is confirmed.'
  },
  processing: {
    subject: 'Your PURE order is being prepared',
    heading: 'Your order is being prepared',
    message: 'We received your order and are preparing it for shipment.'
  },
  partially_shipped: {
    subject: 'Part of your PURE order has shipped',
    heading: 'Part of your order has shipped',
    message: 'Part of your order has shipped. Any remaining items will be shipped separately.'
  },
  shipped: {
    subject: 'Your PURE order has shipped',
    heading: 'Your order has shipped',
    message: 'Your order has shipped. Tracking information is included below when available.'
  },
  tracking_updated: {
    subject: 'Shipping information updated for your PURE order',
    heading: 'Your shipping information was updated',
    message: 'The shipping or tracking information for your order has been updated.'
  },
  delivered: {
    subject: 'Your PURE order was delivered',
    heading: 'Your order was delivered',
    message: 'Your order has been marked as delivered. If you did not receive it, please contact us promptly.'
  },
  canceled: {
    subject: 'Your PURE order was canceled',
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

function recordedCents(...values) {
  return values.find(value => Number.isSafeInteger(value) && value >= 0) ?? null;
}

// These are recorded amounts only. Never apply today's promotions to an old order.
function orderTotalRows(order) {
  const pricing = order.pricing || {};
  const discount = recordedCents(order.discount_cents, pricing.discount_cents) || 0;
  const coupon = recordedCents(pricing.coupon_discount_cents) || 0;
  const crypto = recordedCents(pricing.crypto_discount_cents) || 0;
  const breakdownValid = [pricing.coupon_discount_cents, pricing.crypto_discount_cents]
    .every(value => value == null || recordedCents(value) !== null);
  const tax = recordedCents(order.tax_cents) || 0;
  const points = recordedCents(order.points_redeemed, pricing.redeemed_points) || 0;
  const credit = recordedCents(order.credit_redeemed_cents, pricing.credit_cents) || 0;
  const rows = [{ label: 'Subtotal', cents: recordedCents(order.subtotal_cents, pricing.subtotal_cents) || 0 }];
  if (discount > 0) {
    if (breakdownValid && coupon + crypto === discount) {
      if (coupon > 0) rows.push({ label: 'Coupon discount' + (pricing.coupon_code ? ' (' + String(pricing.coupon_code) + ')' : ''), cents: coupon, deduction: true });
      if (crypto > 0) rows.push({ label: 'Crypto discount', cents: crypto, deduction: true });
    } else {
      rows.push({ label: 'Discount', cents: discount, deduction: true });
    }
  }
  rows.push({ label: 'Shipping', cents: recordedCents(order.shipping_cents) || 0 });
  if (tax > 0) rows.push({ label: 'Tax', cents: tax });
  if (points > 0) rows.push({ label: 'Points redeemed', cents: points, deduction: true });
  if (credit > 0) rows.push({ label: 'Store credit', cents: credit, deduction: true });
  rows.push({ label: 'Total', cents: recordedCents(order.total_cents) || 0, total: true });
  return rows;
}

function itemAmount(item) {
  const gross = recordedCents(item.gross_cents);
  if (gross !== null) return gross;
  const net = recordedCents(item.line_total_cents);
  if (net !== null) return net + (recordedCents(item.discount_cents) || 0);
  return (Number(item.quantity) || 0) * (Number(item.unit_price_cents) || 0);
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

function buildStatusEmail({ order, notificationType, orderUrl = 'https://getpurelabs.com/account/purchases' }) {
  const copy = STATUS_COPY[notificationType];
  if (!copy) throw new Error('Unsupported customer notification type.');

  const orderNumber = order.order_number || 'Unavailable';
  const items = order.store_order_items || order.items || [];
  const currency = order.currency || 'usd';
  const totals = orderTotalRows(order);
  const itemRows = items.map((item) => `
    <tr>
      <td style="padding:10px 12px 10px 0;border-bottom:1px solid #e5e5e5;">
        <strong>${escapeHtml(item.product_name)}</strong><br>
        <span style="color:#666666;font-size:13px;">${escapeHtml(item.variant_size || '')} × ${Number(item.quantity) || 0}</span>
      </td>
      <td style="padding:10px 0;border-bottom:1px solid #e5e5e5;text-align:right;white-space:nowrap;">
        ${money(itemAmount(item), currency)}
      </td>
    </tr>
  `).join('');
  const address = addressLines(order);
  const link = trackingUrl(order.tracking_carrier, order.tracking_number);
  const tracking = order.tracking_carrier || order.tracking_number
    ? `<div style="margin-top:24px;padding:18px;background:#f5f5f5;border:1px solid #e5e5e5;border-radius:8px;">
        <strong>Tracking information</strong>
        ${order.tracking_carrier ? `<p>Carrier: ${escapeHtml(order.tracking_carrier)}</p>` : ''}
        ${order.tracking_number ? `<p>Tracking number: ${escapeHtml(order.tracking_number)}</p>` : ''}
        ${link ? `<p style="margin-bottom:0;"><a href="${escapeHtml(link)}" style="color:#111111;text-decoration:underline;">Track your shipment</a></p>` : ''}
      </div>`
    : '';
  const html = emailLayout({
    label: notificationType === 'confirmation' ? 'Order confirmation' : 'Order update',
    body: `
        <h2 style="margin:0 0 16px;font-size:24px;line-height:1.25;letter-spacing:-.02em;">${escapeHtml(copy.heading)}</h2>
        <p style="margin:0 0 12px;">Dear ${escapeHtml(order.customer_name || 'Customer')},</p>
        <p style="margin:0;color:#444444;">${escapeHtml(copy.message)}</p>
        ${orderSummary({ orderNumber, paymentStatus: formatStatus(order.payment_status, PAYMENT_LABELS), orderStatus: formatStatus(order.fulfillment_status), customerEmail: order.customer_email, orderUrl })}
        <h3 style="margin:0 0 12px;font-size:17px;line-height:1.4;">Order items</h3>
        <table width="100%" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;">${itemRows}</table>
        <div data-pure-order-totals="true" style="margin-top:18px;padding-top:14px;border-top:1px solid #e5e5e5;">
          ${totals.map(row => `<p style="margin:0 0 8px;${row.total ? 'font-size:18px;' : ''}">${escapeHtml(row.label)}: <strong>${row.deduction ? '−' : ''}${money(row.cents, currency)}</strong></p>`).join('')}
        </div>
        ${address.length ? `<h3 style="margin:24px 0 12px;font-size:17px;">Shipping address</h3><p style="margin:0;color:#444444;">${address.map(escapeHtml).join('<br>')}</p>` : ''}
        ${tracking}
        ${researchNotice()}`
  });
  const textLines = [
    'PURE',
    copy.heading,
    copy.message,
    `Order number: ${orderNumber}`,
    `Customer: ${order.customer_name || 'Customer'}`,
    `Customer email: ${order.customer_email || ''}`,
    `Payment status: ${formatStatus(order.payment_status, PAYMENT_LABELS)}`,
    `Order status: ${formatStatus(order.fulfillment_status)}`,
    `View secure order: ${orderUrl}`,
    '',
    'Order items:',
    ...items.map((item) => `- ${item.product_name} ${item.variant_size || ''} × ${item.quantity}: ${money(itemAmount(item), currency)}`),
    ...totals.map(row => `${row.label}: ${row.deduction ? '-' : ''}${money(row.cents, currency)}`),
    '',
    'Shipping address:',
    ...address,
    ...(order.tracking_carrier ? [`Carrier: ${order.tracking_carrier}`] : []),
    ...(order.tracking_number ? [`Tracking number: ${order.tracking_number}`] : []),
    ...(link ? [`Track shipment: ${link}`] : []),
    '',
    'Research use only. Products are supplied for controlled laboratory research and are not for human or veterinary use, ingestion, injection, diagnosis, treatment, or consumption.',
    `Support: ${SUPPORT_EMAIL}`
  ];
  return {
    subject: `${copy.subject} — ${orderNumber}`,
    html,
    text: textLines.join('\n')
  };
}

module.exports = {
  STATUS_COPY,
  FULFILLMENT_LABELS,
  PAYMENT_LABELS,
  formatStatus,
  trackingUrl,
  orderTotalRows,
  buildStatusEmail
};
