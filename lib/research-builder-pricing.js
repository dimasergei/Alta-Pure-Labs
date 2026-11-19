'use strict';
// Four-compound Member Stack is a paid PURE membership benefit, not a subscription.
// Each basket is an independent, customer-authorized goods checkout.
const base=require('./manual-commerce');
const fail=message=>{throw Object.assign(Error(message),{status:400});};
const tierBenefits=Object.freeze({
 vip:Object.freeze({plan:'vip',discount_bps:2000,shipping:'standard',shipping_label:'Included US standard shipping'}),
 elite:Object.freeze({plan:'elite',discount_bps:4000,shipping:'express',shipping_label:'Included US express shipping'})
});
const terms=Object.freeze({version:'pure-member-stack-2026-11-v2',currency:'USD',selection_count:4,
 membership_required:true,subscription_available:false,automatic_renewal:false,
 tier_benefits:tierBenefits,bundled_item:{id:'gift-bac-3',name:'BAC Water',size:'3 mL',qty:1}});
function catalog(source){return source.filter(product=>product.category==='injectables').map(({id,name,category,group,variants})=>({id,name,category,group,variants:variants.map(({size,price})=>({size,price}))}));}
function validateItems(items,source){
 if(!Array.isArray(items)||items.length!==4||new Set(items.map(item=>item?.id)).size!==4)fail('Choose four different research compounds.');
 const eligible=new Set(catalog(source).map(item=>item.id));
 if(items.some(item=>!eligible.has(item?.id)||item.qty!==1))fail('Choose one unit of four different injectable compounds.');
 return base.itemsFromCatalog(items,source);
}
function quote(items,source,{membership=null}={}){
 if(!membership?.invoice_id||!['vip','elite'].includes(membership.plan))fail('An active PURE WHITE or PURE BLACK membership is required.');
 const benefits=tierBenefits[membership.plan];
 const pricing=base.priceLines(validateItems(items,source));
 pricing.lines=pricing.lines.map(line=>{
  const saving=Math.floor(line.gross_cents*benefits.discount_bps/10000);
  return {...line,discount_cents:saving,discount_bps:benefits.discount_bps,discount_reason:'member_stack',
   line_total_cents:line.gross_cents-saving};
 });
 pricing.discount_cents=pricing.lines.reduce((sum,line)=>sum+line.discount_cents,0);
 return {...pricing,pricing,mode:'member_stack',retail_cents:pricing.subtotal_cents,
  total_cents:pricing.subtotal_cents-pricing.discount_cents,shipping_cents:0,
  bundled_item:terms.bundled_item,shipping_label:benefits.shipping_label,shipping_speed:benefits.shipping,discount_bps:benefits.discount_bps,member_plan:membership.plan,terms};
}
module.exports={quote,catalog,validateItems,terms,tierBenefits};
