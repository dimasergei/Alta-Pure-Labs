/* Shared PURE membership presentation. Prices and entitlements come from the server-aligned configuration. */
(() => {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
  const money = cents => new Intl.NumberFormat('en-US', {style:'currency', currency:'USD'}).format(cents / 100);
  const price = cents => window.AltaLocale?.price ? window.AltaLocale.price(cents,{showCode:false}) : esc(money(cents));
  const names = {member:'MEMBER', vip:'PURE WHITE', elite:'PURE BLACK'};
  const displayName = id => names[id] || 'MEMBER';
  const billingMode = config => config?.billing_mode === 'automatic_recurring' && config?.recurring_available === true ? 'automatic_recurring' : 'prepaid';
  const paidTerm = period => period === 'annual' ? 'one year' : 'one month';

  function benefits(config, id) {
    const plan = config?.plans?.[id] || {};
    const rows = [];
    if (plan.discount_bps > 0) rows.push({strong:true, text:`${plan.discount_bps / 100}% off eligible merchandise`});
    if (plan.points_per_dollar > 0) rows.push({text:`${plan.points_per_dollar} points per eligible $1 spent`});
    if (plan.free_shipping) rows.push({text:plan.shipping_label || config.membership_shipping_label || 'Free US shipping on eligible orders'});
    if (['vip','elite'].includes(id)) rows.push({strong:true,text:id==='vip'?'Member Stack: choose four compounds with 20% off, included BAC Water and US standard shipping':'Member Stack: choose four compounds with 40% off, included BAC Water and US express shipping'});
    if (plan.early_access) rows.push({text:'Early access to eligible new releases'});
    if (plan.priority_fulfillment) rows.push({text:'Priority order fulfillment'});
    if (plan.monthly_credit_cents > 0) rows.push({text:`${money(plan.monthly_credit_cents).replace('.00','')} monthly credit after a qualifying $150+ order`, creditTerms:true});
    if (plan.free_bac_water_3ml) rows.push({text:'BAC Water 3mL with each eligible product order'});
    if (id === 'member') {
      rows.push({text:'Order history and shipment tracking'});
      rows.push({text:'Points and store credit in your account'});
    }
    return rows;
  }

  function renderCards(config, period = 'monthly', options = {}) {
    period = period === 'annual' ? 'annual' : 'monthly';
    const active = options.active || null, pending = options.pending || null;
    const recurring = billingMode(config) === 'automatic_recurring';
    const enabled = config?.memberships_enabled === true;
    return `<div class="mx-grid">${['member','vip','elite'].filter(id => config?.plans?.[id]).map(id => {
      const plan = config.plans[id], free = id === 'member', current = active?.plan === id || (!active && free && options.context === 'account');
      const fee = plan[`${period}_cents`];
      const payable = enabled && Number.isSafeInteger(fee) && fee > 0;
      const tier = id === 'vip' ? 'white' : id === 'elite' ? 'black' : 'member';
      const badge = current ? 'YOUR CURRENT TIER' : pending?.plan === id ? pending.expired || pending.requires_review ? 'NEEDS ATTENTION' : 'AWAITING PAYMENT' : id === 'vip' ? 'EVERYDAY ADVANTAGE' : id === 'elite' ? 'THE COMPLETE MEMBERSHIP' : 'YOUR STARTING POINT';
      let action;
      if (free) action = `<a class="mx-choose mx-choose-secondary" href="${options.context === 'account' ? '/shop' : '/account/signup'}">${options.context === 'account' ? 'Explore the catalog' : 'Create a free account'}<span aria-hidden="true">↗</span></a>`;
      else if (active) action = `<p class="mx-current-note">${current ? 'Your benefits are active.' : 'Choose a new tier after your current paid term ends.'}</p>`;
      else if (pending) action = `<p class="mx-current-note">${pending.expired || pending.requires_review ? 'Review your saved membership order before choosing another tier.' : pending.plan === id ? 'Your membership starts after payment is confirmed.' : 'Finish your pending membership purchase before choosing another tier.'}</p>`;
      else if (payable) action = `<a class="mx-choose" href="/checkout?plan=${id}&period=${period}">Choose ${displayName(id)}<span aria-hidden="true">↗</span></a>`;
      else action = '<button class="mx-choose" type="button" disabled>Enrollment unavailable</button>';
      return `<article class="mx-card mx-card-${tier} mx-card-${id}" data-membership-tier="${id}"${current ? ' aria-label="'+displayName(id)+', current tier"' : ''}>
        <div class="mx-card-top"><span class="mx-tier-label">${badge}</span><span class="mx-tier-index" aria-hidden="true">0${['member','vip','elite'].indexOf(id) + 1}</span></div>
        <h3>${displayName(id)}</h3>
        <p class="mx-description">${free ? 'A place for every research order.' : id === 'vip' ? 'More value in your regular research routine.' : 'Our highest level of savings and account benefits.'}</p>
        <div class="mx-price">${free ? 'Free' : Number.isSafeInteger(fee) ? price(fee) : '—'}${free ? '' : `<span class="mx-price-period">/ ${period === 'annual' ? 'year' : 'month'}</span>`}</div>
        <p class="mx-billing-note">${free ? 'No membership fee.' : recurring ? `Renews ${period === 'annual' ? 'annually' : 'monthly'} until canceled.` : `${period === 'annual' ? '12-month' : 'Monthly'} access · pay each term separately.`}</p>
        ${action}
        <ul class="mx-features">${benefits(config,id).map(row => `<li${row.strong ? ' class="mx-feature-emphasis"' : ''}><span class="mx-check" aria-hidden="true">✓</span><span>${esc(row.text)}${row.creditTerms ? '<a class="mx-benefit-footnote" href="/membership-terms.html#pure-black-credit" aria-label="Read the PURE BLACK monthly credit terms"><span aria-hidden="true">†</span></a>' : ''}</span></li>`).join('')}</ul>
      </article>`;
    }).join('')}</div>`;
  }

  function terms(config) {
    const recurring = billingMode(config) === 'automatic_recurring';
    return `${recurring ? 'Recurring billing terms are shown before payment.' : 'Memberships are purchased by the month or year.'} Benefits begin after payment is confirmed. Merchandise discounts, reward eligibility and credit terms are shown at checkout. Membership fees do not earn points.`;
  }

  function toggle(period) {
    return `<div class="mx-billing" role="group" aria-label="Membership billing period"><button type="button" data-mx-period="monthly" aria-pressed="${period === 'monthly'}">Monthly</button><button type="button" data-mx-period="annual" aria-pressed="${period === 'annual'}">Annual <span>Save 20%</span></button></div>`;
  }

  function faq(config) {
    const recurring = billingMode(config) === 'automatic_recurring';
    const answers = [
      ['When do my benefits start?', 'Your benefits begin when your membership payment is confirmed. Sign in to the same account at checkout so your tier, eligible discount and rewards can be applied.'],
      ['How does monthly or annual billing work?', recurring ? 'Choose monthly or annual recurring billing. The exact price, renewal schedule and cancellation terms are shown before payment and in your account.' : 'Choose monthly or annual access, and pay a new invoice when the term ends. Annual access costs approximately 20% less than twelve monthly payments.'],
      ['How does the PURE BLACK monthly credit work?', 'After a qualifying paid product order with at least $150 of eligible merchandise after discounts, $50 is added to your account for a future order. It is issued once per UTC calendar month. Points and store credit do not reduce that qualifying merchandise amount.'],
      ['Can I buy a membership with my product order?', 'Membership checkout is a separate purchase. Your product cart is saved, and you can return to it after membership payment is confirmed. Eligible member benefits then apply to your order.'],
      ['What happens when my paid term ends?', 'Your account, order history and existing reward balances remain available. Paid tier benefits end with the membership term. You can choose another membership from your account.']
    ];
    return `<section class="mx-faq" aria-labelledby="mx-faq-heading"><div><span class="mx-kicker">THE DETAILS</span><h2 id="mx-faq-heading">Membership,<br>made clear.</h2><a href="/membership-terms.html">Read membership terms <span aria-hidden="true">↗</span></a></div><div class="mx-faq-list">${answers.map(([question,answer]) => `<details><summary>${esc(question)}<span aria-hidden="true">+</span></summary><p>${esc(answer)}</p></details>`).join('')}</div></section>`;
  }

  function mount(root, config, options = {}) {
    if (!root || !config?.plans) return;
    let period = options.period === 'annual' ? 'annual' : 'monthly';
    const render = focus => {
      root.innerHTML = `<div class="mx-comparison">${toggle(period)}${renderCards(config,period,options)}<p class="mx-terms"><a href="/membership-terms.html">See full terms.</a></p></div>`;
      root.querySelectorAll('[data-mx-period]').forEach(button => button.addEventListener('click',() => {period = button.dataset.mxPeriod; render(true);}));
      if (focus) root.querySelector(`[data-mx-period="${period}"]`)?.focus();
    };
    render(false);
  }

  function page(root, config, embedded) {
    root.innerHTML = `<section class="mx-membership-page${embedded ? ' mx-membership-embedded' : ''}" aria-labelledby="mx-title"><header class="mx-intro"><div><span class="mx-kicker">PURE MEMBERSHIPS</span><${embedded ? 'h2' : 'h1'} id="mx-title">MORE FROM<br>EVERY ORDER.</${embedded ? 'h2' : 'h1'}></div><div class="mx-intro-copy"><p>A clear choice for your research routine. Choose the tier that fits, with eligible savings and benefits linked to your account.</p>${embedded ? '<a href="/memberships">Explore memberships <span aria-hidden="true">↗</span></a>' : '<span class="mx-intro-detail">THREE TIERS. ONE PURE STANDARD.</span>'}</div></header><div data-mx-comparison></div>${embedded ? '' : faq(config)}</section>`;
    mount(root.querySelector('[data-mx-comparison]'),config);
  }

  window.PureMemberships = {displayName, benefits, billingMode, renderCards, mount, page, terms, paidTerm};
  function boot() {
    const path = location.pathname.replace(/\/+$/,'').replace(/\.html$/,'') || '/';
    const fullPage = path === '/memberships', homePage = path === '/' || path === '/index';
    const config = window.AltaConversionConfig, main = document.getElementById('ap-main');
    if ((!fullPage && !homePage) || !config?.plans || !main) return;
    const render = () => {
      const root = fullPage ? main : main.querySelector('[data-mx-membership-home]');
      if (root && !root.querySelector('.mx-membership-page')) page(root,config,!fullPage);
    };
    render();
    if (fullPage) document.title = 'PURE Memberships | PURE';
    if (homePage) new MutationObserver(render).observe(main,{childList:true,subtree:true});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();
})();
