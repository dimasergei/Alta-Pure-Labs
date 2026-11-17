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
    section.append(el('h3', 'Shipping label'), el('p', 'Create a carrier label for this order, review postage, then download the 4 × 6 PDF. Buying a label does not mark the order shipped.', 'uc-hint'));
    const open = el('button', 'Generate shipping label', 'ghost'), panel = el('div', undefined, 'psl-panel'); open.type = 'button'; panel.hidden = true;
    section.append(open, panel); host.append(section);
    const identity = { id: row.id, source: row.source };
    const send = body => api('/api/admin-orders', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...identity, ...body }) });
    const get = () => api('/api/admin-orders?' + new URLSearchParams({ view: 'shipping-label', ...identity }));
    const notice = (text, bad = false) => { const p = el('p', text, bad ? 'psl-notice psl-error' : 'psl-notice'); p.setAttribute('role', bad ? 'alert' : 'status'); panel.append(p); return p; };
    async function perform(button, task) {
      button.disabled = true;
      try { await task(); } catch (error) { notice(error.message || 'Shipping details are unavailable. Please refresh.', true); }
      finally { if (button.isConnected) button.disabled = false; }
    }
    function showLabel(label, state) {
      const box = el('div', undefined, 'psl-result');
      const titles = { created: label.test ? 'Test label generated' : 'Shipping label purchased', purchasing: 'Label purchase pending', review: 'Label purchase needs review', failed: 'Carrier could not create the label', refunded: 'Shipping label refunded' };
      box.append(el('h4', titles[label.status] || 'Shipping label'));
      if (label.rate) box.append(el('p', [label.rate.carrier, label.rate.service, money(label.rate.amount_cents, label.rate.currency)].filter(Boolean).join(' · ')));
      if (label.message) box.append(el('p', label.message, 'uc-hint'));
      if (label.recipient) { box.append(el('strong', 'Label destination')); const dest = el('p', addressText(label.recipient), 'psl-address'); box.append(dest); }
      if (label.recipient && addressText(label.recipient) !== addressText(state.recipient)) box.append(el('p', 'The saved order address has changed since this label was created. Review the label in Shippo before dispatch.', 'psl-notice psl-error'));
      if (label.tracking_number) box.append(el('p', 'Tracking: ' + label.tracking_number));
      const actions = el('div', undefined, 'psl-actions');
      if (label.label_url && label.status === 'created') link(actions, label.test ? 'Open test PDF' : 'Download 4 × 6 label', label.label_url);
      if (label.customs_url) link(actions, 'Download customs invoice', label.customs_url);
      if (label.tracking_url) link(actions, 'Carrier tracking', label.tracking_url);
      link(actions, 'Open Shippo', 'https://apps.goshippo.com/shipments');
      let transaction;
      if (['review', 'purchasing'].includes(label.status) && !label.transaction_id) {
        transaction = field(box, 'Shippo transaction ID (after locating this purchase)', '', false);
        transaction.maxLength = 32;
        box.append(el('p', 'Find the shipment with reference pure-label:' + label.id + '. A repeat purchase is blocked while this outcome is unknown.', 'uc-hint'));
      }
      if (['created', 'purchasing', 'review'].includes(label.status)) {
        const refresh = el('button', label.status === 'created' ? 'Refresh label link' : 'Check label status', 'ghost'); refresh.type = 'button';
        refresh.addEventListener('click', () => perform(refresh, async () => { await send({ action: 'shipping_label_refresh', label_id: label.id, transaction_id: transaction?.value || '' }); await render(await get()); }));
        actions.append(refresh);
      }
      box.append(actions); panel.append(box);
    }
    function showRates(label, state, form) {
      form.hidden = true;
      const box = el('div', undefined, 'psl-result'), choose = el('form', undefined, 'psl-rates');
      box.append(el('h4', 'Review postage'), el('p', state.test_mode ? 'TEST MODE · Labels are not valid for shipping and no live postage is purchased.' : 'The selected postage is charged to your connected Shippo account. Your Shippo plan may bill separate label fees.', 'uc-hint'));
      box.append(el('strong', 'Ship from'), el('p', addressText(label.sender), 'psl-address'), el('strong', 'Ship to'), el('p', addressText(label.recipient), 'psl-address'));
      box.append(el('p', `Parcel: ${label.parcel.length} × ${label.parcel.width} × ${label.parcel.height} ${label.parcel.distance_unit} · ${label.parcel.weight} ${label.parcel.mass_unit}`));
      if (label.warnings?.length) {
        const warnings = el('div', undefined, 'psl-notice'); warnings.append(el('strong', 'Carrier messages to review'));
        for (const message of label.warnings) warnings.append(el('p', message));
        warnings.append(el('p', 'Resolve any missing information in the shipment details before buying. Use Shippo directly if a carrier requires fields that are not available here.'));
        box.append(warnings);
      }
      let selected;
      for (const rate of label.rates) {
        const line = el('label', undefined, 'psl-rate'), radio = el('input'); radio.type = 'radio'; radio.name = 'postage'; radio.required = true; radio.value = rate.id;
        const detail = el('span'); detail.append(el('strong', rate.carrier + ' · ' + rate.service), el('span', money(rate.amount_cents, rate.currency) + (rate.estimated_days ? ' · Estimated ' + rate.estimated_days + ' days in transit' : '')));
        radio.addEventListener('change', () => { selected = rate; buy.textContent = state.test_mode ? 'Generate test label' : 'Buy label · ' + money(rate.amount_cents, rate.currency); });
        line.append(radio, detail); choose.append(line);
      }
      const approval = el('label', undefined, 'uc-check'), yes = el('input'); yes.type = 'checkbox'; yes.required = true;
      approval.append(yes, el('span', 'I verified the recipient, ship-from address, packed weight and dimensions, and selected postage.'));
      const buy = el('button', state.test_mode ? 'Generate test label' : 'Buy selected label'); buy.type = 'submit';
      choose.append(approval, buy); box.append(choose);
      const edit = el('button', 'Edit parcel or sender', 'ghost'); edit.type = 'button'; edit.addEventListener('click', () => { box.remove(); form.hidden = false; }); box.append(edit);
      choose.addEventListener('submit', event => {
        event.preventDefault(); if (!selected || !choose.reportValidity()) return;
        if (!window.confirm(state.test_mode ? 'Generate this test label? It is not valid postage.' : 'Buy this ' + selected.carrier + ' label for ' + money(selected.amount_cents, selected.currency) + ' through Shippo?')) return;
        perform(buy, async () => {
          try { await send({ action: 'shipping_label_buy', label_id: label.id, rate_id: selected.id, amount_cents: selected.amount_cents, currency: selected.currency, confirm_purchase: true }); }
          catch { box.remove(); notice('Checking the purchase outcome before another label can be created…'); }
          await render(await get());
        });
      });
      panel.append(box);
    }
    async function render(state) {
      panel.replaceChildren();
      if (!state.configured) {
        notice('Connect Shippo to request carrier rates and buy shipping labels. You will enter the actual ship-from address and packed parcel details before purchasing.');
        link(panel, 'Set up Shippo', 'https://apps.goshippo.com/settings/api');
        panel.append(el('p', 'The account API token must be added to this site’s secure shipping configuration. Do not paste it into order notes.', 'uc-hint'));
      }
      const labels = (state.labels || []).filter(x => x.status !== 'quoted');
      for (const label of labels) showLabel(label, state);
      if (!state.eligible) { notice(state.reason); return; }
      if (!state.configured || labels.some(x => x.test === state.test_mode && ['created', 'purchasing', 'review'].includes(x.status))) return;
      if (state.test_mode) notice('TEST MODE · These labels are for integration testing and cannot be used to ship an order.');
      const form = el('form', undefined, 'psl-form'); form.append(el('h4', 'Recipient'), el('p', addressText(state.recipient), 'psl-address'), el('p', 'Need a correction? Save the shipping address in the order first, then reopen this panel.', 'uc-hint'));
      form.append(el('p', 'Customer’s delivery selection: ' + state.shipping_service, 'uc-hint'));
      const senderGroup = el('fieldset'); senderGroup.append(el('legend', 'Ship from / return address')); const sender = {};
      for (const [key, title, required] of [['name', 'Sender name', true], ['company', 'Company', false], ['street1', 'Street address', true], ['street2', 'Address line 2', false], ['city', 'City', true], ['state', 'State / province', true], ['zip', 'Postal code', true], ['country', 'Country code (US, CA, etc.)', true], ['phone', 'Sender phone', true], ['email', 'Sender email', true]]) sender[key] = field(senderGroup, title, state.sender?.[key] || '', required, key === 'email' ? 'email' : 'text');
      sender.country.maxLength = 2; form.append(senderGroup);
      const parcelGroup = el('fieldset'); parcelGroup.append(el('legend', 'Packed parcel')); const packed = {};
      for (const [key, title] of [['length', 'Length'], ['width', 'Width'], ['height', 'Height'], ['weight', 'Packed weight']]) packed[key] = field(parcelGroup, title, '', true, 'number');
      packed.distance_unit = select(parcelGroup, 'Dimension unit', [['in', 'Inches'], ['cm', 'Centimetres']], 'in');
      packed.mass_unit = select(parcelGroup, 'Weight unit', [['lb', 'Pounds'], ['oz', 'Ounces'], ['g', 'Grams'], ['kg', 'Kilograms']], 'lb'); form.append(parcelGroup);
      const customsGroup = el('fieldset', undefined, 'psl-customs'); customsGroup.append(el('legend', 'International customs declaration'));
      customsGroup.append(el('p', 'Use the actual goods, manufacturing origins, tariff codes, total item values, and total net weights. Weight uses the parcel unit selected above.', 'uc-hint'));
      const customItems = [];
      for (const item of state.items) {
        const group = el('div', undefined, 'psl-customs-item'); group.append(el('h5', item.description + ' × ' + item.quantity));
        customItems.push({ description: field(group, 'Accurate customs description', item.description, true), origin_country: field(group, 'Country of manufacture (2 letters)', '', true), tariff_number: field(group, 'HS / tariff code', '', true), value_amount: field(group, 'Total declared value (' + state.currency + ')', '', true, 'number'), net_weight: field(group, 'Total net weight for this line', '', true, 'number') });
        customsGroup.append(group);
      }
      const signer = field(customsGroup, 'Person certifying the declaration', '', true), incoterm = select(customsGroup, 'Duties and import taxes', [['DDU', 'Recipient pays import duties and taxes'], ['DDP', 'Sender pays (carrier support required)']], 'DDU');
      const filing = field(customsGroup, 'US export filing reference or applicable exemption', '', false);
      const caFiling = select(customsGroup, 'Canadian export filing option', [['', 'Choose if required by the carrier'], ['NOT_REQUIRED', 'Not required'], ['FILED_ELECTRONICALLY', 'Filed electronically'], ['SUMMARY_REPORTING', 'Summary reporting']]);
      const caNumber = field(customsGroup, 'Canadian export filing number (if applicable)', '', false);
      const certify = el('label', undefined, 'uc-check'), certified = el('input'); certified.type = 'checkbox'; certified.required = true;
      certify.append(certified, el('span', 'I certify that the customs information is accurate and complete.')); customsGroup.append(certify); form.append(customsGroup);
      function updateCustoms() {
        const country = sender.country.value.trim().toUpperCase(), international = country.length === 2 && country !== state.recipient.country;
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
    }
    open.addEventListener('click', () => perform(open, async () => {
      if (!panel.hidden) { panel.hidden = true; open.textContent = 'Generate shipping label'; return; }
      panel.hidden = false; open.textContent = 'Hide shipping label'; panel.replaceChildren(el('p', 'Loading shipping details…', 'uc-hint'));
      await render(await get());
    }));
  }
  window.PureShippingLabels = { mount };
})();
