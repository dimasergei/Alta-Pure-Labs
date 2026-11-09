const ORDER_SELECT = `
  id,
  order_number,
  created_at,
  customer_name,
  customer_email,
  organization,
  payment_status,
  fulfillment_status,
  supplier_status,
  supplier_report_generated_at,
  priority,
  archived,
  archived_at,
  subtotal_cents,
  shipping_cents,
  tax_cents,
  total_cents,
  currency,
  shipping_name,
  shipping_address,
  tracking_carrier,
  tracking_number,
  shipped_at,
  admin_notes,
  internal_status_history,
  store_order_items (
    id,
    product_id,
    product_name,
    variant_size,
    quantity,
    unit_price_cents,
    supplier_sku,
    supplier_name,
    lot_number,
    fulfillment_notes
  )
`;

const FULFILLMENT_STATUSES = new Set([
  'unfulfilled',
  'processing',
  'awaiting_supplier',
  'partially_shipped',
  'shipped',
  'delivered',
  'canceled'
]);

const PAYMENT_STATUSES = new Set([
  'pending',
  'paid',
  'failed',
  'expired',
  'partially_refunded',
  'refunded'
]);

const VIEW_NAMES = new Set([
  'active',
  'needs_action',
  'completed',
  'archived',
  'all',
  ...FULFILLMENT_STATUSES,
  ...PAYMENT_STATUSES
]);

const SORT_NAMES = new Set([
  'newest',
  'oldest',
  'highest_total',
  'oldest_pending'
]);

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function integerParameter(value, fallback, minimum, maximum, name) {
  if (value === null || value === '') return fallback;

  if (!/^\d+$/.test(value)) {
    throw badRequest(`Invalid ${name}.`);
  }

  const number = Number(value);

  if (
    !Number.isSafeInteger(number) ||
    number < minimum ||
    number > maximum
  ) {
    throw badRequest(`Invalid ${name}.`);
  }

  return number;
}

function dateParameter(value, name) {
  if (!value) return null;

  // Require explicit timezone so filtering is not server-timezone dependent.
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  ) {
    throw badRequest(
      `${name} must be an ISO timestamp with a timezone.`
    );
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw badRequest(`Invalid ${name}.`);
  }

  return date.toISOString();
}

function searchPattern(value) {
  /*
   * Quote the PostgREST value and escape its quoted-string characters.
   * Escape LIKE wildcards so search text is treated literally.
   */
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');

  return JSON.stringify(`%${escaped}%`);
}

function parseOrderParameters(params) {
  const view = params.get('status') || 'active';
  const sort = params.get('sort') || 'newest';
  const priority = params.get('priority') || '';
  const search = (params.get('search') || '').trim();
  const paymentStatus = params.get('payment_status') || '';
  const fulfillmentStatus = params.get('fulfillment_status') || '';

  if (paymentStatus && !PAYMENT_STATUSES.has(paymentStatus)) {
    throw badRequest('Invalid payment status filter.');
  }
  if (fulfillmentStatus && !FULFILLMENT_STATUSES.has(fulfillmentStatus)) {
    throw badRequest('Invalid fulfillment status filter.');
  }

  if (!VIEW_NAMES.has(view)) {
    throw badRequest('Invalid order view.');
  }

  if (!SORT_NAMES.has(sort)) {
    throw badRequest('Invalid sort option.');
  }

  if (priority && !['low', 'normal', 'high'].includes(priority)) {
    throw badRequest('Invalid priority.');
  }

  if (search.length > 200 || /[\u0000-\u001f]/.test(search)) {
    throw badRequest('Search must be 200 characters or fewer.');
  }

  const page = integerParameter(
    params.get('page'),
    1,
    1,
    100000,
    'page'
  );

  const pageSize = integerParameter(
    params.get('page_size'),
    50,
    1,
    100,
    'page size'
  );

  const from = dateParameter(params.get('from'), 'Start date');
  const to = dateParameter(params.get('to'), 'End date');

  if (from && to && new Date(from) >= new Date(to)) {
    throw badRequest('End date must be after start date.');
  }

  return {
    view,
    sort,
    priority,
    search,
    paymentStatus,
    fulfillmentStatus,
    page,
    pageSize,
    from,
    to
  };
}

