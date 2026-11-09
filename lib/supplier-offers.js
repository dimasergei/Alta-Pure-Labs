'use strict';

/**
 * Supplier offer comparison and normalization for manual review.
 * Does not order, reserve inventory, substitute SKUs or authorize shipments.
 */
const SUPPLIERS=Object.freeze(['99-purity','your-peptide-brand','peptidedropship']);
const STATES=Object.freeze(['unverified','verified','unavailable','discontinued']);
function cents(n){return Number.isSafeInteger(n)&&n>=0&&n<=100000000;}
function validOffer(o){
  if(!o||typeof o!=='object'||!SUPPLIERS.includes(o.supplier_id))return false;
  if(typeof o.supplier_sku!=='string'||!o.supplier_sku.trim()||o.supplier_sku.length>120)return false;
  if(typeof o.catalog_sku_key!=='string'||!/^[a-z0-9-]+$/.test(o.catalog_sku_key))return false;
  if(!STATES.includes(o.state)||!['USD','CAD'].includes(o.currency))return false;
  if(!cents(o.unit_cost_cents)||!cents(o.handling_cents)||!cents(o.shipping_cents))return false;
  if(!Number.isSafeInteger(o.minimum_quantity)||o.minimum_quantity<1)return false;
  if(typeof o.composition_confirmed!=='boolean'||typeof o.strength_confirmed!=='boolean')return false;
  if(typeof o.evidence_reference!=='string'||o.evidence_reference.length>200)return false;
  return true;
}
function totalCost(offer,quantity){
  if(!validOffer(offer)||!Number.isSafeInteger(quantity)||quantity<offer.minimum_quantity||quantity>100000)return null;
  const cost=offer.unit_cost_cents*quantity+offer.handling_cents+offer.shipping_cents;
  return Number.isSafeInteger(cost)?cost:null;
}
function compareOffers(offers,{catalogSkuKey,quantity=1,currency='USD'}={}){
  if(!Array.isArray(offers)||typeof catalogSkuKey!=='string'||!Number.isSafeInteger(quantity)||quantity<1)return [];
  return offers.filter(o=>validOffer(o)&&o.catalog_sku_key===catalogSkuKey&&o.currency===currency)
    .map(o=>{
      const cost=totalCost(o,quantity);
      const eligibleForReview=o.state==='verified'&&o.composition_confirmed&&o.strength_confirmed&&cost!==null;
      return {supplier_id:o.supplier_id,supplier_sku:o.supplier_sku,catalog_sku_key:o.catalog_sku_key,
        state:o.state,eligibleForReview,total_cost_cents:cost,reason:!eligibleForReview?'NOT_VERIFIED_OR_INCOMPLETE':'COST_ONLY_NOT_ROUTING_APPROVAL'};
    }).sort((a,b)=>(a.eligibleForReview===b.eligibleForReview?0:a.eligibleForReview?-1:1)||
      (a.total_cost_cents??Infinity)-(b.total_cost_cents??Infinity));
}
module.exports={SUPPLIERS,STATES,validOffer,totalCost,compareOffers};
