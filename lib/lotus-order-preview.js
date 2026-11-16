'use strict';

// Authenticated admin preview only. The sole external call is a nonbinding
// quote; this module never creates an order, reserves stock or writes to DB.
const adapter=require('./lotus-supplier');
const {client,cents}=require('./lotus-client');
const {destination}=require('./lotus-order-routing');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const clean=value=>String(value||'').replace(/[\u0000-\u001f\u007f]/g,'').slice(0,180);
function checked(result){if(result.error)throw Object.assign(Error('Supplier preview records are unavailable.'),{status:503});return result.data;}

async function previewOrder(db,{invoiceId,env=process.env,fetchImpl=fetch,now=Date.now}={}){
 if(!UUID.test(invoiceId||''))throw Object.assign(Error('Invalid order reference.'),{status:400});
 const order=checked(await db.from('commerce_invoices').select('id,kind,status,currency,total_cents,request_data').eq('id',invoiceId).maybeSingle());
 if(!order)throw Object.assign(Error('Order not found.'),{status:404});
 const config=adapter.configuration(env),issues=[];
 const add=(code,severity,message)=>issues.push({code,severity,message});
 const result={preview_only:true,invoice_id:order.id,checked_at:new Date(now()).toISOString(),configured:config.configured,mode:config.mode,
  automation_enabled:false,payment_confirmed:['paid','processing','shipped','delivered'].includes(order.status),quote_available:false,ready:false,
  lines:[],supplier_total_cents:null,supplier_currency:'USD',invoice_total_cents:order.total_cents,invoice_currency:order.currency,
  comparison:{comparable:false,remaining_before_other_costs_cents:null,note:'Customer order total minus supplier quote, before postage, payment fees, taxes and other costs. This is not net profit.'},issues,
  notice:'Read-only estimate. No stock is reserved, no order is submitted and no payment or shipping label is purchased. Availability and price are checked again before submission.'};
 if(order.kind!=='goods'){add('not_goods','error','Only physical product orders can be checked with Lotus.');return result;}
 if(!['accepted','paid','processing'].includes(order.status)){add('order_closed','error','This order is not awaiting payment or fulfillment.');return result;}
 if(!result.payment_confirmed)add('awaiting_payment','info','Payment has not been confirmed. This check does not mark the order paid or send it to Lotus.');
 const [settings,mappings,allocations,jobs]=await Promise.all([
  db.from('commerce_supplier_settings').select('enabled,verified_at,max_order_cents').eq('id',true).maybeSingle().then(checked),
  db.from('commerce_supplier_mappings').select('variant_key,product,vials,verified_at').then(checked),
  db.from('commerce_fulfillment_items').select('variant_key,item,route,product,vials').eq('invoice_id',invoiceId).then(checked),
  db.from('commerce_supplier_jobs').select('supplier_id,payload,takeover_requested,status').eq('invoice_id',invoiceId).then(checked)
 ]);
 result.automation_enabled=env.LOTUS_FULFILLMENT_ENABLED==='true'&&settings?.enabled===true&&!!settings.verified_at&&settings.max_order_cents>0&&config.mode==='live';
 if(!config.configured)add('api_not_configured','error','Lotus API access is not configured.');
 else if(config.mode!=='live')add('test_mode','warning','This is a test-mode quote. It does not establish live fulfillment availability.');
 if(!result.automation_enabled)add('automation_disabled','warning','Automatic live Lotus fulfillment is not enabled and verified.');
 if(jobs?.some(job=>job.supplier_id||job.payload||job.takeover_requested))add('existing_supplier_job','warning','A supplier submission or cancellation already exists. This fresh estimate does not replace its saved price or authorize another order.');
 const items=order.request_data?.items,address=order.request_data?.address;
 // Match the worker's canonical fields, with complete street/city validation.
 if(!destination(address)||address?.country!=='US'||!/^([A-Z]{2})$/.test(address?.region||'')||!/^\d{5}(?:-\d{4})?$/.test(address?.postal_code||'')||
  typeof address?.line1!=='string'||address.line1.trim().length<3||typeof address?.city!=='string'||address.city.trim().length<2)
  add('unsupported_address','error','Lotus requires a complete US street address, supported two-letter state and valid ZIP code.');
 if(!Array.isArray(items)||!items.length){add('no_items','error','This order has no physical product lines.');return result;}
 const current=Object.fromEntries((mappings||[]).map(row=>[row.variant_key,row]));
 const saved=Object.fromEntries((allocations||[]).map(row=>[row.variant_key,row]));
 const fulfillmentItems=[...items],requestedKeys=new Set(items.map(item=>String(item.id||'')+'|'+String(item.size||'')));
 const allocationKeys=new Set();
 for(const allocation of allocations||[]){
  if(allocationKeys.has(allocation.variant_key))add('allocation_mismatch','error','Duplicate saved fulfillment lines need reconciliation before a supplier quote.');
  allocationKeys.add(allocation.variant_key);
  if(requestedKeys.has(allocation.variant_key))continue;
  // The paid-order trigger adds explicit membership gifts outside request_data.
  // Include those physical units exactly as the fulfillment worker does, but
  // never interpret an unexplained orphan allocation as an extra purchase.
  if(allocation.item?.membership_gift!==true||allocation.variant_key!==String(allocation.item?.id||'')+'|'+String(allocation.item?.size||'')){
   add('allocation_mismatch','error','An extra saved fulfillment line needs review before a supplier quote.');continue;
  }
  fulfillmentItems.push(allocation.item);
 }
 const mapping=Object.create(null),seen=new Set();
 for(const item of fulfillmentItems){
  const key=String(item.id||'')+'|'+String(item.size||'');
  const row=allocations?.length?saved[key]:current[key];
  const line={variant_key:clean(key),name:clean(item.name||item.id),size:clean(item.size),qty:item.qty,membership_gift:item.membership_gift===true,product:row?.product||null,vials:row?.vials||null,pack_quantity:null};
  result.lines.push(line);
  if(seen.has(key)){add('duplicate_variant','error','Duplicate product variants need reconciliation before a supplier quote.');continue;}seen.add(key);
  if(allocations?.length&&(!row||row.route!=='lotus'||row.item?.id!==item.id||row.item?.size!==item.size||row.item?.qty!==item.qty)){
   add('manual_or_mixed_routing','error','The complete order is not assigned to Lotus. Mixed supplier orders require manual fulfillment.');continue;
  }
  // Paid orders use their immutable allocation mapping, just as the worker does.
  if(!row||(!allocations?.length&&!row.verified_at)){add('unmapped_variant','error',line.name+' '+line.size+' has no verified exact Lotus mapping.');continue;}
  try{const request=adapter.linesFor([item],{[key]:row})[0];mapping[key]=row;line.pack_quantity=request.quantity;}
  catch{add('unsupported_quantity','error',line.name+' '+line.size+' does not match a supported supplier pack quantity.');}
 }
 if(issues.some(issue=>issue.severity==='error'))return result;
 try{
  const quote=await client({env,fetchImpl}).quote(adapter.linesFor(fulfillmentItems,mapping));
  // Lotus can coalesce identical supplier SKUs (e.g. purchased BAC plus a gift).
  // Validate the provider's availability result, not a display-row count.
  if(!quote||!Array.isArray(quote.lines)||!quote.lines.length||quote.problems?.length||quote.lines.some(line=>!line||line.problem)||
   (quote.currency&&quote.currency!=='USD')||(quote.mode&&quote.mode!==config.mode)){
   add('quote_unavailable','error','Lotus did not confirm an available quote for every order item. Review availability, quantities and pricing in the partner portal.');return result;
  }
  result.supplier_total_cents=cents(quote.owed_total);result.quote_available=true;result.quoted_at=new Date(now()).toISOString();
  if(result.supplier_total_cents>settings?.max_order_cents)add('cost_limit','error','The supplier quote exceeds the configured per-order supplier spending limit.');
  if(order.currency==='USD'&&Number.isSafeInteger(order.total_cents)&&order.total_cents>=0){
   const remaining=order.total_cents-result.supplier_total_cents;
   result.comparison={...result.comparison,comparable:true,remaining_before_other_costs_cents:remaining};
   if(remaining<=0)add('supplier_cost_exceeds_total','warning','The supplier quote meets or exceeds the customer order total before postage, fees, taxes and other costs. Review the economics before fulfillment.');
   else if(remaining<order.total_cents/10)add('low_headroom','warning','Less than 10% of the customer order total remains before postage, fees, taxes and other costs. Review the economics before fulfillment.');
  }else add('currency_comparison_unavailable','info','The invoice and supplier quote cannot be compared directly. Review the exchange rate and other costs separately.');
  result.ready=result.payment_confirmed&&result.automation_enabled&&!issues.some(issue=>issue.severity==='error'||issue.code==='existing_supplier_job');
 }catch(error){
  add(error.code==='invalid_money'?'invalid_quote':'supplier_unavailable','error',error.code==='invalid_money'?'Lotus returned an invalid quote amount. No fulfillment readiness was confirmed.':'The current Lotus quote could not be obtained. Check supplier access and availability, then try again.');
 }
 return result;
}
module.exports={previewOrder};
