const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'admin-orders.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'admin-dashboard.css'), 'utf8');
const batchApi = fs.readFileSync(path.join(root, 'api/admin-supplier-batches.js'), 'utf8');
const supplierApi = fs.readFileSync(path.join(root, 'api/admin-suppliers.js'), 'utf8');
const notificationApi = fs.readFileSync(path.join(root, 'api/admin-notifications.js'), 'utf8');

test('admin dashboard exposes exactly three accessible primary sections', () => {
  const nav = html.match(/<nav class="admin-nav"[\s\S]*?<\/nav>/);
  assert.ok(nav);
  assert.deepEqual([...nav[0].matchAll(/data-admin-view="([^"]+)"/g)].map(x => x[1]), [
    'orders', 'batches', 'notifications'
  ]);
  assert.match(nav[0], /aria-label="Admin sections"/);
  assert.match(html, /id="admin-orders-section"/);
  assert.match(html, /id="admin-batches-section"/);
  assert.match(html, /id="admin-notifications-section"/);
});

test('admin dashboard uses responsive brand styling and visible keyboard focus', () => {
  assert.match(html, /Plus\+Jakarta\+Sans/);
  assert.match(html, /admin-dashboard\.css/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /@media\s*\(max-width:\s*650px\)/);
  assert.match(css, /prefers-reduced-motion/);
});

test('order filters independently support payment and fulfillment states', () => {
  assert.match(html, /id="payment-filter"/);
  assert.match(html, /id="fulfillment-filter"/);
  assert.match(html, /payment_status: appliedFilters\.paymentStatus/);
  assert.match(html, /fulfillment_status: appliedFilters\.fulfillmentStatus/);
});

test('destructive supplier and batch operations remain behind server-side admin authentication', () => {
  assert.match(supplierApi, /req\.headers\['x-admin-password'\]/);
  assert.match(supplierApi, /req\.method === 'DELETE'/);
  assert.match(supplierApi, /referenced by a batch/i);
  assert.match(batchApi, /req\.headers\['x-admin-password'\]/);
  assert.match(batchApi, /admin_delete_supplier_batch/);
});

test('notification history supports pagination and related batch references', () => {
  assert.match(html, /notification-previous/);
  assert.match(html, /notification-next/);
  assert.match(notificationApi, /\.range\(offset, offset \+ limit - 1\)/);
  assert.match(notificationApi, /batch_references/);
});

test('admin dashboard inline JavaScript parses successfully', () => {
  const script = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(script, 'admin page script exists');
  assert.doesNotThrow(() => new Function(script[1]));
});


test('archived batches show archived state and a working restore action', () => {
  assert.match(batchApi, /updated_at,\s*archived_at,\s*suppliers/);
  assert.match(html, /batch\.archived_at \? 'Archived' : 'Active'/);
  assert.match(html, /data-action="restore-batch"/);
  assert.match(html, /const archived = action === 'archive-batch'/);
  assert.match(html, /body: JSON\.stringify\(\{ batch_id: batchId, archived \}\)/);
});

test('orders filters are a single accessible collapsed disclosure with all order views inside', () => {
  assert.match(html, /id="filters-toggle"[^>]*aria-expanded="false"[^>]*aria-controls="orders-filter-panel"/);
  assert.match(html, /id="orders-filter-panel"[^>]*hidden/);
  const panel = html.match(/<section id="orders-filter-panel"[\s\S]*?<\/section>/);
  assert.ok(panel);
  for (const status of ['active', 'paid', 'processing', 'awaiting_supplier', 'shipped', 'delivered', 'canceled', 'refunded', 'archived', 'all']) {
    assert.match(panel[0], new RegExp('data-status="' + status + '"'));
  }
  assert.match(panel[0], /id="apply-filters"/);
  assert.match(panel[0], /id="reset-filters"/);
  assert.match(html, /id="applied-filter-summary"/);
  assert.match(html, /id="active-filter-count"/);
});

test('header utility controls are accessible icon buttons and navigation remains viewport-centered', () => {
  assert.match(html, /id="refresh-button"[^>]*aria-label="Refresh orders"[^>]*title="Refresh orders"/);
  assert.match(html, /class="admin-icon-button" href="\/" aria-label="Open storefront" title="Open storefront"/);
  assert.match(html, /id="logout-button"[^>]*aria-label="Log out"[^>]*title="Log out"/);
  assert.match(css, /\.admin-nav[\s\S]*?left:50%[\s\S]*?transform:translate\(-50%,-50%\)/);
  assert.match(css, /\.admin-icon-button:focus-visible/);
});

test('dashboard uses the homepage laboratory background and preserves light-surface contrast tokens', () => {
  assert.match(css, /url\("\/assets\/hero-lab\.webp"\)/);
  assert.match(css, /--admin-ink:\s*#101817/);
  assert.match(css, /\.admin-view-section \.order-toggle[\s\S]*?color:#111817/);
});
