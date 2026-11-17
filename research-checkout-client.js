/* Dedicated Research Builder review. The regular cart and its promotions are never read or changed. */
window.ResearchCheckout = (() => {
  'use strict';
  const money = cents => new Intl.NumberFormat('en-US', {style:'currency',currency:'USD'}).format(cents / 100);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  function selections() {
    try {
      const draft = JSON.parse(localStorage.getItem('ap-research-builder-v2') || '{}');
      return Array.isArray(draft.lines) ? draft.lines.map(({id,size,qty})=>({id,size,qty})) : [];
    } catch { return []; }
  }
  async function render(root, user) {
    document.title = 'Research Builder Checkout | PURE';
    const lines = selections();
    root.innerHTML = '<a class="rc-back" href="/research-builder">‹ Back to Research Builder</a><h1>Start your Research Builder</h1><p class="rc-intro">Four compounds, billed monthly at 40% off. BAC Water 3ML and 2-Day Express Shipping are included in every delivery.</p><p class="rc-loading" role="status">Checking current prices…</p>';
    if (lines.length !== 4) {
      root.querySelector('.rc-loading').textContent = 'Select four different compounds before continuing.';
      return;
    }
    try {
      const response = await fetch('/api/customer-config?research_builder=1', {method:'POST',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'quote',lines})});
      const quote = await response.json();
      if (!response.ok || !Array.isArray(quote.lines) || quote.lines.length !== 4) throw Error(quote.error || 'This selection needs to be reviewed again.');
      root.querySelector('.rc-loading').remove();
      const total = money(quote.monthly_cents);
      root.insertAdjacentHTML('beforeend', `<div class="rc-layout"><section class="rc-form"><div class="rc-panel rc-plan"><span class="rc-kicker">RESEARCH BUILDER · MONTHLY</span><h2>Your monthly delivery</h2>${quote.lines.map(line=>`<div class="rc-line"><span>${escape(line.name)} · ${escape(line.size)}</span><span><del>${money(line.retail_cents)}</del> <strong>${money(line.monthly_cents)}</strong></span></div>`).join('')}<div class="rc-line"><span>BAC Water 3ML</span><strong>Bundled</strong></div><div class="rc-line"><span>2-Day Express Shipping</span><strong>Free</strong></div><div class="rc-due"><span>Every month</span><strong>${total}</strong></div><p>Three monthly deliveries to start. You can change compounds after your first delivery ships and cancel after the third delivery. Future monthly charges continue until you cancel.</p></div><div class="rc-panel"><h2>Contact and delivery</h2><p>Signed in as <strong>${escape(user.email)}</strong></p><form class="rc-address"><label>Full name<input autocomplete="name" name="name" maxlength="120" required></label><label>Address<input autocomplete="address-line1" name="line1" maxlength="180" required></label><label>Apartment or suite<input autocomplete="address-line2" name="line2" maxlength="120"></label><div class="rc-field-row"><label>City<input autocomplete="address-level2" name="city" maxlength="100" required></label><label>State<input autocomplete="address-level1" name="state" maxlength="80" required></label><label>ZIP code<input autocomplete="postal-code" name="postal" maxlength="20" required></label></div><label>Country<select name="country"><option value="US">United States</option></select></label></form></div><div class="rc-panel"><h2>Payment</h2><p class="rc-unavailable" role="status">Recurring checkout is being connected. No payment can be submitted and no subscription or delivery is scheduled yet.</p><button type="button" class="rc-pay" disabled aria-disabled="true">Start monthly plan · ${total}</button><p class="rc-small">Payment will be charged only after a recurring payment method is connected and the server confirms the exact monthly amount. Your regular cart stays separate.</p></div></section><aside class="rc-panel rc-summary"><h2>Order summary</h2><p>4 research compounds · one monthly delivery</p><div class="rc-row"><span>Retail value</span><del>${money(quote.retail_cents)}</del></div><div class="rc-row rc-saving"><span>Builder discount (40% off)</span><strong>−${money(quote.discount_cents)}</strong></div><div class="rc-row rc-saving"><span>BAC Water 3ML</span><strong>Bundled</strong></div><div class="rc-row rc-saving"><span>2-Day Express Shipping</span><strong>Free</strong></div><div class="rc-row rc-total"><span>Per month</span><strong>${total}/mo</strong></div><p class="rc-small">This quote is recalculated from the current catalog on the server. Taxes or future payment fees, if applicable, must be disclosed before enrollment.</p></aside></div>`);
    } catch (error) { root.querySelector('.rc-loading').textContent = error.message || 'Unable to check this selection. Please try again.'; }
  }
  return {render};
})();
