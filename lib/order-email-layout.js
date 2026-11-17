'use strict';

// Keep email artwork identical to the storefront, using PNGs supported by mail clients.
const ASSETS = 'https://getpurelabs.com/assets/';
const SUPPORT_EMAIL = 'support@getpurelabs.com';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));
}

function orderAction(url, label = 'View secure order') {
  if (!url) return '';
  const destination = new URL(url);
  if (destination.origin !== 'https://getpurelabs.com' || destination.username || destination.password) {
    throw new Error('Order email actions must use the PURE website.');
  }
  return `<table role="presentation" data-pure-order-action="true" cellspacing="0" cellpadding="0" border="0" style="margin-top:18px;border-collapse:separate;">
    <tr><td bgcolor="#111111" style="background:#111111;border:1px solid #111111;border-radius:6px;text-align:center;">
      <a href="${escapeHtml(url)}" style="display:inline-block;background:#111111;color:#ffffff;padding:13px 20px;border-radius:5px;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:700;line-height:20px;letter-spacing:.02em;">${escapeHtml(label)}</a>
    </td></tr>
  </table>`;
}

function orderSummary({ orderNumber, paymentStatus, orderStatus, customerEmail, orderUrl, actionLabel }) {
  return `<div data-pure-order-summary="true" style="background:#f5f5f5;border:1px solid #e5e5e5;padding:18px;border-radius:8px;margin:24px 0;">
    <p style="margin:0 0 8px;line-height:1.6;"><strong>Order number:</strong> ${escapeHtml(orderNumber)}</p>
    <p style="margin:0 0 8px;line-height:1.6;"><strong>Payment status:</strong> ${escapeHtml(paymentStatus)}</p>
    <p style="margin:0 0 8px;line-height:1.6;"><strong>Order status:</strong> ${escapeHtml(orderStatus)}</p>
    <p style="margin:0;line-height:1.6;overflow-wrap:anywhere;word-break:break-word;"><strong>Customer email:</strong> ${escapeHtml(customerEmail)}</p>
    ${orderAction(orderUrl, actionLabel)}
  </div>`;
}

function researchNotice() {
  return `<div data-pure-research-notice="true" style="margin-top:28px;padding:18px;background:#f5f5f5;border:1px solid #e5e5e5;border-radius:8px;font-size:13px;line-height:1.6;color:#666666;">
    <strong style="color:#111111;">Research use only.</strong> Products are supplied for controlled laboratory research and are not for human or veterinary use, ingestion, injection, diagnosis, treatment, or consumption.
  </div>`;
}

function emailLayout({ label = 'Order update', body, footer = 'PURE · Research use only · Not for human consumption' }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>PURE — ${escapeHtml(label)}</title>
<style>@media only screen and (max-width:480px){.pure-email-padding{padding:24px 20px!important}.pure-email-outer{padding:12px 8px!important}}</style></head>
<body style="margin:0;padding:0;background:#f5f5f5;color:#111111;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f5f5f5" style="width:100%;border-collapse:collapse;background:#f5f5f5;">
    <tr><td class="pure-email-outer" align="center" style="padding:24px 12px;">
      <div style="font-family:Arial,Helvetica,sans-serif;max-width:620px;margin:0 auto;text-align:left;font-size:14px;line-height:1.6;color:#111111;">
        <div class="pure-email-padding" data-pure-email-header="true" style="background:#ffffff;color:#111111;padding:28px 32px;border:1px solid #e5e5e5;border-bottom:0;border-radius:10px 10px 0 0;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;"><tr>
            <td width="48" valign="middle" style="width:48px;padding:0 12px 0 0;"><img src="${ASSETS}pure-icon-96.png" alt="" width="36" height="36" style="display:block;width:36px;height:36px;border:0;"></td>
            <td valign="middle" style="padding:0;"><h1 style="margin:0;font-size:22px;line-height:26px;"><img src="${ASSETS}pure-wordmark-dark.png" alt="PURE" width="112" height="26" style="display:block;width:112px;height:26px;border:0;"></h1></td>
          </tr></table>
          <p style="margin:14px 0 0;color:#666666;font-size:12px;line-height:18px;letter-spacing:.08em;text-transform:uppercase;">${escapeHtml(label)}</p>
        </div>
        <div class="pure-email-padding" data-pure-email-body="true" style="background:#ffffff;padding:28px 32px 32px;border:1px solid #e5e5e5;border-radius:0 0 10px 10px;">${body}</div>
        <div data-pure-email-footer="true" style="padding:20px 24px;color:#666666;font-size:12px;line-height:1.6;">
          <p style="margin:0 0 6px;">Support: <a href="mailto:${SUPPORT_EMAIL}" style="color:#666666;text-decoration:underline;">${SUPPORT_EMAIL}</a></p>
          <p style="margin:0;">${escapeHtml(footer)}</p>
        </div>
      </div>
    </td></tr>
  </table>
</body></html>`;
}

module.exports = { escapeHtml, orderSummary, researchNotice, emailLayout, SUPPORT_EMAIL };
