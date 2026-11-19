'use strict';
const base=require('./manual-commerce');
const benefits=require('./membership-benefits');
const fail=message=>{throw Object.assign(Error(message),{status:400});};
// Monthly invoices use existing payment rails, without an unattended card mandate.
// A customer must confirm and pay each new billing period.
const terms=Object.freeze({version:'research-builder-2026-11-v3',currency:'USD',selection_count:4,discount_bps:4000,
 minimum_paid_cycles:0,interval:'monthly',one_time_discount_bps:0,automatic_renewal:false,
 subscription_available:true,one_time_available:true,billing_mode:'invoice_per_cycle',change_after_first_shipment:false,cancel_after_paid_cycles:0,
 subscription_shipping_label:'Free US express shipping',bundled_item:{id:'gift-bac-3',name:'BAC Water',size:'3 mL',qty:1}});
function catalog(source){return source.filter(product=>product.category==='injectables').map(({id,name,category,group,variants})=>({id,name,category,group,variants:variants.map(({size,price})=>({size,price}))}));}
function validateItems(items,source){
 if(!Array.isArray(items)||items.length!==4||new Set(items.map(item=>item?.id)).size!==4)fail('Choose four different research compounds.');
 const eligible=new Set(catalog(source).map(item=>item.id));
 if(items.some(item=>!eligible.has(item?.id)||item.qty!==1))fail('Choose one unit of each of four different injectable compounds. Supplies are not part of the four selections.');
 return base.itemsFromCatalog(items,source);
}
function quote(items,source,{mode='one_time',membership=null,coupon=''}={}){
 if(!['one_time','subscription'].includes(mode))fail('Choose a one-time order or a monthly AUTO-STACK invoice.');
 const pricing=base.priceLines(validateItems(items,source));
 if(mode==='subscription'){
  pricing.lines=pricing.lines.map(line=>{const discount=Math.floor(line.gross_cents*terms.discount_bps/10000);return {...line,discount_cents:discount,discount_bps:terms.discount_bps,discount_reason:'research_monthly',line_total_cents:line.gross_cents-discount};});
  pricing.discount_cents=pricing.lines.reduce((sum,line)=>sum+line.discount_cents,0);
 }else benefits.apply(pricing,membership,coupon);
 const total=pricing.subtotal_cents-pricing.discount_cents;
 return {...pricing,pricing,mode,retail_cents:pricing.subtotal_cents,total_cents:total,monthly_cents:mode==='subscription'?total:null,
  shipping_cents:mode==='subscription'?0:null,shipping_confirmed:false,bundled_item:mode==='subscription'?terms.bundled_item:null,
  minimum_paid_cycles:mode==='subscription'?terms.minimum_paid_cycles:0,terms,subscription_available:true,one_time_available:true,
  reason:mode==='subscription'?'This payment covers one month. Each additional month needs a new paid invoice; no charge is made without checkout.':'One-time order. Final delivery, discounts and payment totals are confirmed at checkout.'};
}
module.exports={quote,catalog,validateItems,terms};