function applyOrderFilters(query, options) {
  const {
    view,
    priority,
    search,
    from,
    to,
    sort,
    paymentStatus,
    fulfillmentStatus
  } = options;

  if (view === 'archived') {
    query = query.eq('archived', true);
  } else if (view !== 'all') {
    query = query.eq('archived', false);
  }

  if (view === 'active' || view === 'needs_action') {
    query = query
      .eq('payment_status', 'paid')
      .in('fulfillment_status', [
        'unfulfilled',
        'processing',
        'awaiting_supplier',
        'partially_shipped',
        'shipped'
      ]);
  } else if (view === 'completed') {
    query = query.eq('fulfillment_status', 'delivered');
  } else if (PAYMENT_STATUSES.has(view)) {
    query = query.eq('payment_status', view);
  } else if (FULFILLMENT_STATUSES.has(view)) {
    query = query.eq('fulfillment_status', view);
  }

  if (view === 'needs_action') {
    query = query.in('fulfillment_status', [
      'unfulfilled',
      'processing',
      'awaiting_supplier',
      'partially_shipped'
    ]);
  }

  if (sort === 'oldest_pending') {
    query = query.eq('payment_status', 'pending');
  }

  if (paymentStatus) query = query.eq('payment_status', paymentStatus);
  if (fulfillmentStatus) query = query.eq('fulfillment_status', fulfillmentStatus);

  if (priority) {
    query = query.eq('priority', priority);
  }

  if (from) {
    query = query.gte('created_at', from);
  }

  // Exclusive upper bound supports complete local-calendar date ranges.
  if (to) {
    query = query.lt('created_at', to);
  }

  if (search) {
    const pattern = searchPattern(search);
    const searchTerms = [
      'order_number',
      'customer_name',
      'customer_email',
      'organization',
      'tracking_number'
    ].map((column) => `${column}.ilike.${pattern}`);
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(search)) {
      searchTerms.push(`id.eq.${search}`);
    }
    query = query.or(searchTerms.join(','));
  }

  return query;
}

async function listAdminOrders(db, params) {
  const options = parseOrderParameters(params);

  /*
   * Oldest Pending is a payment queue, not the active paid-order queue.
   * Preserve the requested archive scope but do not intersect with Paid.
   */
  const filterOptions = options.sort === 'oldest_pending'
    ? {
        ...options,
        view: ['all', 'archived'].includes(options.view)
          ? options.view
          : 'pending'
      }
    : options;

  let query = db
    .from('store_orders')
    .select(ORDER_SELECT, { count: 'exact' });

  query = applyOrderFilters(query, filterOptions);

  if (options.sort === 'highest_total') {
    query = query
      .order('total_cents', { ascending: false })
      .order('created_at', { ascending: false });
  } else {
    query = query.order('created_at', {
      ascending: ['oldest', 'oldest_pending'].includes(options.sort)
    });
  }

  // Stable tie-breaker for records with identical timestamps.
  query = query.order('id', { ascending: true });

  const offset = (options.page - 1) * options.pageSize;

  const { data, error, count } = await query.range(
    offset,
    offset + options.pageSize - 1
  );

  if (error) throw error;

  const total = count || 0;

  return {
    orders: data || [],
    pagination: {
      page: options.page,
      page_size: options.pageSize,
      total,
      total_pages: Math.ceil(total / options.pageSize),
      has_previous: options.page > 1,
      has_next: offset + options.pageSize < total
    },
    filters: {
      status: filterOptions.view,
      sort: options.sort,
      priority: options.priority,
      search: options.search,
      payment_status: options.paymentStatus,
      fulfillment_status: options.fulfillmentStatus,
      from: options.from,
      to: options.to
    }
  };
}

module.exports = {
  listAdminOrders,
  FULFILLMENT_STATUSES
};
