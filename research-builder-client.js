/* Four-compound builder. A preview never creates a subscription or a payment. */
(() => {
  'use strict';
  const endpoint = '/api/customer-config?research_builder=1';
  const draftKey = 'ap-research-builder-v2';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
  const money = (cents,options = {}) => window.AltaLocale?.price ? window.AltaLocale.price(cents,{compact:true,...options}) : esc(new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents / 100));
  const currencyCode = () => window.AltaLocale?.currencyCode?.() || 'USD';
  const estimateNote = () => window.AltaLocale?.estimateNote?.() || 'Prices shown in USD. Your payment total is confirmed at checkout.';
  const modeOf = value => value === 'subscription' ? 'subscription' : 'one_time';

  function readDraft() {
    try {
      const value = JSON.parse(localStorage.getItem(draftKey) || '{}');
      return {mode:modeOf(value.mode), lines:Array.isArray(value.lines) ? value.lines.slice(0,4).map(line => ({id:line.id,size:line.size,qty:1})) : []};
    } catch { return {mode:'one_time',lines:[]}; }
  }

  async function request(body) {
    const headers = body ? {'Content-Type':'application/json'} : {};
    if (body && window.AltaWorkspace?.authClient) {
      try {
        const auth = await window.AltaWorkspace.authClient(),session = await auth.auth.getSession(),token = session.data?.session?.access_token;
        if (typeof token === 'string' && /^[A-Za-z0-9._~-]{20,8192}$/.test(token)) headers.Authorization = 'Bearer '+token;
      } catch { /* Public selection and pricing remain available without a session. */ }
    }
    const options = {method:body ? 'POST' : 'GET',cache:'no-store',headers,...(body ? {body:JSON.stringify(body)} : {})};
    let response = await fetch(endpoint,options);
    if (response.status === 401 && headers.Authorization) {delete headers.Authorization;response = await fetch(endpoint,options);}
    const data = await response.json();
    if (!response.ok) throw Error(data.error || 'AUTO-STACK™ could not be loaded. Please try again.');
    return data;
  }

  async function mount(root, options = {}) {
    if (!root) return;
    const store = options.store || window.AltaStore;
    const navigate = options.navigate || (href => location.assign(href));
    root.innerHTML = '<section class="nl-builder-loading ap-container"><p role="status">Loading AUTO-STACK™…</p></section>';
    let data;
    try {
      data = await request();
      if (!Array.isArray(data.catalog)) throw Error('The research catalog is temporarily unavailable.');
    } catch (error) {
      root.innerHTML = `<section class="nl-builder-loading ap-container"><h1><span class="nl-autostack-name">AUTO-STACK<sup>™</sup></span></h1><p role="alert">${esc(error.message)}</p><a class="ap-button" href="/research-builder">Try again</a></section>`;
      return;
    }
    const catalog = data.catalog.filter(product => product.category === 'injectables' && typeof product.id === 'string' && typeof product.name === 'string' && Array.isArray(product.variants) && product.variants.some(variant => typeof variant.size === 'string' && Number.isFinite(variant.price) && variant.price > 0));
    const product = id => catalog.find(item => item.id === id);
    const variant = (id,size) => product(id)?.variants.find(item => item.size === size && Number.isFinite(item.price) && item.price > 0);
    const draft = readDraft();
    const seen = new Set();
    let lines = draft.lines.filter(line => {
      if (seen.has(line.id) || !variant(line.id,line.size)) return false;
      seen.add(line.id);return true;
    });
    const queryMode = new URLSearchParams(location.search).get('mode');
    let mode = queryMode ? modeOf(queryMode) : draft.mode;
    let query = '', group = 'All', quote = null, quoteError = '', pending = false, serial = 0, adding = false;
    const sizes = Object.fromEntries(catalog.map(item => [item.id,lines.find(line => line.id === item.id)?.size || item.variants.find(item => Number.isFinite(item.price) && item.price > 0).size]));
    const groups = ['All',...new Set(catalog.map(item => item.group).filter(value => typeof value === 'string' && value.trim()))];
    const image = (item,size) => {
      const path = store?.image?.(store.product?.(item?.id) || item,size) || '/assets/research-vials-pure.webp';
      return typeof path === 'string' && (/^\/(?!\/)/.test(path) || /^https:\/\//.test(path)) ? path : '/assets/research-vials-pure.webp';
    };
    const persist = () => {try {localStorage.setItem(draftKey,JSON.stringify({mode,lines}));} catch {}};
    const quoteLines = () => lines.map(({id,size}) => ({id,size,qty:1}));
    const feedback = message => {const element = root.querySelector('.nl-builder-feedback');if (element) element.textContent = message;};
    const focusProduct = id => [...root.querySelectorAll('[data-rb-add]')].find(button => button.dataset.rbAdd === id)?.focus();
    const estimatedTotal = () => lines.reduce((sum,line) => {
      const cents = Math.round(variant(line.id,line.size).price * 100);
      return sum + cents - (mode === 'subscription' ? Math.floor(cents * 4000 / 10000) : 0);
    },0);

    root.innerHTML = `<section class="nl-builder-hero"><div class="ap-container"><span class="nl-capsule">PURE / YOUR COMPOUNDS. YOUR RESEARCH.</span><h1 class="nl-autostack-title"><span class="nl-autostack-name">AUTO-STACK<sup>™</sup></span></h1><p><strong>Your four-compound research set.</strong> Choose every compound and strength. Order once, or explore the monthly plan.</p><div class="nl-builder-mode" role="group" aria-label="AUTO-STACK™ purchase type"><button type="button" data-rb-mode="one_time">One-time order</button><button type="button" data-rb-mode="subscription">Monthly plan <span>40% off</span></button></div></div></section><section class="ap-container nl-builder-benefits" aria-label="AUTO-STACK™ details"></section><div class="ap-container nl-builder-layout"><section class="nl-builder-catalog" aria-label="Choose research compounds"><div class="nl-builder-toolbar"><label class="ap-sr" for="ap-builder-query">Search compounds</label><input id="ap-builder-query" type="search" maxlength="120" placeholder="Search compounds" autocomplete="off"></div><div class="nl-builder-categories" role="group" aria-label="Research categories"></div><p id="ap-builder-count" class="ap-result-count" role="status"></p><p class="nl-builder-currency-note">${estimateNote()}</p><div id="ap-builder-grid" class="ap-builder-grid"></div></section><aside class="ap-summary nl-builder-summary" aria-label="Your AUTO-STACK™"><div id="ap-builder-summary"></div><p class="nl-builder-feedback" role="status" aria-live="polite"></p></aside></div><a class="nl-builder-mobile-review" href="#ap-builder-summary" hidden></a>`;
    document.title = 'AUTO-STACK™ | PURE';

    function renderBenefits() {
      const monthly = mode === 'subscription';
      root.querySelectorAll('[data-rb-mode]').forEach(button => button.setAttribute('aria-pressed',String(button.dataset.rbMode === mode)));
      root.querySelector('.nl-builder-benefits').innerHTML = (monthly ? [
        ['40%','Off list price','Monthly plan preview'],
        ['BAC 3mL','Included in each delivery','Monthly plan benefit'],
        ['Free','US 2-Day Express shipping','Monthly plan benefit'],
        ['Cancel anytime','No delivery minimum','Edit future selections']
      ] : [
        ['4','Compounds in one set','One of each selected strength'],
        ['Your choice','Choose every compound','Built from the current catalog'],
        ['One payment','No automatic renewal','Member pricing applies at checkout'],
        ['COAs','Product documentation','Explore available batch reports']
      ]).map(([value,label,detail],index) => `<${!monthly && index === 3 ? 'a href="/coas"' : 'article'} class="nl-builder-benefit${!monthly && index === 3 ? ' nl-builder-benefit-coa' : ''}"><strong class="nl-builder-benefit-value">${esc(value)}</strong><span>${esc(label)}</span><small>${esc(detail)}${!monthly && index === 3 ? ' ↗' : ''}</small></${!monthly && index === 3 ? 'a' : 'article'}>`).join('');
    }

    function renderResults() {
      root.querySelector('.nl-builder-categories').innerHTML = groups.map(value => `<button type="button" data-rb-group="${esc(value)}" aria-pressed="${group === value}">${esc(value === 'All' ? 'All compounds' : value)}</button>`).join('');
      const list = catalog.filter(item => (group === 'All' || item.group === group) && `${item.name} ${item.group || ''}`.toLowerCase().includes(query.toLowerCase()));
      root.querySelector('#ap-builder-count').textContent = `${list.length} compound${list.length === 1 ? '' : 's'} · choose four different products`;
      root.querySelector('#ap-builder-grid').innerHTML = list.map(item => {
        const size = sizes[item.id], selected = lines.some(line => line.id === item.id), cents = Math.round(variant(item.id,size).price * 100), currentPrice = cents - (mode === 'subscription' ? Math.floor(cents * 4000 / 10000) : 0);
        return `<article class="nl-builder-product" data-rb-product="${esc(item.id)}"><a class="ap-product-image" href="/product/${encodeURIComponent(item.id)}?size=${encodeURIComponent(size)}" aria-label="View ${esc(item.name)}"><img src="${esc(image(item,size))}" alt="${esc(item.name+' '+size+' product packaging')}" loading="lazy"></a><div class="ap-product-body"><h3><a href="/product/${encodeURIComponent(item.id)}">${esc(item.name)}</a></h3><div class="ap-size-options" role="group" aria-label="${esc(item.name)} strength">${item.variants.filter(value => Number.isFinite(value.price) && value.price > 0).map(value => `<button type="button" data-rb-size="${esc(value.size)}" data-rb-id="${esc(item.id)}" aria-pressed="${value.size === size}">${esc(value.size)}</button>`).join('')}</div><p class="ap-product-price">${money(currentPrice,{showCode:false})}${mode === 'subscription' ? `<del>${money(cents,{showCode:false})}</del><small>${currencyCode()} · monthly plan preview</small>` : `<small>${currencyCode()} · one vial</small>`}</p><div class="ap-product-actions"><button class="ap-add" type="button" data-rb-add="${esc(item.id)}" data-selected="${selected}" aria-pressed="${selected}" aria-label="${selected ? 'Remove' : 'Add'} ${esc(item.name)} ${selected ? 'from' : 'to'} your set" ${!selected && lines.length === 4 ? 'disabled' : ''}>${selected ? 'Selected ✓' : 'Add to set +'}</button></div></div></article>`;
      }).join('') || '<p class="nl-builder-empty">No compounds match that search. Try another name or category.</p>';
    }

    function renderSummary() {
      const monthly = mode === 'subscription', full = lines.length === 4;
      const retail = lines.reduce((sum,line) => sum + Math.round(variant(line.id,line.size).price * 100),0);
      const total = quote?.total_cents ?? estimatedTotal();
      const discount = quote?.discount_cents ?? (retail - estimatedTotal());
      const memberSavings = !monthly && Number.isSafeInteger(quote?.membership_discount_cents) && quote.membership_discount_cents > 0 ? quote.membership_discount_cents : 0;
      const live = full && quote && !pending && !quoteError;
      const oneTimeAvailable = data.one_time_available === true && quote?.one_time_available !== false;
      const mobileReview = root.querySelector('.nl-builder-mobile-review');
      if (mobileReview) {mobileReview.hidden = lines.length === 0;mobileReview.innerHTML = `Review your set <span>${lines.length} / 4 selected <span aria-hidden="true">↗</span></span>`;}
      const slots = Array.from({length:4},(_,index) => {
        const line = lines[index],item = line && product(line.id);
        return `<div class="nl-builder-slot${line ? ' is-selected' : ''}"><span class="nl-slot-number">${index + 1}</span>${line ? `<img src="${esc(image(item,line.size))}" alt=""><span class="nl-builder-slot-copy"><strong>${esc(item.name)}</strong><small>${esc(line.size)} · Qty 1</small></span><button type="button" data-rb-remove="${esc(line.id)}" aria-label="Remove ${esc(item.name)}">×</button>` : `<span class="nl-builder-slot-copy"><strong>${index === lines.length ? 'Choose your next compound' : 'Empty slot'}</strong></span>`}</div>`;
      }).join('');
      root.querySelector('#ap-builder-summary').innerHTML = `<div class="nl-builder-summary-heading"><h2>Your <span class="nl-autostack-name">AUTO-STACK<sup>™</sup></span></h2><span class="nl-builder-selected">${lines.length} of 4 selected</span></div><div class="nl-builder-slots">${slots}</div>${monthly ? '<div class="nl-bundle-line"><span class="nl-bundle-image" aria-hidden="true">＋</span><span><strong>BAC Water 3mL</strong><small>Included in the monthly plan</small></span><span><b>Included</b></span></div>' : ''}<div class="nl-price-list"><div><span>Product subtotal</span><span>${money(quote?.subtotal_cents ?? retail)}</span></div>${monthly ? `<div class="nl-builder-savings"><span>Monthly plan discount · 40%</span><strong>−${money(discount)}</strong></div><div class="nl-builder-shipping"><span>US 2-Day Express shipping</span><strong>Included</strong></div>` : `${memberSavings ? `<div><span>${esc(quote.membership_name || 'Member')} savings</span><strong>−${money(memberSavings)}</strong></div>` : ''}<div><span>${memberSavings ? 'Delivery' : 'Member savings and delivery'}</span><span>At checkout</span></div>`}<div class="nl-price-total"><span>${monthly ? 'Monthly preview' : 'Set subtotal'}</span><strong>${pending ? '…' : money(total,{showCode:false})}<small>${currencyCode()}${monthly ? ' / month · not enrolled' : memberSavings ? ' · member savings applied' : ' · before checkout savings'}</small></strong></div></div>${monthly ? '<p class="nl-builder-availability">Automatic monthly billing is not connected yet. This is a price preview. No subscription, charge or delivery is scheduled.</p>' : ''}${quoteError ? `<p class="nl-builder-availability" role="alert">${esc(quoteError)}</p>` : ''}<div class="ap-summary-actions">${monthly ? `<button type="button" class="ap-button" data-rb-review ${!live ? 'disabled' : ''}>${full ? pending ? 'Checking your selection…' : 'Review monthly preview' : `Choose ${4 - lines.length} more`}</button><button type="button" class="ap-button ap-button-secondary" data-rb-one-time>Order this set once</button>` : `<button type="button" class="ap-button" data-rb-checkout ${!live || !oneTimeAvailable || adding ? 'disabled' : ''}>${!full ? `Choose ${4 - lines.length} more` : pending ? 'Checking your selection…' : adding ? 'Adding to your cart…' : 'Add set & checkout'}</button>`}</div><p class="nl-builder-terms">${monthly ? 'Planned monthly terms: ongoing until canceled, with no minimum deliveries. Edit future selections or cancel anytime. Enrollment requires connected recurring billing and your approval.' : 'Your set is added to your existing cart. Current prices, eligible member savings, shipping and your final payment total are confirmed at checkout. The monthly 40% offer and bundled extras do not apply to one-time sets.'}</p><div class="nl-builder-secondary-actions"><button type="button" data-rb-clear ${lines.length ? '' : 'disabled'}>Clear selections</button><a href="/account/subscriptions">Your research plans</a></div>`;
    }

    async function updateQuote() {
      const generation = ++serial;
      quote = null;quoteError = '';pending = lines.length === 4;
      renderSummary();
      if (!pending) return;
      try {
        const result = await request({action:'quote',items:quoteLines(),mode});
        if (generation !== serial) return;
        if (!Array.isArray(result.lines) || result.lines.length !== 4 || !Number.isSafeInteger(result.total_cents) || result.total_cents < 1 || result.currency !== 'USD') throw Error('The selection could not be priced. Please review your compounds.');
        quote = result;
      } catch (error) {if (generation === serial) quoteError = error.message;}
      finally {if (generation === serial) {pending = false;renderSummary();}}
    }

    function changeMode(next) {
      mode = modeOf(next);persist();renderBenefits();renderResults();updateQuote();
    }

    async function addToCheckout() {
      if (adding || pending || mode !== 'one_time' || lines.length !== 4 || !quote || quoteError || data.one_time_available !== true || quote.one_time_available === false) return;
      if (!store?.addItems) {feedback('Your cart could not be loaded. Please refresh before continuing.');return;}
      adding = true;renderSummary();
      try {
        store.addItems(quoteLines());
        navigate('/checkout');
      } catch (error) {adding = false;renderSummary();feedback(error.message || 'Your set could not be added to the cart.');}
    }

    root.querySelector('#ap-builder-query').addEventListener('input',event => {query = event.target.value.slice(0,120);renderResults();});
    root.addEventListener('click',event => {
      const control = event.target.closest('button');
      if (!control || !root.contains(control) || control.disabled) return;
      if (control.dataset.rbMode) {changeMode(control.dataset.rbMode);return;}
      if (control.hasAttribute('data-rb-one-time')) {changeMode('one_time');return;}
      if (control.dataset.rbGroup) {group = control.dataset.rbGroup;renderResults();[...root.querySelectorAll('[data-rb-group]')].find(button => button.dataset.rbGroup === group)?.focus();return;}
      if (control.dataset.rbSize) {
        const id = control.dataset.rbId,size = control.dataset.rbSize;
        if (!variant(id,size)) return;
        sizes[id] = size;
        if (lines.some(line => line.id === id)) {lines = lines.map(line => line.id === id ? {...line,size} : line);persist();updateQuote();}
        renderResults();
        root.querySelectorAll('[data-rb-size]').forEach(button => {if (button.dataset.rbId === id && button.dataset.rbSize === size) button.focus();});
        return;
      }
      if (control.dataset.rbAdd) {
        const id = control.dataset.rbAdd;
        if (lines.some(line => line.id === id)) {lines = lines.filter(line => line.id !== id);persist();renderResults();updateQuote();focusProduct(id);feedback(`${product(id).name} removed. ${lines.length} of 4 compounds selected.`);return;}
        if (lines.length >= 4 || !variant(id,sizes[id])) return;
        lines = [...lines,{id,size:sizes[id],qty:1}];persist();renderResults();updateQuote();focusProduct(id);feedback(`${product(id).name} added. ${lines.length} of 4 compounds selected.`);return;
      }
      if (control.dataset.rbRemove) {
        const id = control.dataset.rbRemove;
        lines = lines.filter(line => line.id !== id);persist();renderResults();updateQuote();focusProduct(id);feedback('Compound removed from your set.');return;
      }
      if (control.hasAttribute('data-rb-clear')) {lines = [];persist();renderResults();updateQuote();root.querySelector('#ap-builder-query').focus();feedback('Your selections have been cleared.');return;}
      if (control.hasAttribute('data-rb-checkout')) {addToCheckout();return;}
      if (control.hasAttribute('data-rb-review') && quote && !pending && !quoteError && mode === 'subscription') navigate('/research-checkout');
    });
    persist();renderBenefits();renderResults();await updateQuote();
  }

  window.PureResearchBuilder = {mount,readDraft};
  if (/^\/research-builder(?:\.html)?\/?$/.test(location.pathname)) mount(document.getElementById('ap-main'));
})();
