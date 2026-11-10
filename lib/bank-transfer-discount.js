'use strict';
// Server-selected rail only. Existing invoices keep their immutable pricing snapshot.
function applyBankDiscount(pricing,method,kind){
 if(kind!=='goods'||method.kind!=='bank_transfer'||method.active!==true)return pricing;
 const base=pricing.subtotal_cents-pricing.discount_cents;
 if(!Number.isSafeInteger(base)||base<0)throw Error('Invalid bank discount base');
 const amount=Math.floor(base*500/10000);
 pricing.payment_discount={kind:'bank_transfer',rate_bps:500,base_cents:base,amount_cents:amount,label:'Bank transfer savings (5%)'};
 pricing.discount_cents+=amount;
 return pricing;
}
module.exports={applyBankDiscount};
