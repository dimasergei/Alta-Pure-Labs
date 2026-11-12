'use strict';
const {ends_at: endsAt}=require('../config/checkout.json').promotions;
const VERSION='bogo-2026-11-v1';
function normalizeCoupon(value){if(value===undefined||value===null||value==='')return '';if(typeof value!=='string'||value.length>40)throw Object.assign(Error('Enter a valid coupon code.'),{status:400});const code=value.trim().toUpperCase();if(code&&code!=='BOGO'&&!/^AP-[A-Z2-9]{12}$/.test(code))throw Object.assign(Error('That coupon code is not available.'),{status:400});return code;}
function applyPromotions(pricing,kind,coupon=''){
 const code=normalizeCoupon(coupon);if(code&&code!=='BOGO')throw Object.assign(Error('Referral code needs account verification.'),{status:400});if(kind!=='goods'){if(code)throw Object.assign(Error('Coupons apply to products, not membership fees.'),{status:400});return pricing;}
 if(Date.now()>=Date.parse(endsAt)){
  if(code==='BOGO')throw Object.assign(Error('The BOGO promotion has ended.'),{status:400});
  return pricing;
 }
 pricing.promotion_version=VERSION;pricing.coupon_code=code;let free=0,couponTotal=0;
 pricing.lines=pricing.lines.map(line=>{
  const pairCount=Math.floor(line.qty/2),bogo=pairCount*line.unit_price_cents;
  const useBogo=bogo>line.discount_cents;
  const baseDiscount=useBogo?bogo:line.discount_cents;
  const couponDiscount=code?Math.floor((line.gross_cents-baseDiscount)*1000/10000):0;
  const discount=baseDiscount+couponDiscount;free+=useBogo?pairCount:0;couponTotal+=couponDiscount;
  return {...line,discount_cents:discount,discount_bps:Math.floor(discount*10000/line.gross_cents),discount_reason:(useBogo?'bogo':line.discount_reason)+(code?'+coupon_bogo':''),bogo_free_units:useBogo?pairCount:0,coupon_discount_cents:couponDiscount,line_total_cents:line.gross_cents-discount};
 });
 pricing.discount_cents=pricing.lines.reduce((n,x)=>n+x.discount_cents,0);pricing.bogo_free_units=free;pricing.coupon_discount_cents=couponTotal;
 return pricing;
}
module.exports={VERSION,normalizeCoupon,applyPromotions};
