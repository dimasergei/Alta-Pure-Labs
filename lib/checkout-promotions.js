'use strict';
const {version:VERSION,coupon:COUPON,coupon_discount_bps:RATE}=require('../config/checkout.json').promotions;
function normalizeCoupon(value){
 if(value===undefined||value===null||value==='')return '';
 if(typeof value!=='string'||value.length>40)throw Object.assign(Error('Enter a valid coupon code.'),{status:400});
 const code=value.trim().toUpperCase();
 if(code&&code!==COUPON)throw Object.assign(Error('That coupon code is not available.'),{status:400});
 return code;
}
function applyPromotions(pricing,kind,coupon=''){
 const code=normalizeCoupon(coupon);
 if(kind!=='goods')throw Object.assign(Error('Membership and subscription purchases are unavailable.'),{status:409});
 const savings=code?Math.round(pricing.subtotal_cents*RATE/10000):0;
 const discounts=pricing.lines.map(line=>code?Math.floor(line.gross_cents*RATE/10000):0);
 // Allocate rounded subtotal savings without losing cents or changing quantities.
 const pennies=savings-discounts.reduce((sum,value)=>sum+value,0);
 const ranked=pricing.lines.map((line,index)=>({index,remainder:line.gross_cents*RATE%10000}))
  .sort((a,b)=>b.remainder-a.remainder||a.index-b.index);
 for(let i=0;i<pennies;i++)discounts[ranked[i].index]++;
 pricing.lines=pricing.lines.map((line,index)=>{
  const discount=discounts[index];
  return {...line,discount_cents:discount,discount_bps:code?RATE:0,discount_reason:code?'coupon_blackfriday15':'none',bogo_free_units:0,coupon_discount_cents:discount,line_total_cents:line.gross_cents-discount};
 });
 pricing.promotion_version=VERSION;pricing.coupon_code=code;pricing.discount_cents=savings;pricing.bogo_free_units=0;pricing.coupon_discount_cents=savings;
 return pricing;
}
module.exports={VERSION,normalizeCoupon,applyPromotions};
