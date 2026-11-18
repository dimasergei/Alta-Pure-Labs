'use strict';
const {emailSender}=require('./brand-display');
const {emailLayout,orderSummary}=require('./order-email-layout');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const EMAIL=/^[^\s@\r\n,;<>]+@[^\s@\r\n,;<>]+\.[^\s@\r\n,;<>]+$/;
const check=r=>{if(r.error)throw Error('Notification storage unavailable.');return r.data;};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function configured(env){return !!env.RESEND_API_KEY&&typeof env.ORDER_CONFIRMATION_FROM==='string'&&env.ORDER_CONFIRMATION_FROM.length>3;}
function checkoutEnvelope(n,env){
 const snapshot=n.snapshot,admin=n.audience==='admin',to=admin?env.ADMIN_ORDER_EMAIL:snapshot.customer_email;
 if(!EMAIL.test(to||'')||!UUID.test(snapshot.id||''))return null;
 const ref=require('./order-display').shortOrder(snapshot.id);
 const details=n.detail||{},lines=details.pricing?.lines||details.request_data?.items||[],address=details.request_data?.address||{};
 // CAD checkout must use its recorded CAD prices. A failed detail read must not
 // turn the request's original USD catalog amounts into CAD-labelled email rows.
 if(snapshot.currency==='CAD'&&(details.pricing?.currency!=='CAD'||!Array.isArray(details.pricing.lines)||!details.pricing.lines.length||
  !details.pricing.lines.every(line=>[line.gross_cents,line.line_total_cents,line.unit_price_cents].some(value=>Number.isSafeInteger(value)&&value>=0))||
  !['subtotal_cents','discount_cents','shipping_cents','tax_cents'].every(key=>Number.isSafeInteger(details[key])&&details[key]>=0)))return null;
 const state=snapshot.status;
 const notificationType=n.event_action==='checkout_placed'?'pending':n.event_action==='payment_recorded'?'confirmation':
   n.event_action==='full_refund_recorded'?'refunded':n.event_action==='status_changed'?
   ({void:'canceled',processing:'processing',shipped:'shipped',delivered:'delivered',refunded:'refunded'}[state]||'processing'):'pending';
 const order={order_number:ref,customer_name:snapshot.customer_name,customer_email:snapshot.customer_email,
  payment_status:state==='accepted'?'pending':state==='void'?'pending':state==='refunded'?'refunded':state==='paid'?'paid':state==='processing'||state==='shipped'||state==='delivered'?'paid':'pending',
  fulfillment_status:state==='void'?'canceled':state==='accepted'?'unfulfilled':state,
  store_order_items:lines.map(x=>({product_name:x.name||'Research product',variant_size:x.size||'',quantity:x.qty||1,unit_price_cents:x.unit_price_cents??x.unit_price_usd_cents??0,gross_cents:x.gross_cents,line_total_cents:x.line_total_cents,discount_cents:x.discount_cents})),
  pricing:details.pricing,subtotal_cents:details.subtotal_cents??details.pricing?.subtotal_cents??snapshot.total_cents,
  discount_cents:details.discount_cents,shipping_cents:details.shipping_cents??0,tax_cents:details.tax_cents??0,total_cents:snapshot.total_cents,currency:snapshot.currency,
  points_redeemed:details.points_redeemed,credit_redeemed_cents:details.credit_redeemed_cents,
  shipping_name:details.request_data?.name||snapshot.customer_name,shipping_address:{...address,state:address.state||address.region||''},
  tracking_carrier:snapshot.tracking_carrier,tracking_number:snapshot.tracking_number};
 const link='https://getpurelabs.com/'+(admin?'admin-orders.html':'account/purchases?id='+encodeURIComponent(snapshot.id));
 const mail=require('./customer-order-email').buildStatusEmail({order,notificationType,orderUrl:link});
 return{from:emailSender(env.ORDER_CONFIRMATION_FROM),to:[to],reply_to:'support@getpurelabs.com',
  subject:(admin?'PURE Admin — ':'')+mail.subject,
  text:mail.text,html:mail.html};
}
function envelope(n,env){
 if(n.snapshot?.checkout_version)return checkoutEnvelope(n,env);
 const s=n.snapshot,admin=n.audience==='admin',recipient=admin?env.ADMIN_ORDER_EMAIL:s.customer_email;
 if(!EMAIL.test(recipient||'')||!UUID.test(s.id||''))return null;
 const orderManagement=s.kind==='goods';
 const ref=(s.checkout_version?'ORD-':'INV-')+s.id.toUpperCase(),link='https://getpurelabs.com/'+(admin?(orderManagement?'admin-orders.html':'admin-payments.html'):'account/purchases?id='+encodeURIComponent(s.id));
 const titles={checkout_placed:admin?'New checkout order':'Order received — payment pending',requested:admin?(orderManagement?'Earlier order request needs review':'New invoice request'):(orderManagement?'Order request received':'Invoice request received'),issued:orderManagement?'Your order total is ready':'Your reviewed invoice is ready',accepted:orderManagement?'Customer accepted the order total':'Customer accepted an invoice',payment_recorded:'Payment receipt recorded',full_refund_recorded:'Full refund recorded',status_changed:'Order status: '+String(s.status).replace(/_/g,' ')};
 const title=titles[n.event_action]||(orderManagement?'Order update':'Invoice update');
 const amount=Number.isSafeInteger(s.total_cents)&&['USD','CAD'].includes(s.currency)?new Intl.NumberFormat('en-US',{style:'currency',currency:s.currency}).format(s.total_cents/100):null;
 const paragraphs=[title,ref,'Event recorded: '+s.event_at];
 if(n.event_action==='checkout_placed')paragraphs.push('Your order is saved. Sign in for the exact total and payment instructions. A bank transfer remains pending until receipt is confirmed.');
 if(n.event_action==='requested')paragraphs.push(admin?(orderManagement?'This earlier order request needs a final total. Open Orders and choose Review CAD order for an Interac request.':'A verified customer has requested an invoice. Review the order in the payment desk.'):orderManagement?'Your order request is saved. Payment is not due yet; we will send a separate message when the final total is ready.':'Your request is saved. This is not a payment request yet; we will send a separate message when the final invoice is ready.');
 if(n.event_action==='issued')paragraphs.push(orderManagement?'Sign in to review and accept the final order amount. Payment instructions are shown only inside your authenticated account. Do not pay after the deadline or after the order is canceled.':'Sign in to review the final amount and accept the invoice. Payment instructions are shown only inside your authenticated account. Do not pay an expired or void invoice.');
 if(n.event_action==='accepted')paragraphs.push(orderManagement?'The customer accepted the final order amount. Confirm actual receipt in the business bank/provider before recording payment.':'The customer accepted the final invoice. Confirm actual receipt in the business bank/provider before recording payment.');
 if(n.event_action==='payment_recorded')paragraphs.push('PURE has recorded receipt after verification. '+(s.kind==='membership'?'Your nonrenewing annual pass has been activated.':'Your order is ready for manual fulfillment.'));
 if(n.event_action==='full_refund_recorded')paragraphs.push('PURE has recorded a full refund. Redeemed account balances have been restored where applicable. Any pass associated with this order has been revoked. Bank/provider availability times may vary.');
 if(n.event_action==='status_changed')paragraphs.push('The recorded order status is '+s.status+'.');
 if(amount)paragraphs.push('Order amount: '+amount);
 if(n.event_action==='issued'&&s.expires_at)paragraphs.push((orderManagement?'Payment deadline: ':'Invoice expiry: ')+s.expires_at);
 if(n.event_action==='status_changed'&&s.status==='shipped'&&s.tracking_number)paragraphs.push('Carrier: '+s.tracking_carrier+' | Tracking: '+s.tracking_number);
 paragraphs.push('View the latest status in your account: '+link,'Support: support@getpurelabs.com','This is a transactional update, not a marketing subscription.');
 const paymentStatus=s.status==='refunded'?'Refunded':['paid','processing','shipped','delivered'].includes(s.status)?'Paid':['requested','issued','accepted'].includes(s.status)?'Pending':'Not confirmed';
 const summary=orderSummary({orderNumber:ref,paymentStatus,orderStatus:String(s.status||'Unknown').replace(/_/g,' '),customerEmail:s.customer_email,orderUrl:link,actionLabel:admin?(orderManagement?'Open Orders':'Open secure payment desk'):'View secure order'});
 const html=emailLayout({label:admin?(orderManagement?'Order management update':'Payment desk update'):'Order update',
  body:'<h2 style="margin:0 0 16px;font-size:24px;line-height:1.25;letter-spacing:-.02em;">'+esc(title)+'</h2>'+paragraphs.slice(2,-3).map(p=>'<p style="margin:0 0 12px;line-height:1.6;color:#444444;">'+esc(p)+'</p>').join('')+summary+'<p style="margin:0;font-size:12px;color:#666666;">Sign in to view current information. Payment instructions are never included in this email.</p>',
  footer:'This is a transactional update, not a marketing subscription.'});
 return {from:emailSender(env.ORDER_CONFIRMATION_FROM),to:[recipient],reply_to:'support@getpurelabs.com',subject:'PURE — '+title+' — '+ref,
 text:paragraphs.join('\n\n'),html};
}
async function dispatch(db,{invoiceId=null,limit=4,env=process.env,fetchImpl=fetch,delay=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 const summary={configured:configured(env),attempted:0,accepted:0,failed:0,held:0};
 if(!summary.configured)return summary;
 if(invoiceId&&!UUID.test(invoiceId))throw Error('Invalid invoice filter.');
 let q=db.from('commerce_notifications').select('id,invoice_id,audience,event_action,snapshot').in('state',['queued','failed','sending']).lte('next_attempt_at',new Date().toISOString());
 if(invoiceId)q=q.eq('invoice_id',invoiceId);
 const rows=check(await q.order('created_at',{ascending:true}).order('id',{ascending:true}).limit(Math.max(1,Math.min(10,limit))))||[];
 for(const n of rows){
  if(n.snapshot?.checkout_version&&UUID.test(n.invoice_id||'')){
   try{
    const fetched=await db.from('commerce_invoices').select('request_data,pricing,subtotal_cents,discount_cents,shipping_cents,tax_cents,points_redeemed,credit_redeemed_cents').eq('id',n.invoice_id).maybeSingle();
    if(!fetched.error&&fetched.data)n.detail=fetched.data;
   }catch{}
  }
  const mail=envelope(n,env);if(!mail){summary.held++;continue;}
  const claim=check(await db.rpc('commerce_claim_notification',{p_id:n.id,p_envelope:mail}));
  if(!claim?.claimed){summary.held++;continue;}
  if(summary.attempted)await delay(550);summary.attempted++;
  let outcome='failed',provider=null,error='transport_uncertain';
  try{const r=await fetchImpl('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'altapure-invoice/'+n.id},body:JSON.stringify(claim.envelope),signal:AbortSignal.timeout(8000)});const data=await r.json().catch(()=>null);if(r.ok&&typeof data?.id==='string'){outcome='accepted';provider=data.id;error=null;}else error='provider_http_'+String(r.status||'unknown');}catch{}
  const done=await db.rpc('commerce_finish_notification',{p_id:n.id,p_claim:claim.claim,p_outcome:outcome,p_provider_id:provider,p_error:error});
  if(done.error||done.data!==true)summary.held++;else summary[outcome==='accepted'?'accepted':'failed']++;
 }
 return summary;
}
async function status(db,env){
 const methods=check(await db.from('commerce_payment_methods').select('id,kind,currency,active'))||[];
 const rows=check(await db.from('commerce_notifications').select('id,invoice_id,audience,event_action,state,attempts,last_error,created_at,updated_at').order('created_at',{ascending:false}).limit(100))||[];
 const outstanding=check(await db.from('commerce_invoices').select('id,status').in('status',['requested','issued','accepted']).limit(100))||[];
 return {active_receiving_methods:methods.filter(m=>m.active).length,native_gateway_connected:false,
  email_transport_configured:configured(env),admin_notifications_configured:configured(env)&&EMAIL.test(env.ADMIN_ORDER_EMAIL||''),
  automatic_send:'after_invoice_events',retry_worker_configured:typeof env.COMMERCE_NOTIFICATION_JOB_SECRET==='string'&&env.COMMERCE_NOTIFICATION_JOB_SECRET.length>=32,
  recent_notifications:rows,open_invoices:outstanding.length,
  owner_inputs:methods.some(m=>m.active)?['Confirm actual bank/provider receipt before marking paid.']:['Add a permitted business Interac receiving email and registered payee, business bank instructions, or an approved hosted-payment route.'],
  note:'Configured transport is not proof of inbox delivery. No bank receipt or processor approval can be inferred from email status.'};
}
module.exports={configured,envelope,dispatch,status};
