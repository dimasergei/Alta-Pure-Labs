(function () {
  'use strict';
  const el = (tag, text, cls) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (cls) node.className = cls; return node; };
  const money = (cents, currency) => new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100) + ' ' + currency;
  const addressText = a => [a.name, a.company, a.street1, a.street2, [a.city, a.state, a.zip].filter(Boolean).join(', '), a.country].filter(Boolean).join('\n');
  function field(parent, title, value = '', required = false, type = 'text') {
    const label = el('label', undefined, 'psl-field'), caption = el('span', title), input = el('input');
    input.type = type; input.value = value; input.required = required; input.maxLength = 200;
    if (type === 'number') { input.min = '0.0001'; input.step = 'any'; }
    label.append(caption, input); parent.append(label); return input;
  }
  function select(parent, title, values, current) {
    const label = el('label', undefined, 'psl-field'), input = el('select');
    for (const [value, text] of values) { const option = el('option', text); option.value = value; input.append(option); }
    if (current) input.value = current;
    label.append(el('span', title), input); parent.append(label); return input;
  }
  function link(parent, text, href) { const a = el('a', text, 'ghost psl-link'); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; parent.append(a); return a; }
  function mount({ host, row, api }) {
    if (!['commerce', 'store'].includes(row.source) || ['membership', 'research_subscription'].includes(row.kind)) return;
    const section = el('section', undefined, 'uc-section psl-section');
    section.append(el('h3', 'Shipping'), el('p', 'Compare carrier rates before payment, buy a label once payment is confirmed, and view or print the 4 × 6 PDF here. Buying a label does not mark the order shipped.', 'uc-hint'));
    const open = el('button', 'Get rates & manage labels', 'ghost psl-open'), panel = el('div', undefined, 'psl-panel'); open.type = 'button'; panel.hidden = true;
    panel.id = 'psl-' + row.source + '-' + row.id; open.setAttribute('aria-controls', panel.id); open.setAttribute('aria-expanded', 'false');
    section.append(open, panel); host.append(section);
    const billing = el('aside', undefined, 'psl-billing');
    billing.append(el('h4', 'Postage billing'), el('p', 'Live labels are billed through your saved Shippo payment method. Label purchase records appear here; billing invoices, payment status, and payment method changes remain in Shippo.', 'uc-hint'));
    link(billing, 'Manage Shippo billing', 'https://apps.goshippo.com/settings/account/billing').title = 'Opens Shippo billing in a new tab';
    section.append(billing);
    const identity = { id: row.id, source: row.source };
    const send = body => api('/api/admin-orders', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...identity, ...body }) });
    const get = () => api('/api/admin-orders?' + new URLSearchParams({ view: 'shipping-label', ...identity }));
    const notice = (text, bad = false) => { const p = el('p', text, bad ? 'psl-notice psl-error' : 'psl-notice'); p.setAttribute('role', bad ? 'alert' : 'status'); panel.append(p); return p; };
    async function perform(button, task) {
      button.disabled = true;
      try { await task(); } catch (error) { notice(error.message || 'Shipping details are unavailable. Please refresh.', true); }
      finally { if (button.isConnected) button.disabled = false; }
    }
    const fileUrl = (label, kind = 'label', download = false) => '/api/admin-orders?' + new URLSearchParams({ view: 'shipping-label-file', ...identity, label_id: label.id, kind, ...(download ? { download: '1' } : {}) });
    const purchaseBlock = state => {
      if (state.payment_confirmed !== true) return state.purchase_reason || 'Payment must be confirmed before a shipping label can be purchased. You can compare rates now.';
      if (state.eligible !== true) return state.purchase_reason || state.reason || 'This order is not ready for a label purchase.';
      if (state.purchase_enabled !== true) return state.test_mode ? 'Test label generation is disabled in the shipping configuration. You can still review rates.' : 'Live label purchases are disabled in the shipping configuration. You can still review rates.';
      return '';
    };
    function showLabel(label, state) {
      const box = el('article', undefined, 'psl-result psl-label-record');
      const titles = { created: label.test ? 'Test label generated' : 'Shipping label purchased', purchasing: 'Label purchase pending', review: 'Label purchase needs review', failed: 'Carrier could not create the label', refunded: 'Shipping label refunded' };
      box.append(el('h4', titles[label.status] || 'Shipping label'));
      if (label.message) box.append(el('p', label.message, 'uc-hint'));
      if (label.test) box.append(el('p', 'TEST LABEL · Not valid postage. Do not use this PDF to mail a parcel.', 'psl-notice'));
      const record = el('dl', undefined, 'psl-postage-record');
      const detail = (name, value) => { if (value) { record.append(el('dt', name), el('dd', value)); } };
      if (label.rate) {
        detail('Carrier / service', [label.rate.carrier, label.rate.service].filter(Boolean).join(' · '));
        detail(label.test ? 'Test rate' : 'Postage amount', money(label.rate.amount_cents, label.rate.currency));
      }
      if (label.created_at && Number.isFinite(Date.parse(label.created_at))) detail('Record created', new Date(label.created_at).toLocaleString());
      detail('Transaction reference', label.transaction_id);
      detail('Tracking number', label.tracking_number);
      if (record.childElementCount) { box.append(el('h5', 'Postage record'), record); }
      if (label.recipient) { box.append(el('strong', 'Label destination'), el('p', addressText(label.recipient), 'psl-address')); }
      if (label.recipient && addressText(label.recipient) !== addressText(state.recipient)) box.append(el('p', 'The saved order address has changed since this label was created. Review the label destination before dispatch.', 'psl-notice psl-error'));
      const actions = el('div', undefined, 'psl-actions');
      if (label.status === 'created' && (label.label_url || label.has_label)) {
        const pdfUrl = fileUrl(label), frame = el('iframe', undefined, 'psl-label-preview');
        frame.src = pdfUrl; frame.title = label.test ? 'Test shipping label PDF — not valid postage' : 'Shipping label PDF — 4 × 6 inches';
        frame.loading = 'lazy'; frame.referrerPolicy = 'no-referrer';
        let previewReady = false;
        frame.addEventListener('load', () => { previewReady = true; });
        box.append(el('h5', 'Label preview'), frame);
        const print = el('button', label.test ? 'Print test label' : 'Print label', 'ghost'); print.type = 'button';
        print.addEventListener('click', () => {
          try {
            if (!previewReady || !frame.contentWindow || typeof frame.contentWindow.print !== 'function') throw new Error('PDF preview is not ready.');
            frame.contentWindow.focus(); frame.contentWindow.print();
          } catch { window.open(pdfUrl, '_blank', 'noopener,noreferrer'); }
        });
        actions.append(print);
        link(actions, label.test ? 'Download test PDF' : 'Download 4 × 6 label', fileUrl(label, 'label', true));
        link(actions, label.test ? 'Open test PDF' : 'Open label PDF', pdfUrl);
        box.append(el('p', 'Print at actual size (100%) on 4 × 6 paper. If the preview is unavailable, open the PDF from this dashboard.', 'uc-hint'));
      }
      if (label.status === 'created' && (label.customs_url || label.has_customs)) link(actions, 'Download customs invoice', fileUrl(label, 'customs', true));
      if (label.tracking_url) link(actions, 'Carrier tracking', label.tracking_url);
      if (['review', 'purchasing'].includes(label.status) && !label.transaction_id) {
        box.append(el('p', 'Use Check label status to look for the existing carrier transaction. A repeat purchase is blocked while this outcome is unknown.', 'uc-hint'));
      }
      if (['created', 'purchasing', 'review'].includes(label.status)) {
        const refresh = el('button', label.status === 'created' ? 'Refresh label link' : 'Check label status', 'ghost'); refresh.type = 'button';
        refresh.addEventListener('click', () => perform(refresh, async () => {
          await send({ action: label.transaction_id ? 'shipping_label_refresh' : 'shipping_label_reconcile', label_id: label.id });
          await render(await get());
        }));
        actions.append(refresh);
      }
      box.append(actions); panel.append(box);
    }
    function showRates(label, state, form) {
      form.hidden = true;
      const box = el('div', undefined, 'psl-result psl-quote'), choose = el('form', undefined, 'psl-rates');
      const expiresAt = Date.parse(label.expires_at), expired = Number.isFinite(expiresAt) && expiresAt <= Date.now();
      const blocked = purchaseBlock(state), canPurchase = !blocked && !expired;
      const disabledText = expired ? 'Quote expired — get new rates' : state.payment_confirmed !== true ? 'Payment required to buy label' : state.eligible !== true ? 'Order not ready for label' : 'Label purchases disabled';
      box.append(el('h4', 'Compare shipping rates'), el('p', expired ? 'This quote has expired. Get fresh rates before purchasing a label.' : blocked || (state.test_mode ? 'TEST MODE · Labels are not valid for shipping and no live postage is purchased.' : 'The selected postage is charged to your connected Shippo account only after you confirm. Your Shippo plan may bill separate label fees.'), 'uc-hint'));
      if (Number.isFinite(expiresAt)) box.append(el('p', 'Quote expires ' + new Date(expiresAt).toLocaleString(), 'psl-quote-expiry'));
      const addresses = el('div', undefined, 'psl-route');
      for (const [title, address] of [['Ship from', label.sender], ['Ship to', label.recipient]]) {
        const column = el('div'); column.append(el('strong', title), el('p', addressText(address || {}), 'psl-address')); addresses.append(column);
      }
      box.append(addresses);
      if (label.parcel) box.append(el('p', `Parcel: ${label.parcel.length} × ${label.parcel.width} × ${label.parcel.height} ${label.parcel.distance_unit} · ${label.parcel.weight} ${label.parcel.mass_unit}`, 'psl-parcel-summary'));
      if (label.warnings?.length) {
        const warnings = el('div', undefined, 'psl-notice'); warnings.append(el('strong', 'Carrier messages to review'));
        for (const message of label.warnings) warnings.append(el('p', message));
        warnings.append(el('p', 'Resolve missing shipment information before purchasing a label.'));
        box.append(warnings);
      }
      const allRates = label.rates || [], controls = el('div', undefined, 'psl-rate-controls');
      const carrier = select(controls, 'Carrier', [['', 'All carriers'], ...[...new Set(allRates.map(rate => rate.carrier))].sort().map(name => [name, name])]);
      const sort = select(controls, 'Sort rates', [['price', 'Price (within each currency)'], ['fastest', 'Fastest estimated delivery']], 'price');
      const count = el('p', undefined, 'uc-hint'); count.setAttribute('role', 'status');
      const list = el('div', undefined, 'psl-rate-list');
      choose.append(controls, count, list);
      let selected;
      const approval = el('label', undefined, 'uc-check'), yes = el('input'); yes.type = 'checkbox'; yes.required = true; yes.disabled = !canPurchase;
      approval.append(yes, el('span', 'I verified the recipient, ship-from address, packed weight and dimensions, and selected postage.'));
      const buy = el('button', canPurchase ? state.test_mode ? 'Generate test label' : 'Buy selected label' : disabledText); buy.type = 'submit'; buy.disabled = !canPurchase;
      choose.append(approval, buy); box.append(choose);
      const updateBuy = () => { if (canPurchase) buy.textContent = state.test_mode ? 'Generate test label' : selected ? 'Buy label · ' + money(selected.amount_cents, selected.currency) : 'Buy selected label'; };
      function renderRates() {
        const costOrder = (a, b) => a.currency.localeCompare(b.currency) || a.amount_cents - b.amount_cents;
        const days = rate => Number.isSafeInteger(rate.estimated_days) && rate.estimated_days >= 0 ? rate.estimated_days : Infinity;
        const visible = allRates.filter(rate => !carrier.value || rate.carrier === carrier.value).sort(sort.value === 'fastest' ? (a, b) => days(a) - days(b) || costOrder(a, b) : costOrder);
        if (selected && !visible.some(rate => rate.id === selected.id)) { selected = undefined; yes.checked = false; }
        list.replaceChildren();
        count.textContent = visible.length + ' of ' + allRates.length + ' rates · Estimates are not delivery guarantees.';
        for (const rate of visible) {
          const line = el('label', undefined, 'psl-rate'), radio = el('input'); radio.type = 'radio'; radio.name = 'postage-' + label.id; radio.required = true; radio.value = rate.id; radio.checked = selected?.id === rate.id;
          const detail = el('span', undefined, 'psl-rate-service'); detail.append(el('strong', rate.carrier + ' · ' + rate.service), el('span', days(rate) === Infinity ? 'Transit estimate unavailable' : 'Estimated ' + rate.estimated_days + (rate.estimated_days === 1 ? ' day' : ' days') + ' in transit'));
          const price = el('strong', money(rate.amount_cents, rate.currency), 'psl-rate-price');
          radio.addEventListener('change', () => { selected = rate; updateBuy(); });
          line.append(radio, detail, price); list.append(line);
        }
        updateBuy();
      }
      carrier.addEventListener('change', renderRates); sort.addEventListener('change', renderRates); renderRates();
      const edit = el('button', 'Edit parcel or sender', 'ghost'); edit.type = 'button'; edit.addEventListener('click', () => { box.remove(); form.hidden = false; }); box.append(edit);
      choose.addEventListener('submit', event => {
        event.preventDefault(); if (!canPurchase || !selected || !choose.reportValidity()) return;
        if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) { buy.disabled = true; buy.textContent = 'Quote expired — get new rates'; notice('This quote has expired. Edit the parcel details and get fresh rates.'); return; }
        if (!window.confirm(state.test_mode ? 'Generate this test label? It is not valid postage.' : 'Buy this ' + selected.carrier + ' label for ' + money(selected.amount_cents, selected.currency) + ' through Shippo?')) return;
        perform(buy, async () => {
          let purchaseError = '';
          try { await send({ action: 'shipping_label_buy', label_id: label.id, rate_id: selected.id, amount_cents: selected.amount_cents, currency: selected.currency, confirm_purchase: true }); }
          catch (error) { purchaseError = typeof error.message === 'string' ? error.message.slice(0, 600) : 'The label purchase response could not be confirmed.'; }
          // Once submitted, never leave the stale Buy controls available while
          // refreshing, even if the purchase succeeded but the state read fails.
          box.remove(); notice('Checking the purchase outcome before another label can be created…');
          try { await render(await get()); }
          finally { if (purchaseError) notice(purchaseError, true); }
        });
      });
      panel.append(box);
    }
    async function render(state) {
      panel.replaceChildren();
      const toolbar = el('div', undefined, 'psl-toolbar'), refresh = el('button', 'Refresh shipping details', 'ghost'); refresh.type = 'button';
      refresh.addEventListener('click', () => perform(refresh, async () => { await render(await get()); }));
      toolbar.append(el('span', state.payment_confirmed === true ? 'Payment confirmed' : state.payment_confirmed === false ? 'Awaiting payment' : 'Shipping workspace', 'psl-payment-state'), refresh); panel.append(toolbar);
      if (!state.configured) {
        notice(state.configuration_error || 'Connect Shippo to request carrier rates and buy shipping labels. You will enter the actual ship-from address and packed parcel details before purchasing.', Boolean(state.configuration_error));
        panel.append(el('p', 'The account API token must be added to this site’s secure shipping configuration. Do not paste it into order notes.', 'uc-hint'));
      } else if (state.test_mode) {
        notice('TEST MODE · These labels are for integration testing and cannot be used to ship an order.');
      } else {
        notice(state.purchase_enabled === false ? 'LIVE MODE · Live label purchases are disabled in the shipping configuration. You can still review rates.' : 'LIVE MODE · Review rates before confirming a purchase. Confirmed labels are charged through Shippo.');
      }
      const labels = (state.labels || []).filter(x => x.status !== 'quoted');
      for (const label of labels) showLabel(label, state);
      if (state.quote_notice) notice(state.quote_notice);
      if (state.quote_eligible !== true) { if (state.quote_reason || state.reason) notice(state.quote_reason || state.reason); return; }
      if (!state.configured || labels.some(x => x.test === state.test_mode && ['created', 'purchasing', 'review'].includes(x.status))) return;
      if (state.eligible !== true) notice(purchaseBlock(state));
      const draft = state.draft || {}, draftSender = draft.sender || state.sender || {}, draftParcel = draft.parcel || {}, draftCustoms = draft.customs || {};
      const form = el('form', undefined, 'psl-form'); form.append(el('h4', 'Recipient'), el('p', addressText(state.recipient), 'psl-address'), el('p', 'Need a correction? Save the shipping address in the order first, then reopen this panel.', 'uc-hint'));
      form.append(el('p', 'Customer’s delivery selection: ' + state.shipping_service, 'uc-hint'));
      const senderGroup = el('fieldset'); senderGroup.append(el('legend', 'Ship from / return address')); const sender = {};
      for (const [key, title, required] of [['name', 'Sender name', true], ['company', 'Company', false], ['street1', 'Street address', true], ['street2', 'Address line 2', false], ['city', 'City', true], ['state', 'State / province', true], ['zip', 'Postal code', true], ['country', 'Country code (US, CA, etc.)', true], ['phone', 'Sender phone', true], ['email', 'Sender email', true]]) sender[key] = field(senderGroup, title, draftSender[key] || '', required, key === 'email' ? 'email' : 'text');
      sender.country.maxLength = 2; form.append(senderGroup);
      const parcelGroup = el('fieldset'); parcelGroup.append(el('legend', 'Packed parcel')); const packed = {};
      for (const [key, title] of [['length', 'Length'], ['width', 'Width'], ['height', 'Height'], ['weight', 'Packed weight']]) packed[key] = field(parcelGroup, title, draftParcel[key] || '', true, 'number');
      const metric = draftSender.country?.trim().toUpperCase() === 'CA';
      packed.distance_unit = select(parcelGroup, 'Dimension unit', [['in', 'Inches'], ['cm', 'Centimetres']], draftParcel.distance_unit || (metric ? 'cm' : 'in'));
      packed.mass_unit = select(parcelGroup, 'Weight unit', [['lb', 'Pounds'], ['oz', 'Ounces'], ['g', 'Grams'], ['kg', 'Kilograms']], draftParcel.mass_unit || (metric ? 'g' : 'lb')); form.append(parcelGroup);
      const customsGroup = el('fieldset', undefined, 'psl-customs'); customsGroup.append(el('legend', 'International customs declaration'));
      customsGroup.append(el('p', 'Use the actual goods, manufacturing origins, tariff codes, total item values, and total net weights. Weight uses the parcel unit selected above.', 'uc-hint'));
      const customItems = [];
      for (const [index, item] of state.items.entries()) {
        const savedItem = draftCustoms.items?.[index] || {};
        const group = el('div', undefined, 'psl-customs-item'); group.append(el('h5', item.description + ' × ' + item.quantity));
        customItems.push({ description: field(group, 'Accurate customs description', savedItem.description || item.description, true), origin_country: field(group, 'Country of manufacture (2 letters)', savedItem.origin_country || '', true), tariff_number: field(group, 'HS / tariff code', savedItem.tariff_number || '', true), value_amount: field(group, 'Total declared value (' + state.currency + ')', savedItem.value_amount || '', true, 'number'), net_weight: field(group, 'Total net weight for this line', savedItem.net_weight || '', true, 'number') });
        customsGroup.append(group);
      }
      const signer = field(customsGroup, 'Person certifying the declaration', draftCustoms.certify_signer || '', true), incoterm = select(customsGroup, 'Duties and import taxes', [['DDU', 'Recipient pays import duties and taxes'], ['DDP', 'Sender pays (carrier support required)']], draftCustoms.incoterm || 'DDU');
      const filing = field(customsGroup, 'US export filing reference or applicable exemption', draftCustoms.eel_pfc || '', false);
      const caFiling = select(customsGroup, 'Canadian export filing option', [['', 'Choose if required by the carrier'], ['NOT_REQUIRED', 'Not required'], ['FILED_ELECTRONICALLY', 'Filed electronically'], ['SUMMARY_REPORTING', 'Summary reporting']], draftCustoms.b13a_filing_option || '');
      const caNumber = field(customsGroup, 'Canadian export filing number (if applicable)', draftCustoms.b13a_number || '', false);
      const certify = el('label', undefined, 'uc-check'), certified = el('input'); certified.type = 'checkbox'; certified.required = true;
      certify.append(certified, el('span', 'I certify that the customs information is accurate and complete.')); customsGroup.append(certify); form.append(customsGroup);
      function updateCustoms() {
        const country = sender.country.value.trim().toUpperCase(), recipientCountry = String(state.recipient.country || '').trim().toUpperCase();
        const international = country.length === 2 && country !== recipientCountry;
        customsGroup.hidden = !international; customsGroup.disabled = !international;
        filing.closest('label').hidden = country !== 'US'; filing.disabled = country !== 'US'; filing.required = country === 'US' && international;
        caFiling.closest('label').hidden = country !== 'CA'; caFiling.disabled = country !== 'CA'; caNumber.closest('label').hidden = country !== 'CA'; caNumber.disabled = country !== 'CA';
      }
      sender.country.addEventListener('input', updateCustoms); updateCustoms();
      const quote = el('button', 'Get shipping rates'); quote.type = 'submit'; form.append(quote);
      const values = controls => Object.fromEntries(Object.entries(controls).map(([key, input]) => [key, input.value.trim()]));
      form.addEventListener('submit', event => {
        event.preventDefault(); if (!form.reportValidity()) return;
        perform(quote, async () => {
          const result = await send({ action: 'shipping_label_quote', sender: values(sender), parcel: values(packed), customs: customsGroup.disabled ? null : { items: customItems.map(values), certify: certified.checked, certify_signer: signer.value.trim(), incoterm: incoterm.value, eel_pfc: filing.value.trim(), b13a_filing_option: caFiling.value, b13a_number: caNumber.value.trim() } });
          showRates(result.label, state, form);
        });
      });
      panel.append(form);
      if (state.current_quote) showRates(state.current_quote, state, form);
    }
    open.addEventListener('click', () => perform(open, async () => {
      if (!panel.hidden) { panel.hidden = true; open.textContent = 'Get rates & manage labels'; open.setAttribute('aria-expanded', 'false'); return; }
      panel.hidden = false; open.textContent = 'Hide shipping workspace'; open.setAttribute('aria-expanded', 'true'); panel.replaceChildren(el('p', 'Loading shipping details…', 'uc-hint'));
      await render(await get());
    }));
  }
  window.PureShippingLabels = { mount };
})();
