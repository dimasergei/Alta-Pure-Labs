/* AltaPure membership comparison. Prices/benefits read from server-aligned config. */
(()=>{
'use strict';
if(!/^\/memberships\/?$/.test(location.pathname))return;
const plans=window.AltaConversionConfig?.plans,root=document.getElementById('ap-main');
if(!plans||!root)return;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const usd=c=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(c/100);
const displayName=id=>id==='vip'?'ALTA GOLD':id==='elite'?'ALTA PLATINUM':'Member';
let period='monthly';
const faq=[
 ['Can I cancel at any time?','Paid memberships are prepaid for one month or one year, with no automatic renewal or future recurring charge. Refund requests during a prepaid term follow the published refund policy.'],
 ['Does my discount change based on monthly vs. annual billing?','No. Your tier benefits remain the same. Annual pricing saves 20% compared with purchasing twelve individual monthly terms.'],
 ['Does the discount apply to sale items?','For each eligible product line, the better offer among BOGO, membership and volume pricing applies. Those offers do not stack with one another on the same item. Eligible coupons and bank-transfer savings are calculated separately.'],
 ['Can I buy a membership together with other products?','Memberships must be purchased separately. Your existing cart remains saved; after payment is confirmed and the membership appears on your account, return to checkout for eligible benefits.'],
 ['What happens if I let my membership lapse?','Your account returns to the free Member tier when the prepaid term expires. Order history and eligible points remain accessible, while paid-tier discounts and free standard US delivery stop. You can purchase a new term when your previous one has ended.']
];
const features=id=>{
 const p=plans[id],paid=id!=='member';
 return [[true,p.points_per_dollar+'× points per eligible $1 spent'],
 [paid,'Free standard US shipping on eligible orders'],
 [paid,(p.discount_bps/100)+'% off eligible merchandise automatically'],
 [true,'Order history and shipment tracking'],
 [true,'Points balance and store credit in your account']]
 .map(([enabled,label])=>'<li class="'+(enabled?'':'mx-unavailable')+'"><span class="mx-icon" aria-hidden="true">'+(enabled?'✓':'○')+'</span><span>'+esc(label)+'</span></li>').join('');
};
function card(id){
 const free=id==='member',middle=id==='vip',p=plans[id];
 const href=free?'/account/signup':'/checkout?plan='+encodeURIComponent(id)+'&period='+period;
 const tier=middle?'ALTA <span class="mx-metal-gold">GOLD</span>':id==='elite'?'ALTA <span class="mx-metal-platinum">PLATINUM</span>':'Member';
 const price=free?'Free':usd(p[period+'_cents'])+'<small>/'+(period==='annual'?'yr':'mo')+'</small>';
 const subtitle=free?'Start earning points on every eligible order.':middle?'More rewards and savings with each order.':'Our highest available level of member savings.';
 return '<article class="mx-card mx-card-'+id+'">'+(middle?'<span class="mx-popular">MOST POPULAR</span>':'')+
 '<div class="mx-card-top"><h3>'+tier+'</h3><div class="mx-price">'+price+'</div><p>'+subtitle+'</p></div>'+
 '<ul class="mx-benefits">'+features(id)+'</ul>'+
 '<a class="mx-choose" href="'+href+'" aria-label="'+esc((free?'Create account':'Choose '+displayName(id))+' '+(free?'':'billed '+period))+'">'+(free?'Create Account':'Choose '+displayName(id))+'</a></article>';
}
function render(){
 root.innerHTML='<section class="mx-membership-page">'+
 '<header class="mx-hero"><span class="mx-eyebrow">✧ ALTA PURE LABS MEMBERSHIPS</span><h1>Save on every order,<br><em>automatically.</em></h1>'+
 '<p>Choose a prepaid membership to unlock eligible savings, free standard US delivery and extra rewards on future orders after confirmed payment.</p></header>'+
 '<div class="mx-period" role="group" aria-label="Membership billing"><button type="button" data-mx-period="monthly" aria-pressed="'+(period==='monthly')+'">Monthly</button><button type="button" data-mx-period="annual" aria-pressed="'+(period==='annual')+'">Annual <span>Save 20%</span></button></div>'+
 '<div class="mx-card-grid">'+['member','vip','elite'].map(card).join('')+'</div>'+
 '<p class="mx-terms">Prepaid terms do not renew automatically. The better of BOGO and eligible member or volume pricing applies per product line; membership fees do not earn points. Benefits become active only after verified payment.</p>'+
 '<section class="mx-faq" id="membership-faq"><header><h2>Membership FAQ</h2><p>Everything you need to know before you join.</p></header><div class="mx-faq-items">'+
 faq.map(([q,a])=>'<details><summary>'+esc(q)+'<span aria-hidden="true"></span></summary><p>'+esc(a)+'</p></details>').join('')+
 '</div></section></section>';
 root.querySelectorAll('[data-mx-period]').forEach(b=>b.addEventListener('click',()=>{if(period===b.dataset.mxPeriod)return;period=b.dataset.mxPeriod;render();}));
}
render();
})();