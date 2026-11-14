'use strict';

// Pure decision helper for AltaPure's existing Manage Order fulfillment flow.
// This module never creates orders, contacts Lotus or changes payment state.
const US_REGIONS=new Set('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC AA AE AP PR VI'.split(' '));
function destination(address){
 const country=String(address?.country||address?.country_code||'').trim().toUpperCase();
 const region=String(address?.region||address?.state||'').trim().toUpperCase();
 const zip=String(address?.postal_code||address?.zip||'').trim();
 return (country==='US'||country==='USA'||country==='UNITED STATES')&&US_REGIONS.has(region)&&/^\d{5}(?:-\d{4})?$/.test(zip);
}
function decide(order,{mapping={},stock={},enabled=false}={}){
 const manual=reason=>({route:'manual',reason,eligible:false});
 if(!order||typeof order!=='object')return manual('Order unavailable');
 if(!['paid','partially_refunded'].includes(order.payment_status))return manual('Payment not confirmed in full');
 if(order.payment_status!=='paid')return manual('Payment requires manual review');
 if(order.archived||['canceled','shipped','delivered'].includes(order.fulfillment_status))return manual('Order is closed or archived');
 if(order.manual_override)return manual('Manual fulfillment selected');
 if(order.lotus_supplier_id)return {route:'lotus_existing',reason:'Existing supplier order; reconcile without resubmitting',eligible:false};
 const address=order.shipping_address||order.request_data?.address||{};
 if(!destination(address))return manual('Destination not supported by Lotus');
 const items=order.store_order_items||order.request_data?.items||[];
 if(!Array.isArray(items)||!items.length)return manual('No order items');
 for(const item of items){
  const id=String(item.product_id||item.id||'');
  const size=String(item.variant_size||item.size||'');
  const key=id+'|'+size;
  const m=mapping[key];
  if(!m||!Number.isInteger(m.product)||m.product<1||!Number.isInteger(m.vials)||m.vials<1)return manual('At least one product variant is not mapped to Lotus');
  const quantity=Number(item.quantity??item.qty);
  if(!Number.isInteger(quantity)||quantity<1||quantity%m.vials!==0)return manual('Supplier pack size does not match an order item');
  if(stock[key]!=='in')return manual('Supplier stock is unavailable or unverified');
 }
 if(!enabled)return manual('Lotus automation is disabled');
 return {route:'lotus_candidate',reason:'All lines mapped and stock hints available; obtain fresh quote before submission',eligible:true};
}
module.exports={destination,decide};
