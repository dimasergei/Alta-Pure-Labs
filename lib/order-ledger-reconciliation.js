'use strict';
// Read-only reconciliation of two independent order ledgers.
// Never insert an invoice into store_orders: that would create a second payable order.
function reconcile(storeOrders=[],invoices=[]){
 const seen=new Set(),rows=[];
 for(const order of storeOrders){if(!order?.id)continue;const key='store:'+order.id;if(seen.has(key))continue;seen.add(key);rows.push({source:'store',source_id:order.id,created_at:order.created_at,payment_status:order.payment_status,fulfillment_status:order.fulfillment_status,record:order});}
 for(const invoice of invoices){if(!invoice?.id)continue;const key='commerce:'+invoice.id;if(seen.has(key))continue;seen.add(key);const payment_status=invoice.status==='paid'||invoice.status==='processing'||invoice.status==='shipped'||invoice.status==='delivered'?'paid':invoice.status==='void'?'expired':invoice.status==='refunded'?'refunded':'pending';rows.push({source:'commerce',source_id:invoice.id,created_at:invoice.created_at,payment_status,fulfillment_status:invoice.status==='shipped'?'shipped':invoice.status==='delivered'?'delivered':invoice.status==='void'?'canceled':'unfulfilled',record:invoice});}
 return rows.sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||''))||a.source.localeCompare(b.source)||a.source_id.localeCompare(b.source_id));
}
module.exports={reconcile};
