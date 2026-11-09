'use strict';

/**
 * Pure shipment event reconciliation, not a carrier API or shipping approval.
 * Events must be authenticated and verified by a future server-side adapter.
 */
const STATES=Object.freeze(['awaiting_fulfillment','accepted','label_created','in_transit','out_for_delivery','delivered','exception','returned','cancelled']);
const ID=/^[a-z0-9][a-z0-9-]{1,119}$/;
const EDGES=Object.freeze({
 awaiting_fulfillment:['accepted','cancelled'],
 accepted:['label_created','cancelled','exception'],
 label_created:['in_transit','cancelled','exception'],
 in_transit:['out_for_delivery','delivered','exception','returned'],
 out_for_delivery:['delivered','exception','returned'],
 delivered:['returned'],
 exception:['in_transit','out_for_delivery','returned','cancelled'],
 returned:[],cancelled:[]
});
function validEvent(e){
 return !!e&&typeof e==='object'&&ID.test(e.id||'')&&ID.test(e.shipment_id||'')&&
  STATES.includes(e.status)&&typeof e.provider_event_id==='string'&&e.provider_event_id.length>=2&&e.provider_event_id.length<=180&&
  typeof e.occurred_at==='string'&&Number.isFinite(Date.parse(e.occurred_at))&&
  e.verified===true;
}
function replayShipment(shipmentId,events){
 if(!ID.test(shipmentId||'')||!Array.isArray(events))return {valid:false,reason:'INVALID_INPUT'};
 let status='awaiting_fulfillment',lastTime=-Infinity;
 const ids=new Set(),providerIds=new Set();
 for(const e of events){
  if(!validEvent(e)||e.shipment_id!==shipmentId||ids.has(e.id)||providerIds.has(e.provider_event_id))
   return {valid:false,reason:'UNVERIFIED_OR_DUPLICATE_EVENT'};
  const timestamp=Date.parse(e.occurred_at);
  if(timestamp<lastTime)return {valid:false,reason:'OUT_OF_ORDER'};
  lastTime=timestamp;ids.add(e.id);providerIds.add(e.provider_event_id);
  if(!EDGES[status].includes(e.status))return {valid:false,reason:'INVALID_STATE_TRANSITION'};
  status=e.status;
 }
 return {valid:true,shipment_id:shipmentId,status,delivered:status==='delivered',customer_notification_authorized:false};
}
module.exports={STATES,EDGES,validEvent,replayShipment};
