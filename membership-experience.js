/* AltaPure membership comparison. Prices/benefits read from server-aligned config. */
(()=>{
'use strict';
const fullPage=/^\/memberships\/?$/.test(location.pathname),homePage=location.pathname==='/';
if(!fullPage&&!homePage)return;
const plans=window.AltaConversionConfig?.plans,main=document.getElementById('ap-main');
if(!plans||!main)return;
const target=()=>fullPage?main:main.querySelector('[data-mx-membership-home]');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const usd=c=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(c/100);
const displayName=id=>id==='vip'?'ALTA GOLD':id==='elite'?'ALTA PLATINUM':'Member';
const membershipIcon='<svg class="mx-membership-icon" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+
 '<path d="M18 42 7 57l11-1 2 7 11-13M46 42l11 15-11-1-2 7-11-13"/>'+
 '<path d="M21 10c4 2 6-3 11-3s7 5 11 3c4-2 5 4 9 6s-1 7 0 12c1 5 4 7 0 11-3 4-7 3-9 7-3 4-7 0-11 0s-8 4-11 0c-2-4-6-3-9-7-4-4-1-6 0-11 1-5-4-10 0-12s5-8 9-6Z"/>'+
 '<circle cx="32" cy="28" r="16"/><path d="M19 29a13 13 0 0 1 26 0"/>'+
 '<ellipse cx="32" cy="26" rx="5" ry="6"/><path d="M20 38c2-6 7-9 12-9s10 3 12 9"/>'+
 '<path d="m8 3 2 5 5 2-5 2-2 5-2-5-5-2 5-2 2-5Zm47 1 2 5 5 2-5 2-2 5-2-5-5-2 5-2 2-5ZM32 51l2 4 4 2-4 2-2 4-2-4-4-2 4-2 2-4Z"/>'+
 '</svg>';
let period='monthly';
const faq=[
 ['Can I cancel at any time?','Paid memberships are prepaid for one month or one year, with no automatic renewal or future recurring charge. Refund requests during a prepaid term follow the published refund policy.'],
 ['Does my discount change based on monthly vs. annual billing?','No. Your tier benefits remain the same. Annual pricing saves 20% compared with purchasing twelve individual monthly terms.'],
 ['Does the discount apply to sale items?','For each eligible product line, the better offer among BOGO, membership and volume pricing applies. Those offers do not stack with one another on the same item. Eligible coupons and bank-transfer savings are calculated separately.'],
 ['Can I buy a membership together with other products?','Memberships must be purchased separately. Your existing cart remains saved; after payment is confirmed and the membership appears on your account, return to checkout for eligible benefits.'],
 ['What happens if I let my membership lapse?','Your account returns to the free Member tier when the prepaid term expires. Order history and eligible points remain accessible, while paid-tier discounts and free standard US delivery stop. You can purchase a new term when your previous one has ended.']
];
const features=id=>{
 const p=plans[id];
 const entries=[
  [true,p.points_per_dollar+'× points per eligible $1 spent'],
  [!!p.free_shipping,'Free standard US shipping on eligible orders'],
  [p.discount_bps>0,(p.discount_bps?String(p.discount_bps/100):'5')+'% off eligible orders, applied automatically'],
  [!!p.early_access,'Early access to eligible new releases'],
  [!!p.priority_fulfillment,'Priority fulfillment — ships first where available'],
  [p.monthly_credit_cents>0,'$50 monthly store credit after a paid $150+ order'],
  [!!p.free_bac_water_3ml,'Free BAC Water (3mL) with every eligible purchase']
 ];
 return entries.map(([enabled,label])=>'<li class="'+(enabled?'':'mx-unavailable')+'"><span class="mx-icon" aria-hidden="true">'+(enabled?'✓':'○')+'</span><span>'+esc(label)+'</span></li>').join('');
};
function card(id){
 const free=id==='member',middle=id==='vip',p=plans[id];
 const href=free?'/account/signup':'/checkout?plan='+encodeURIComponent(id)+'&period='+period;
 const tier=middle?'ALTA <span class="mx-metal-gold">GOLD</span>':id==='elite'?'ALTA <span class="mx-metal-platinum">PLATINUM</span>':'Member';
 const price=free?'Free':usd(p[period+'_cents'])+'<small>/'+(period==='annual'?'yr':'mo')+'</small>';
 const subtitle=free?'Start earning points on every eligible order.':middle?'More rewards and savings with each order.':'Everything in GOLD, plus premium fulfillment perks.';
 return '<article class="mx-card mx-card-'+id+'">'+(middle?'<span class="mx-popular">MOST POPULAR</span>':'')+
 '<div class="mx-card-top"><h3>'+tier+'</h3><div class="mx-price">'+price+'</div><p>'+subtitle+'</p></div>'+
 '<ul class="mx-benefits">'+features(id)+'</ul>'+
 '<a class="mx-choose" href="'+href+'" aria-label="'+esc((free?'Create account':'Choose '+displayName(id))+' '+(free?'':'billed '+period))+'">'+(free?'Create Account':'Choose '+displayName(id))+'</a></article>';
}
function render(){
 const root=target();if(!root)return;
 root.innerHTML='<section class="mx-membership-page'+(fullPage?'':' mx-membership-embedded')+'">'+
 '<header class="mx-hero"><span class="mx-eyebrow">'+membershipIcon+'ALTA PURE LABS MEMBERSHIPS</span><'+(fullPage?'h1':'h2')+'>Save on every order,<br><em>automatically.</em></'+(fullPage?'h1':'h2')+'>'+
 '<p>Choose a prepaid membership to unlock eligible savings, free standard US delivery and extra rewards on future orders after confirmed payment.</p></header>'+
 '<div class="mx-period" role="group" aria-label="Membership billing"><button type="button" data-mx-period="monthly" aria-pressed="'+(period==='monthly')+'">Monthly</button><button type="button" data-mx-period="annual" aria-pressed="'+(period==='annual')+'">Annual <span>Save 20%</span></button></div>'+
 '<div class="mx-card-grid">'+['member','vip','elite'].map(card).join('')+'</div>'+
 '<p class="mx-terms">Prepaid terms do not renew automatically. The better of BOGO and eligible member or volume pricing applies per product line; membership fees do not earn points. Standard shipping, discount and points benefits activate on verified payment. Priority fulfillment, monthly credits and gift items require eligibility and fulfillment verification.</p>'+
 (fullPage?'<section class="mx-faq" id="membership-faq"><header><h2>Membership FAQ</h2><p>Everything you need to know before you join.</p></header><div class="mx-faq-items">'+
 faq.map(([q,a])=>'<details><summary>'+esc(q)+'<span aria-hidden="true"></span></summary><p>'+esc(a)+'</p></details>').join('')+
 '</div></section>':'')+'</section>';
 root.querySelectorAll('[data-mx-period]').forEach(b=>b.addEventListener('click',()=>{if(period===b.dataset.mxPeriod)return;period=b.dataset.mxPeriod;render();}));
}
render();
/* A legacy storefront initializer may replace #ap-main after this script runs.
   Restore this scoped membership view without intercepting unrelated routes. */
new MutationObserver(()=>{
 const root=target();if(root&&!root.querySelector('.mx-membership-page'))render();
}).observe(main,{childList:true,subtree:homePage});
})();
