'use strict';

/**
 * Pure inventory-lot reconciliation foundation. No database writes, supplier
 * calls, allocations or sale/shipping authorization.
 */
const STATES=Object.freeze(['quarantine','released','hold','recalled','depleted']);
const ID=/^[a-z0-9][a-z0-9-]{1,119}$/;
function validLot(lot){
 return !!lot && typeof lot==='object' &&
  ['id','sku_key','supplier_id','fulfillment_site'].every(k=>typeof lot[k]==='string'&&ID.test(lot[k])) &&
  typeof lot.lot_number==='string'&&lot.lot_number.trim().length>0&&lot.lot_number.length<=120 &&
  STATES.includes(lot.status) &&
  ['on_hand','reserved','damaged'].every(k=>Number.isSafeInteger(lot[k])&&lot[k]>=0) &&
  lot.reserved+lot.damaged<=lot.on_hand &&
  typeof lot.evidence_reference==='string'&&lot.evidence_reference.length<=200;
}
function available(lot){
 if(!validLot(lot)||lot.status!=='released'||!lot.evidence_reference.trim())return 0;
 return lot.on_hand-lot.reserved-lot.damaged;
}
function transition(lot,nextStatus,{reviewer,evidence_reference}={}){
 if(!validLot(lot)||!STATES.includes(nextStatus)||typeof reviewer!=='string'||!reviewer.trim()||
   typeof evidence_reference!=='string'||!evidence_reference.trim())return {ok:false,reason:'INVALID_TRANSITION'};
 const edges={
  quarantine:['released','hold','recalled'],
  released:['hold','recalled','depleted'],
  hold:['quarantine','recalled'],
  recalled:[],
  depleted:['quarantine']
 };
 if(!edges[lot.status].includes(nextStatus))return {ok:false,reason:'TRANSITION_DENIED'};
 if(nextStatus==='depleted'&&available(lot)!==0)return {ok:false,reason:'STOCK_REMAINS'};
 // This is a simulation; an actual release requires an independently reviewed COA.
 return {ok:true,lot:{...lot,status:nextStatus,evidence_reference},reviewer};
}
function reserve(lot,quantity){
 if(!validLot(lot)||!Number.isSafeInteger(quantity)||quantity<1||quantity>available(lot))return {ok:false,reason:'UNAVAILABLE'};
 return {ok:true,lot:{...lot,reserved:lot.reserved+quantity}};
}
function releaseReservation(lot,quantity){
 if(!validLot(lot)||!Number.isSafeInteger(quantity)||quantity<1||quantity>lot.reserved)return {ok:false,reason:'INVALID_RELEASE'};
 return {ok:true,lot:{...lot,reserved:lot.reserved-quantity}};
}
function reconcile(lots,skuKey){
 if(!Array.isArray(lots)||typeof skuKey!=='string'||!ID.test(skuKey))return {valid:false,reason:'INVALID_INPUT'};
 const seen=new Set();let total=0;
 for(const lot of lots){
  if(!validLot(lot)||seen.has(lot.id))return {valid:false,reason:'INVALID_OR_DUPLICATE_LOT'};
  seen.add(lot.id);
  if(lot.sku_key===skuKey)total+=available(lot);
  if(!Number.isSafeInteger(total))return {valid:false,reason:'TOTAL_OVERFLOW'};
 }
 return {valid:true,sku_key:skuKey,available_units:total,can_sell:false};
}
module.exports={STATES,validLot,available,transition,reserve,releaseReservation,reconcile};
