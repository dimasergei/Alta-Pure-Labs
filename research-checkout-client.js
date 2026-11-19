/* AUTO-STACK monthly checkout: each invoice is paid explicitly, never automatically. */
window.ResearchCheckout = (() => {
  'use strict';
  const money = (cents,options = {}) => window.AltaLocale?.price ? window.AltaLocale.price(cents,{compact:true,...options}) : esc(new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents / 100));
  const currencyCode = () => window.AltaLocale?.currencyCode?.() || 'USD';
  const estimateNote = () => window.AltaLocale?.estimateNote?.() || 'Prices shown in USD. Your payment total is confirmed at checkout.';
  const esc = value => String(value ?? '').replace(/[&<>"']/g,character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
  function selections() {
    try {
      const draft = JSON.parse(localStorage.getItem('ap-research-builder-v2') || '{}');
      return {mode:draft.mode === 'subscription' ? 'subscription' : 'one_time',items:Array.isArray(draft.lines) ? draft.lines.map(line => ({id:line.id,size:line.size,qty:1})) : [],plan_id:typeof draft.plan_id==='string'?draft.plan_id:null};
    } catch {return {mode:'one_time',items:[]};}
  }
  async function render(root,user,options = {}) {
    if (!root) return;
    if (root.matches('main#ap-main')) {
      root.innerHTML = '<div class="rc-public-page"><div class="rc-public-shell"></div></div>';
      root = root.querySelector('.rc-public-shell');
    }
    document.title = 'AUTO-STACK™ Review | PURE';
    const draft = selections(),monthly = draft.mode === 'subscription',store = options.store || window.AltaStore;
    const navigate = options.navigate || (href => location.assign(href));
    root.innerHTML = `<a class="rc-back" href="/research-builder?mode=${draft.mode}">← Back to AUTO-STACK™</a><header class="rc-heading"><span class="rc-kicker">${monthly ? 'MONTHLY INVOICE' : 'ONE-TIME RESEARCH SET'}</span><h1 class="rc-autostack-title"><span class="rc-title-prefix">REVIEW YOUR</span> <span class="rc-autostack-name">AUTO-STACK<sup>™</sup></span></h1><p class="rc-intro">${monthly ? 'Your four selections, with the monthly plan benefits shown below.' : 'One of each selected compound, ready for your regular checkout.'}</p></header><p class="rc-currency-note">${estimateNote()}</p><p class="rc-loading" role="status">Checking current prices…</p>`;
    if (draft.items.length !== 4 || new Set(draft.items.map(line => line.id)).size !== 4) {
      root.querySelector('.rc-loading').textContent = 'Choose four different compounds in AUTO-STACK™ before continuing.';
      return;
    }
    try {
      const headers = {'Content-Type':'application/json'};
      try {
        const auth = options.auth || await window.AltaWorkspace?.authClient?.(),session = await auth?.auth?.getSession?.(),token = session?.data?.session?.access_token;
        if (typeof token === 'string' && /^[A-Za-z0-9._~-]{20,8192}$/.test(token)) headers.Authorization = 'Bearer '+token;
      } catch { /* Signed-out visitors can still review the public price. */ }
      const request = {method:'POST',cache:'no-store',headers,body:JSON.stringify({action:'quote',items:draft.items,mode:draft.mode})};
      let response = await fetch('/api/customer-config?research_builder=1',request);
      if (response.status === 401 && headers.Authorization) {delete headers.Authorization;response = await fetch('/api/customer-config?research_builder=1',request);}
      const quote = await response.json();
      if (!response.ok || !Array.isArray(quote.lines) || quote.lines.length !== 4 || !Number.isSafeInteger(quote.total_cents) || !Number.isSafeInteger(quote.subtotal_cents) || !Number.isSafeInteger(quote.discount_cents) || quote.total_cents < 1 || quote.currency !== 'USD') throw Error(quote.error || 'Please review this selection in AUTO-STACK™.');
      const memberSavings = !monthly && Number.isSafeInteger(quote.membership_discount_cents) && quote.membership_discount_cents > 0 ? quote.membership_discount_cents : 0;
      root.querySelector('.rc-loading').remove();
      root.insertAdjacentHTML('beforeend',`<div class="rc-layout"><section class="rc-form"><section class="rc-panel rc-plan"><div class="rc-panel-heading"><span class="rc-kicker">YOUR FOUR COMPOUNDS</span><span class="rc-count">4 / 4</span></div><div class="rc-lines">${quote.lines.map((line,index) => {
        const retail = line.gross_cents ?? line.retail_cents ?? line.subtotal_cents ?? line.unit_price_cents ?? line.unit_cents;
        const price = line.line_total_cents ?? (monthly ? line.monthly_cents ?? line.total_cents : line.total_cents ?? line.retail_cents ?? line.unit_price_cents ?? line.unit_cents);
        return `<div class="rc-line"><span class="rc-number">0${index+1}</span><span class="rc-line-copy"><strong>${esc(line.name)}</strong><small>${esc(line.size)} · Qty 1</small></span><span class="rc-line-price">${Number.isSafeInteger(price) ? money(price) : ''}${monthly && Number.isSafeInteger(retail) && retail > price ? `<del>${money(retail)}</del>` : ''}</span></div>`;
      }).join('')}</div>${monthly ? '<div class="rc-inclusions"><div><span>BAC Water 3mL</span><strong>Included</strong></div><div><span>US 2-Day Express shipping</span><strong>Included</strong></div></div>' : ''}<a class="rc-edit" href="/research-builder?mode=${draft.mode}">Edit your selections <span aria-hidden="true">↗</span></a></section><section class="rc-panel rc-terms"><span class="rc-kicker">${monthly ? 'PLAN DETAILS' : 'CHECKOUT DETAILS'}</span><h2>${monthly ? 'Monthly invoice terms' : 'One set. One payment.'}</h2>${monthly ? '<ol><li><strong>Monthly until canceled.</strong> This monthly invoice includes four compounds at 40% off, BAC Water 3mL and US 2-Day Express shipping; no minimum deliveries.</li><li><strong>Edit future selections anytime.</strong> Choose different compounds for future paid months at any time.</li><li><strong>Cancel anytime.</strong> Cancel anytime to close your plan; each new month requires a separate paid invoice.</li></ol>' : '<p>The set is added to your existing cart. Eligible membership savings and your delivery and payment options are shown during normal checkout.</p><p>The monthly 40% discount, bundled BAC and plan delivery benefits apply to the monthly plan. Your one-time order uses regular or eligible member pricing.</p>'}</section></section><aside class="rc-panel rc-summary"><span class="rc-kicker">${monthly ? 'MONTHLY CHECKOUT' : 'ORDER SUMMARY'}</span><h2>Your <span class="rc-autostack-name">AUTO-STACK<sup>™</sup></span></h2><div class="rc-row"><span>Product subtotal</span><span>${money(quote.subtotal_cents)}</span></div>${monthly ? `<div class="rc-row"><span>Monthly plan savings · 40%</span><strong>−${money(quote.discount_cents)}</strong></div><div class="rc-row"><span>BAC Water 3mL</span><strong>Included</strong></div><div class="rc-row"><span>US 2-Day Express shipping</span><strong>Included</strong></div>` : `${memberSavings ? `<div class="rc-row"><span>${esc(quote.membership_name || 'Member')} savings</span><strong>−${money(memberSavings)}</strong></div>` : ''}<div class="rc-row"><span>${memberSavings ? 'Delivery' : 'Member savings and delivery'}</span><span>At checkout</span></div>`}<div class="rc-due"><span>${monthly ? 'Plan price' : 'Set subtotal'}</span><strong>${money(quote.total_cents,{showCode:false})}<small>${currencyCode()}${monthly ? ' / month' : ''}</small></strong></div>${monthly ? '<p class="rc-small">This payment covers one month. Pay another invoice for each new month; no automatic charge is made.</p><a class="rc-pay" href="/checkout?stack=monthly'+(draft.plan_id?'&stack_plan='+encodeURIComponent(draft.plan_id):'')+'">Continue to secure checkout ↗</a><a class="rc-secondary" href="/research-builder?mode=one_time">Order this set once <span aria-hidden="true">↗</span></a>' : quote.one_time_available === true && store?.addItems ? '<button type="button" class="rc-pay" data-rc-checkout>Add set & checkout <span aria-hidden="true">↗</span></button><p class="rc-small">Your existing cart is preserved. Your final total is confirmed at checkout before payment.</p>' : '<p class="rc-unavailable" role="status">Open AUTO-STACK™ to add your set to the cart.</p><a class="rc-secondary" href="/research-builder?mode=one_time">Return to AUTO-STACK™ ↗</a>'}<p class="rc-feedback" role="status" aria-live="polite"></p>${user?.email ? `<p class="rc-account">Signed in as <strong>${esc(user.email)}</strong></p>` : ''}</aside></div>`);
      const button = root.querySelector('[data-rc-checkout]');
      if (button) button.addEventListener('click',() => {
        if (button.disabled || monthly) return;
        button.disabled = true;button.textContent = 'Adding to your cart…';
        try {store.addItems(draft.items);navigate('/checkout');}
        catch (error) {button.disabled = false;button.textContent = 'Add set & checkout';root.querySelector('.rc-feedback').textContent = error.message || 'Your set could not be added to the cart.';}
      });
    } catch (error) {
      const loading = root.querySelector('.rc-loading');
      if (loading) {loading.setAttribute('role','alert');loading.textContent = error.message || 'Unable to check your selection. Please try again.';}
    }
  }
  return {render,selections};
})();
