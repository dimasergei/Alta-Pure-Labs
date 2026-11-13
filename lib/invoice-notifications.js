'use strict';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const EMAIL=/^[^\s@\r\n,;<>]+@[^\s@\r\n,;<>]+\.[^\s@\r\n,;<>]+$/;
const check=r=>{if(r.error)throw Error('Notification storage unavailable.');return r.data;};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function configured(env){return !!env.RESEND_API_KEY&&typeof env.ORDER_CONFIRMATION_FROM==='string'&&env.ORDER_CONFIRMATION_FROM.length>3;}
function checkoutEnvelope(n,env){
 const snapshot=n.snapshot,admin=n.audience==='admin',to=admin?env.ADMIN_ORDER_EMAIL:snapshot.customer_email;
 if(!EMAIL.test(to||'')||!UUID.test(snapshot.id||''))return null;
 const ref=require('./order-display').shortOrder(snapshot.id);
 const details=n.detail||{},lines=details.pricing?.lines||details.request_data?.items||[];
 const state=snapshot.status;
 const notificationType=n.event_action==='checkout_placed'?'pending':n.event_action==='payment_recorded'?'confirmation':
   n.event_action==='full_refund_recorded'?'refunded':n.event_action==='status_changed'?
   ({void:'canceled',processing:'processing',shipped:'shipped',delivered:'delivered',refunded:'refunded'}[state]||'processing'):'pending';
 const order={order_number:ref,customer_name:snapshot.customer_name,customer_email:snapshot.customer_email,
  payment_status:state==='accepted'?'pending':state==='void'?'pending':state==='refunded'?'refunded':state==='paid'?'paid':state==='processing'||state==='shipped'||state==='delivered'?'paid':'pending',
  fulfillment_status:state==='void'?'canceled':state==='accepted'?'unfulfilled':state,
  store_order_items:lines.map(x=>({product_name:x.name||'Research product',variant_size:x.size||'',quantity:x.qty||1,unit_price_cents:Math.round((x.line_total_cents??x.gross_cents??((x.unit_price_usd_cents||0)*(x.qty||1)))/(x.qty||1))})),
  subtotal_cents:details.subtotal_cents??snapshot.total_cents,shipping_cents:details.shipping_cents??0,total_cents:snapshot.total_cents,currency:snapshot.currency,
  shipping_name:details.request_data?.name||snapshot.customer_name,shipping_address:details.request_data?.address||{},
  tracking_carrier:snapshot.tracking_carrier,tracking_number:snapshot.tracking_number};
 const mail=require('./customer-order-email').buildStatusEmail({order,notificationType});
 const link='https://altapurelabs.com/'+(admin?'admin-orders.html':'account/purchases?id='+encodeURIComponent(snapshot.id));
 const cta='<p style="margin:28px 0"><a style="display:inline-block;background:#143832;color:white;text-decoration:none;border-radius:8px;padding:12px 20px;font-size:13px;font-weight:bold" href="'+esc(link)+'">View secure order</a></p>';
 return{from:env.ORDER_CONFIRMATION_FROM,to:[to],reply_to:'altapurelabs@protonmail.com',
  subject:(admin?'AltaPure Admin — ':'')+mail.subject,
  text:mail.text+'\\n\\nView order: '+link+'\\nSupport: altapurelabs@protonmail.com',
  html:mail.html.replace('</div>\n    </div>',cta+'</div>\n    </div>')};
}
function envelope(n,env){
 if(n.snapshot?.checkout_version)return checkoutEnvelope(n,env);
 const s=n.snapshot,admin=n.audience==='admin',recipient=admin?env.ADMIN_ORDER_EMAIL:s.customer_email;
 if(!EMAIL.test(recipient||'')||!UUID.test(s.id||''))return null;
 const ref=(s.checkout_version?'ORD-':'INV-')+s.id.toUpperCase(),link='https://altapurelabs.com/'+(admin?'admin-payments.html':'account/purchases?id='+encodeURIComponent(s.id));
 const titles={checkout_placed:admin?'New checkout order':'Order received — payment pending',requested:admin?'New invoice request':'Invoice request received',issued:'Your reviewed invoice is ready',accepted:'Customer accepted an invoice',payment_recorded:'Payment receipt recorded',full_refund_recorded:'Full refund recorded',status_changed:'Order status: '+String(s.status).replace(/_/g,' ')};
 const title=titles[n.event_action]||'Invoice update';
 const amount=Number.isSafeInteger(s.total_cents)&&['USD','CAD'].includes(s.currency)?new Intl.NumberFormat('en-US',{style:'currency',currency:s.currency}).format(s.total_cents/100):null;
 const paragraphs=[title,ref,'Event recorded: '+s.event_at];
 if(n.event_action==='checkout_placed')paragraphs.push('Your order is saved. Sign in for the exact total and payment instructions. A bank transfer remains pending until receipt is confirmed.');
 if(n.event_action==='requested')paragraphs.push(admin?'A verified customer has requested an invoice. Review the order in the payment desk.':'Your request is saved. This is not a payment request yet; we will send a separate message when the final invoice is ready.');
 if(n.event_action==='issued')paragraphs.push('Sign in to review the final amount and accept the invoice. Payment instructions are shown only inside your authenticated account. Do not pay an expired or void invoice.');
 if(n.event_action==='accepted')paragraphs.push('The customer accepted the final invoice. Confirm actual receipt in the business bank/provider before recording payment.');
 if(n.event_action==='payment_recorded')paragraphs.push('AltaPure has recorded receipt after verification. '+(s.kind==='membership'?'Your nonrenewing annual pass has been activated.':'Your order is ready for manual fulfillment.'));
 if(n.event_action==='full_refund_recorded')paragraphs.push('AltaPure has recorded a full refund. Redeemed account balances have been restored where applicable. Any pass associated with this order has been revoked. Bank/provider availability times may vary.');
 if(n.event_action==='status_changed')paragraphs.push('The recorded order status is '+s.status+'.');
 if(amount)paragraphs.push('Order amount: '+amount);
 if(n.event_action==='issued'&&s.expires_at)paragraphs.push('Invoice expiry: '+s.expires_at);
 if(n.event_action==='status_changed'&&s.status==='shipped'&&s.tracking_number)paragraphs.push('Carrier: '+s.tracking_carrier+' | Tracking: '+s.tracking_number);
 paragraphs.push('View the latest status in your account: '+link,'Support: altapurelabs@protonmail.com','This is a transactional update, not a marketing subscription.');
 return {from:env.ORDER_CONFIRMATION_FROM,to:[recipient],reply_to:'altapurelabs@protonmail.com',subject:'AltaPure — '+title+' — '+ref,
 text:paragraphs.join('\n\n'),html:'<!doctype html><html><body style="font-family:Arial,sans-serif;background:#f4f6ef;padding:24px;color:#17382f"><main style="max-width:600px;background:white;padding:28px;margin:auto;border-radius:12px"><h1 style="font-size:22px">AltaPure Labs</h1>'+paragraphs.slice(0,-3).map(p=>'<p style="line-height:1.6">'+esc(p)+'</p>').join('')+'<p><a href="'+esc(link)+'" style="display:inline-block;background:#17382f;color:#fff;padding:14px 22px;border-radius:8px">Open secure '+(admin?'payment desk':'order')+'</a></p><p style="font-size:12px">Sign in to view current information. Payment instructions are never included in this email.</p><p style="font-size:12px">Support: altapurelabs@protonmail.com</p></main></body></html>'};
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
    const fetched=await db.from('commerce_invoices').select('request_data,pricing,subtotal_cents,discount_cents,shipping_cents,tax_cents').eq('id',n.invoice_id).maybeSingle();
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
