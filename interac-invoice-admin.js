(function () {
  'use strict';

  const endpoint = '/api/customer-config?commerce=admin&view=';
  const el = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = String(text);
    if (className) node.className = className;
    return node;
  };
  const money = (cents, currency = 'CAD') => new Intl.NumberFormat('en-CA', { style: 'currency', currency, currencyDisplay: 'code' }).format(cents / 100);
  const eligible = order => order?.status === 'requested' && order.kind === 'goods' && order.request_data?.preferred_payment?.provider_key === 'interac' && !order.cancellation_status && !order.cancellation_requested_at;
  const safeMethods = (result, requestedId) => (result.methods || []).filter(method => method.id === requestedId && method.active === true && method.kind === 'interac' && method.provider_key === 'interac' && method.currency === 'CAD' && !method.native_provider && ['goods', 'both'].includes(method.sale_scope) && Number.isSafeInteger(method.version)).map(({ id, version, label }) => ({ id, version, label }));
  function field(parent, title, name, { value = '', type = 'text', required = true, min, max, step, minLength, maxLength = 180 } = {}) {
    const label = el('label', undefined, 'pica-field');
    const control = el(type === 'textarea' ? 'textarea' : 'input');
    if (type !== 'textarea') control.type = type;
    else control.rows = 2;
    control.name = name; control.value = value; control.required = required; control.maxLength = maxLength;
    for (const [key, item] of Object.entries({ min, max, step, minLength })) if (item !== undefined) control[key] = item;
    label.append(el('span', title), control); parent.append(label); return control;
  }
  function select(parent, title, name, options) {
    const label = el('label', undefined, 'pica-field'), control = el('select');
    control.name = name; control.required = true;
    for (const [value, title] of options) { const option = el('option', title); option.value = value; control.append(option); }
    label.append(el('span', title), control); parent.append(label); return control;
  }
  function check(parent, title, name) {
    const label = el('label', undefined, 'pica-check'), control = el('input');
    control.type = 'checkbox'; control.name = name; control.required = true;
    label.append(control, el('span', title)); parent.append(label); return control;
  }
  function button(parent, title, action, className = 'ghost') {
    const control = el('button', title, className); control.type = 'button'; control.addEventListener('click', action); parent.append(control); return control;
  }
  function grid(parent, three = false) { const node = el('div', undefined, three ? 'pica-grid pica-grid-three' : 'pica-grid'); parent.append(node); return node; }
  function fact(parent, title, value) { const row = el('div', undefined, 'pica-fact'); row.append(el('dt', title), el('dd', value)); parent.append(row); }
  function decimal(control, scale, minimum, maximum, label) {
    const value = control.value.trim(), places = Math.log10(scale);
    if (!new RegExp('^\\d+(?:\\.\\d{1,' + places + '})?$').test(value)) throw Error('Enter ' + label + ' with at most ' + places + ' decimal places.');
    const amount = Math.round(Number(value) * scale);
    if (!Number.isSafeInteger(amount) || amount < minimum || amount > maximum) throw Error('Check ' + label + '.');
    return amount;
  }
  function integer(control, minimum, maximum, label) {
    const value = control.value.trim(), amount = Number(value);
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(amount) || amount < minimum || amount > maximum) throw Error('Check ' + label + '.');
    return amount;
  }
  function requestSummary(parent, order) {
    const checkout = order.request_data.checkout || {}, estimate = checkout.usd_estimate, facts = el('dl', undefined, 'pica-request');
    if (estimate?.currency === 'USD' && Number.isSafeInteger(estimate.total_cents)) {
      fact(facts, 'Requested USD estimate', money(estimate.total_cents, 'USD'));
      if (Number.isSafeInteger(estimate.shipping_cents)) fact(facts, 'Estimated delivery', money(estimate.shipping_cents, 'USD'));
      if (Number.isSafeInteger(estimate.discount_cents) && estimate.discount_cents > 0) fact(facts, 'Estimated discount', '−' + money(estimate.discount_cents, 'USD'));
    } else {
      const items = order.request_data.items || [];
      const known = items.length > 0 && items.every(item => Number.isSafeInteger(item.unit_price_usd_cents) && Number.isSafeInteger(item.qty));
      fact(facts, 'Merchandise USD reference', known ? money(items.reduce((sum, item) => sum + item.unit_price_usd_cents * item.qty, 0), 'USD') : 'Estimate unavailable');
    }
    fact(facts, 'Requested coupon', checkout.coupon || 'None');
    const delivery = checkout.delivery || {}, labels = { standard: 'Standard delivery', express: 'Express delivery', priority: 'Priority processing', protection: 'Shipping protection' };
    const selected = [delivery.shipping, ...(Array.isArray(delivery.extras) ? delivery.extras : [])].filter(Boolean).map(value => labels[value] || value);
    fact(facts, 'Requested delivery', selected.join(' · ') || 'No selection recorded');
    parent.append(facts, el('p', 'The USD estimate is a reference. The customer must accept the final CAD invoice before Interac instructions are shown.', 'pica-note'));
  }
  function mount({ host, order, api, onIssued, onRefresh }) {
    if (!host || !eligible(order) || typeof api !== 'function') return;
    const section = el('section', undefined, 'pica-panel');
    section.append(el('h4', 'Review CAD invoice'));
    requestSummary(section, order);
    const status = el('p', 'Loading approved Interac methods…', 'pica-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    section.append(status); host.append(section);
    const destination = order.request_data.address || {};
    if (!destination.country || !destination.region) { status.textContent = 'This request has no complete delivery destination. Reload the order before reviewing it.'; return; }

    let methods = [], preview = null, busy = false, issued = false, revision = 0, methodReady = false, methodsRevision = 0;
    const form = el('form', undefined, 'pica-form'); form.noValidate = true;
    const fields = el('fieldset', undefined, 'pica-form-body'); form.append(fields);
    const methodRow = grid(fields), method = select(methodRow, 'Approved Interac method', 'method_id', [['', 'Loading…']]);
    const refresh = button(methodRow, 'Refresh payment methods', () => loadMethods(), 'ghost pica-refresh');
    const amounts = grid(fields);
    const fx = field(amounts, 'CAD per 1 USD', 'fx', { type: 'number', min: '0.1', max: '10', step: '0.000001' });
    const shipping = field(amounts, 'Final delivery charge (CAD)', 'shipping', { type: 'number', min: '0', max: '100000', step: '0.01' });
    fx.placeholder = 'Enter reviewed rate'; shipping.placeholder = 'Enter reviewed charge';

    const deliveryDetails = el('details', undefined, 'pica-review'); deliveryDetails.append(el('summary', 'Delivery review · required'));
    deliveryDetails.append(el('p', 'Use the actual dispatch location and current carrier quote for this destination. Include any requested delivery extras in the final delivery charge.', 'pica-note'));
    const profileSummary = el('p', 'Loading saved ship-from profile…', 'pica-note'); deliveryDetails.append(profileSummary);
    let savedSender = null;
    const useProfile = button(deliveryDetails, 'Use saved ship-from profile', () => {
      if (!savedSender || busy || issued) return;
      origin.value = String(savedSender.country || '').trim().toUpperCase(); originRegion.value = savedSender.state || '';
      updateDuties(); invalidate('Saved dispatch location applied. Review the carrier quote and tax treatment before previewing.');
    }); useProfile.disabled = true;
    const originGrid = grid(deliveryDetails), origin = field(originGrid, 'Dispatch country code', 'origin_country', { maxLength: 2 }), originRegion = field(originGrid, 'Dispatch province / state', 'origin_region', { minLength: 2, maxLength: 80 });
    const serviceGrid = grid(deliveryDetails), carrier = field(serviceGrid, 'Quoted carrier', 'carrier', { minLength: 2, maxLength: 100 }), service = field(serviceGrid, 'Quoted service', 'service', { minLength: 2, maxLength: 100 });
    const days = grid(deliveryDetails, true), handling = field(days, 'Handling: max business days', 'handling_max_days', { type: 'number', min: '0', max: '60', step: '1' }), transitMin = field(days, 'Transit: min business days', 'transit_min_days', { type: 'number', min: '1', max: '90', step: '1' }), transitMax = field(days, 'Transit: max business days', 'transit_max_days', { type: 'number', min: '1', max: '120', step: '1' });
    const quoteGrid = grid(deliveryDetails), quote = field(quoteGrid, 'Carrier quote reference (private)', 'quote_reference', { minLength: 4, maxLength: 400 }), quoteExpiry = field(quoteGrid, 'Quote valid until (local time)', 'quote_expires_at', { type: 'datetime-local' });
    const importGrid = grid(deliveryDetails), duties = select(importGrid, 'Import charges', 'duties', [['', 'Choose reviewed delivery terms'], ['domestic', 'Domestic shipment'], ['seller', 'Seller handles import charges'], ['customer', 'Customer handles import charges']]);
    const importer = field(importGrid, 'Importer of record', 'importer', { minLength: 2 });
    const route = field(deliveryDetails, 'Product, destination and carrier review (private)', 'route_review', { type: 'textarea', minLength: 12, maxLength: 600 });
    fields.append(deliveryDetails);

    const taxDetails = el('details', undefined, 'pica-review'); taxDetails.append(el('summary', 'Tax review · required'));
    taxDetails.append(el('p', 'Tax destination: ' + destination.region + ', ' + destination.country + '. The invoice uses the requested delivery address.', 'pica-note'));
    const taxGrid = grid(taxDetails), seller = field(taxGrid, 'Legal seller', 'seller_name', { value: '1001517614 ONTARIO INC.', minLength: 2 });
    const taxMode = select(taxGrid, 'Reviewed tax treatment', 'tax_mode', [['', 'Choose tax treatment'], ['reviewed', 'Reviewed tax lines / no collection'], ['canada_taxable_goods', 'Canadian taxable goods: calculate GST/HST']]);
    taxMode.querySelector('[value="canada_taxable_goods"]').disabled = String(destination.country).toUpperCase() !== 'CA';
    const canada = el('fieldset', undefined, 'pica-canada');
    const caGrid = grid(canada), registration = field(caGrid, 'GST/HST account number', 'gst_hst_number', { minLength: 15, maxLength: 15 }); registration.placeholder = '123456789RT0001';
    const taxableShipping = select(caGrid, 'GST/HST on delivery charge?', 'shipping_taxable', [['', 'Choose after review'], ['yes', 'Yes'], ['no', 'No — explain below']]);
    const canadianSupply = check(canada, 'I confirmed a taxable supply delivered in Canada and reviewed the import tax treatment.', 'canada_supply_confirmed');
    taxDetails.append(canada);
    const taxLines = el('div', undefined, 'pica-tax-lines'); taxDetails.append(taxLines);
    const components = [];
    const addTax = button(taxDetails, 'Add reviewed tax line', () => {
      if (components.length >= 5 || busy || issued) return;
      const row = el('section', undefined, 'pica-tax-line'), fields = grid(row), index = components.length + '-' + revision;
      const item = { row, label: field(fields, 'Tax name', 'tax_label_' + index, { minLength: 2, maxLength: 60 }), rate: field(fields, 'Rate (%)', 'tax_rate_' + index, { type: 'number', min: '0.0001', max: '30', step: '0.0001' }), base: field(fields, 'Taxable amount (CAD)', 'tax_base_' + index, { type: 'number', min: '0.01', step: '0.01' }), authority: field(fields, 'Registration / collection authority', 'tax_authority_' + index, { minLength: 2, maxLength: 80 }) };
      button(row, 'Remove tax line', () => { if (busy || issued) return; components.splice(components.indexOf(item), 1); row.remove(); addTax.disabled = false; invalidate(); });
      components.push(item); taxLines.append(row); addTax.disabled = components.length >= 5; invalidate(); item.label.focus();
    });
    taxDetails.append(el('p', 'Add only the taxes you reviewed. A zero-tax invoice requires a documented no-collection basis. GST/HST calculated above must not be added again.', 'pica-note'));
    const basis = field(taxDetails, 'Tax treatment explanation (shown on invoice)', 'tax_basis', { type: 'textarea', minLength: 12, maxLength: 1200 });
    const jurisdictions = check(taxDetails, 'I reviewed destination collection obligations, including provincial, state and local taxes.', 'jurisdictions_reviewed');
    fields.append(taxDetails);
    const reviewNote = field(fields, 'Internal invoice review note', 'review_note', { type: 'textarea', minLength: 12, maxLength: 2000 }); reviewNote.placeholder = 'Record the conversion source and final delivery, tax and fulfillment review.';
    const reviewed = check(fields, 'I can fulfill these exact items and destination, and I reviewed the final conversion, shipping and tax treatment.', 'fulfillment_confirmed');
    const previewButton = el('button', 'Preview CAD invoice', 'primary'); previewButton.type = 'submit'; previewButton.disabled = true; form.append(previewButton); section.append(form);
    const previewBox = el('section', undefined, 'pica-preview'); previewBox.hidden = true; previewBox.setAttribute('aria-label', 'Final CAD invoice preview'); section.append(previewBox);
    const issueBox = el('div', undefined, 'pica-issue'); issueBox.hidden = true;
    const finalReview = check(issueBox, 'I reviewed this exact CAD invoice and am ready to issue it to the customer.', 'issue_confirmed');
    const issueButton = button(issueBox, 'Issue CAD invoice', issue, 'primary'); issueButton.disabled = true; section.append(issueBox);
    const reloadButton = button(section, 'Reload order', () => onRefresh?.(), 'ghost pica-reload'); reloadButton.hidden = true;

    function notice(message, bad = false) { status.textContent = message; status.classList.toggle('pica-error', bad); status.setAttribute('role', bad ? 'alert' : 'status'); }
    function invalidate(message = 'Details changed. Review and preview the updated CAD invoice.') {
      revision++; preview = null; finalReview.checked = false; issueButton.disabled = true; issueBox.hidden = true; previewBox.hidden = true;
      reviewed.checked = false;
      if (methodReady) notice(message);
    }
    function updateTax() { canada.hidden = taxMode.value !== 'canada_taxable_goods'; canada.disabled = canada.hidden; }
    function updateDuties() {
      const country = origin.value.trim().toUpperCase(), domestic = country === String(destination.country).toUpperCase();
      for (const option of duties.options) if (option.value) option.disabled = !!country && (option.value === 'domestic') !== domestic;
      if (duties.selectedOptions[0]?.disabled) duties.value = '';
      importer.closest('label').hidden = !['seller', 'customer'].includes(duties.value); importer.disabled = importer.closest('label').hidden;
    }
    function changed(event) {
      if (issued) return;
      if (event.target === origin || event.target === duties) updateDuties();
      if (event.target === taxMode) updateTax();
      const wasReviewed = event.target === reviewed && reviewed.checked;
      invalidate(); if (wasReviewed) reviewed.checked = true;
    }
    form.addEventListener('input', changed); form.addEventListener('change', changed);
    finalReview.addEventListener('change', () => { issueButton.disabled = !preview || busy || issued || !finalReview.checked; });
    updateTax(); updateDuties();
    function validate() {
      const invalid = Array.from(form.elements).find(control => control.willValidate && !control.checkValidity());
      if (!invalid) return true;
      let ancestor = invalid.parentElement;
      while (ancestor && ancestor !== form) { if (ancestor.tagName === 'DETAILS') ancestor.open = true; ancestor = ancestor.parentElement; }
      invalid.reportValidity(); invalid.focus(); notice('Complete the highlighted invoice review field before previewing.', true); return false;
    }
    function body() {
      const selected = methods.find(item => item.id === method.value);
      if (!selected || !methodReady) throw Error('Choose an active, approved CAD Interac method.');
      const expiry = new Date(quoteExpiry.value);
      if (!Number.isFinite(expiry.getTime()) || expiry.getTime() <= Date.now()) throw Error('Use a current carrier quote with a future expiry.');
      const delivery = { origin_country: origin.value.trim().toUpperCase(), origin_region: originRegion.value.trim(), carrier: carrier.value.trim(), service: service.value.trim(), quote_reference: quote.value.trim(), quote_expires_at: expiry.toISOString(), handling_max_days: integer(handling, 0, 60, 'handling days'), transit_min_days: integer(transitMin, 1, 90, 'minimum transit days'), transit_max_days: integer(transitMax, 1, 120, 'maximum transit days'), duties: duties.value, importer: importer.disabled ? '' : importer.value.trim(), route_review: route.value.trim().replace(/[\r\n]+/g, ' ') };
      return {
        id: order.id, version: order.version, method_id: selected.id, expected_method_version: selected.version,
        fx_ppm: decimal(fx, 1000000, 100000, 10000000, 'CAD per USD'), shipping_cents: decimal(shipping, 100, 0, 10000000, 'the CAD delivery charge'),
        delivery_tax: { seller_name: seller.value.trim(), destination_country: String(destination.country).toUpperCase(), destination_region: destination.region, tax_mode: taxMode.value, tax_basis: basis.value.trim().replace(/[\r\n]+/g, ' '), components: components.map(item => ({ label: item.label.value.trim(), rate_ppm: decimal(item.rate, 10000, 1, 300000, 'the tax percentage'), taxable_cents: decimal(item.base, 100, 1, 100000000, 'the taxable CAD amount'), registration_number: item.authority.value.trim() })), gst_hst_number: canada.disabled ? '' : registration.value.trim(), canada_supply_confirmed: !canada.disabled && canadianSupply.checked, shipping_taxable: canada.disabled || !taxableShipping.value ? null : taxableShipping.value === 'yes', jurisdictions_reviewed: jurisdictions.checked, confirmed: reviewed.checked, delivery },
        review_note: reviewNote.value.trim(), fulfillment_confirmed: reviewed.checked
      };
    }
    const send = payload => api(endpoint + 'write', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    function setBusy(value, issuing = false) { busy = value; fields.disabled = value && issuing; previewButton.disabled = value || !methodReady || !methods.length || issued; refresh.disabled = value || issued; issueButton.disabled = value || !preview || !finalReview.checked || issued; finalReview.disabled = value || issued; }
    function showPreview(result, payload) {
      previewBox.replaceChildren(el('h5', 'Final CAD invoice preview'));
      const facts = el('dl', undefined, 'pica-totals');
      fact(facts, 'Merchandise', money(result.subtotal_cents)); fact(facts, 'Discounts', '−' + money(result.discount_cents));
      fact(facts, 'Delivery', money(result.shipping_cents)); fact(facts, 'Tax', money(result.tax_cents));
      fact(facts, 'Final amount', money(result.total_cents)); previewBox.append(facts);
      const pricing = result.pricing || result, coupon = order.request_data.checkout?.coupon;
      if (coupon && pricing.coupon_discount_cents > 0) previewBox.append(el('p', coupon + ' included: −' + money(pricing.coupon_discount_cents), 'pica-note'));
      const review = pricing.delivery_tax;
      if (review) {
        const facts = el('dl', undefined, 'pica-final-review');
        fact(facts, 'Seller', review.seller_name); fact(facts, 'Tax treatment', review.tax_basis);
        for (const tax of review.taxes || []) fact(facts, tax.label + ' (' + (tax.rate_ppm / 10000) + '%)', money(tax.amount_cents));
        const delivery = review.delivery;
        if (delivery) {
          fact(facts, 'Delivery', delivery.carrier + ' · ' + delivery.service + ' · from ' + delivery.origin_region + ', ' + delivery.origin_country);
          fact(facts, 'Timing', 'Handling up to ' + delivery.handling_max_days + ' business days; transit ' + delivery.transit_min_days + '–' + delivery.transit_max_days + ' business days');
          fact(facts, 'Import charges', delivery.duties === 'domestic' ? 'Domestic shipment' : (delivery.duties === 'seller' ? 'Seller' : 'Customer') + ' handles import charges · Importer: ' + delivery.importer);
        }
        previewBox.append(facts);
      }
      previewBox.append(el('p', '1 USD = ' + (payload.fx_ppm / 1000000) + ' CAD · Pay before ' + new Date(result.expires_at).toLocaleString(), 'pica-note'));
      previewBox.hidden = false; issueBox.hidden = false; finalReview.checked = false; issueButton.textContent = 'Issue ' + money(result.total_cents) + ' invoice';
    }
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (busy || issued || !validate()) return;
      preview = null; finalReview.checked = false; issueBox.hidden = true; previewBox.hidden = true;
      const ticket = revision; setBusy(true); notice('Calculating the final CAD invoice…');
      try {
        const payload = body(), result = await send({ action: 'preview', ...payload });
        if (!section.isConnected || ticket !== revision) return;
        if (result.id !== order.id || result.version !== order.version || result.method_id !== payload.method_id || result.currency !== 'CAD' || !Number.isSafeInteger(result.total_cents) || result.total_cents <= 0 || !Number.isFinite(Date.parse(result.expires_at)) || Date.parse(result.expires_at) <= Date.now()) throw Error('The CAD preview is unavailable or expired. Reload this order and preview again.');
        if (JSON.stringify(body()) !== JSON.stringify(payload)) { invalidate(); return; }
        preview = { result, payload, fingerprint: JSON.stringify(payload) }; showPreview(result, payload); notice('Preview ready. Review the exact CAD amount before issuing.');
      } catch (error) { if (section.isConnected && ticket === revision) { preview = null; notice(error.message || 'The CAD invoice could not be previewed.', true); } }
      finally { setBusy(false); }
    });
    async function issue() {
      if (busy || issued) return;
      if (!preview || !finalReview.checked) { notice('Preview and review the final CAD invoice before issuing it.', true); return; }
      if (!validate()) return;
      const current = preview, ticket = revision;
      try {
        if (Date.parse(current.result.expires_at) <= Date.now() || JSON.stringify(body()) !== current.fingerprint) { invalidate('The preview changed or expired. Preview the invoice again.'); return; }
        setBusy(true, true); notice('Checking the approved method and issuing the reviewed CAD invoice…');
        const latest = safeMethods(await api(endpoint + 'methods'), order.request_data.preferred_payment.method_id), selected = latest.find(item => item.id === current.payload.method_id);
        if (!section.isConnected || ticket !== revision) return;
        if (!selected || selected.version !== current.payload.expected_method_version) {
          methods = latest; renderMethods(current.payload.method_id); invalidate('The Interac method changed. Review the current method and preview again.'); return;
        }
        if (JSON.stringify(body()) !== current.fingerprint) { invalidate(); return; }
        const result = await send({ action: 'issue', ...current.payload, expected_total_cents: current.result.total_cents });
        issued = true; fields.disabled = true; issueBox.hidden = true; preview = null;
        notice('CAD invoice issued. The customer must accept it before viewing Interac instructions. Payment has not been marked received.');
        if (typeof onIssued === 'function') {
          try { await onIssued(result); }
          catch { notice('CAD invoice issued. Reload this order to view its updated status.'); reloadButton.hidden = typeof onRefresh !== 'function'; }
        }
      } catch (error) {
        invalidate(); notice((error.message || 'Issuance could not be confirmed.') + ' Reload the order before trying to issue again.', true); reloadButton.hidden = typeof onRefresh !== 'function';
      } finally { setBusy(false); if (issued) fields.disabled = true; }
    }
    function renderMethods(current = method.value || order.request_data.preferred_payment.method_id) {
      method.replaceChildren(); const empty = el('option', methods.length ? 'Choose approved CAD Interac method' : 'No active CAD Interac method'); empty.value = ''; method.append(empty);
      for (const item of methods) { const option = el('option', item.label + ' · CAD'); option.value = item.id; method.append(option); }
      method.value = methods.some(item => item.id === current) ? current : ''; previewButton.disabled = busy || !methodReady || !methods.length || issued;
    }
    async function loadMethods() {
      if (busy || issued) return;
      const ticket = ++methodsRevision;
      invalidate(); methodReady = false; previewButton.disabled = true; refresh.disabled = true;
      try {
        const result = await api(endpoint + 'methods'); if (!section.isConnected || ticket !== methodsRevision) return;
        methods = safeMethods(result, order.request_data.preferred_payment.method_id); methodReady = true; renderMethods();
        notice(methods.length ? 'Enter the reviewed CAD rate and delivery charge, then complete delivery and tax review.' : 'No active CAD Interac method is available. Enable the approved saved method, then refresh payment methods.');
      } catch (error) { if (section.isConnected && ticket === methodsRevision) { methods = []; renderMethods(); notice(error.message || 'Approved Interac methods could not be loaded.', true); } }
      finally { if (ticket === methodsRevision) refresh.disabled = issued; }
    }
    loadMethods();
    api('/api/admin-orders?view=shipping-preferences').then(result => {
      if (!section.isConnected || issued) return;
      savedSender = result.preferences?.sender || null; useProfile.disabled = !savedSender;
      profileSummary.textContent = savedSender ? 'Saved ship-from: ' + [savedSender.company || savedSender.name, savedSender.state, savedSender.country].filter(Boolean).join(' · ') + '. Apply only if this order dispatches from that location.' : 'No ship-from profile is saved. Enter the actual dispatch location below.';
    }).catch(() => { if (section.isConnected) profileSummary.textContent = 'Saved ship-from profile unavailable. Enter the actual dispatch location below.'; });
    return section;
  }
  window.PureInteracInvoiceAdmin = { mount };
})();
