'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {replayShipment}=require('../lib/shipment-tracking');
const event=(id,status,time)=>({id,shipment_id:'shipment-1',provider_event_id:'carrier-'+id,status,occurred_at:time,verified:true});
const accepted=event('event-001','accepted','2026-11-09T10:00:00Z');
const label=event('event-002','label_created','2026-11-09T11:00:00Z');
const transit=event('event-003','in_transit','2026-11-09T12:00:00Z');
const delivered=event('event-004','delivered','2026-11-09T13:00:00Z');
test('no shipment events means no delivery assertion',()=>{
 assert.deepEqual(replayShipment('shipment-1',[]),{valid:true,shipment_id:'shipment-1',status:'awaiting_fulfillment',delivered:false,customer_notification_authorized:false});
});
test('verified carrier events advance only through valid states',()=>{
 assert.equal(replayShipment('shipment-1',[accepted,label,transit,delivered]).delivered,true);
 assert.equal(replayShipment('shipment-1',[delivered]).valid,false);
 assert.equal(replayShipment('shipment-1',[accepted,delivered]).valid,false);
});
test('rejects forged, duplicate, cross-shipment and out-of-order events',()=>{
 assert.equal(replayShipment('shipment-1',[{...accepted,verified:false}]).valid,false);
 assert.equal(replayShipment('shipment-1',[accepted,accepted]).valid,false);
 assert.equal(replayShipment('shipment-1',[accepted,{...label,provider_event_id:accepted.provider_event_id}]).valid,false);
 assert.equal(replayShipment('shipment-1',[{...accepted,shipment_id:'shipment-2'}]).valid,false);
 assert.equal(replayShipment('shipment-1',[accepted,{...label,occurred_at:'2026-11-08T00:00:00Z'}]).valid,false);
});
test('exceptions can resume or return; no automatic notifications',()=>{
 const exception=event('event-005','exception','2026-11-09T14:00:00Z');
 const resumed=event('event-006','in_transit','2026-11-09T15:00:00Z');
 const result=replayShipment('shipment-1',[accepted,label,transit,exception,resumed]);
 assert.equal(result.valid,true);
 assert.equal(result.status,'in_transit');
 assert.equal(result.customer_notification_authorized,false);
});
