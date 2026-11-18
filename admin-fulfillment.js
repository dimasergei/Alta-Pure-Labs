(()=>{'use strict';
const el=(tag,text,cls)=>{const x=document.createElement(tag);if(text!==undefined)x.textContent=String(text);if(cls)x.className=cls;return x};
const cash=(n,c='USD')=>new Intl.NumberFormat('en-US',{style:'currency',currency:c||'USD'}).format((Number(n)||0)/100);
const ref=o=>o.order_number||'AP'+String(o.id).replace(/-/g,'').slice(0,10).toUpperCase();
const type=o=>o.source==='research_subscription'?'Research subscription':o.kind==='membership'?'Membership purchase':o.kind==='bulk'?'Bulk order':o.origin==='research_builder'?'Research Builder product order':o.source==='store'?'Earlier store order':'Product order';
const state=s=>({queued:'Queued',retry:'Retry scheduled',working:'Processing',submitted:'Submitted',blocked:'Needs attention',ordered:'Fulfillment started',accepted:'Awaiting payment',requested:'Pending review',issued:'Payment pending',paid:'Paid',processing:'Processing',awaiting_supplier:'Awaiting fulfillment',unfulfilled:'Unfulfilled',pending:'Pending payment',pending_payment:'Pending payment',active:'Active',past_due:'Past due',cancel_pending:'Cancellation pending',canceled:'Canceled',shipped:'Shipped',delivered:'Delivered',refunded:'Refunded',void:'Canceled'}[s]||String(s||'Pending'));
const orderState=(o,fallback)=>o.cancellation_status==='pending'?'Cancellation pending':o.cancellation_status==='review'?'Cancellation needs payment review':state(fallback||o.status);
const interacRequest=o=>(o.status||o.commerce_status)==='requested'&&o.request_data?.preferred_payment?.provider_key==='interac';
const requestEstimate=o=>o.request_data?.checkout?.usd_estimate;
const priorityOrder=o=>o.source==='commerce'&&['goods','bulk'].includes(o.kind)&&o.priority_fulfillment===true&&typeof o.membership_invoice_id==='string'
 &&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(o.membership_invoice_id)&&['paid','processing'].includes(o.commerce_status||o.status)&&!o.cancellation_requested_at&&!o.cancellation_status;
const priorityBadge=()=>el('span','PURE BLACK / Priority','uc-priority-badge');
let api,root,dlg,orders=[],paging={},page=1,query='',sort='fulfillment_priority',filter='all',epoch=0,poll,timer;
const lotus=(view,more='')=>'/api/customer-config?lotus=admin&view='+view+more;
const send=(url,body,method='POST')=>api(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const write=b=>send(lotus('write'),b);
function msg(text,bad=false){const x=(dlg?.open?dlg:root)?.querySelector('[data-unified-message]');if(x){x.textContent=text;x.classList.toggle('failed',bad)}}
function btn(text,action,cls='ghost'){const x=el('button',text,cls);x.type='button';x.onclick=async()=>{x.disabled=true;try{await action()}catch(e){msg(e.message,true)}finally{x.disabled=false}};return x}
function field(k,v){const x=el('div',undefined,'uc-field');x.append(el('span',k),el('strong',v===undefined||v===null||v===''?'—':v));return x}
function input(f,title,name,value='',required=false){const label=el('label',title,'uc-input-field'),x=el('input');x.name=name;x.value=value??'';x.required=required;label.append(x);f.append(label);return x}
function select(f,title,name,options,value){const label=el('label',title,'uc-input-field'),x=el('select');x.name=name;for(const [key,text]of options){const o=el('option',text);o.value=key;x.append(o)}if(value!==undefined)x.value=value;label.append(x);f.append(label);return x}
function form(title,host){const f=el('form',undefined,'uc-action-form');f.append(el('h4',title));host.append(f);return f}
function submit(f,text,action){const x=el('button',text,'primary');x.type='submit';f.append(x);f.onsubmit=async ev=>{ev.preventDefault();x.disabled=true;try{await action()}catch(e){msg(e.message,true)}finally{x.disabled=false}}}
const when=t=>t?new Date(t).toLocaleString():'—';
const address=a=>[a?.line1,a?.line2,[a?.city,a?.region||a?.state,a?.postal_code].filter(Boolean).join(', '),a?.country].filter(Boolean).join(' · ');
function close(){epoch++;clearInterval(poll);clearTimeout(timer);dlg?.remove();dlg=null;root?.replaceChildren();root=null;api=null;orders=[]}
function rows(){const host=root?.querySelector('[data-unified-list]');if(!host)return;host.replaceChildren();const list=orders;
 if(!list.length){host.append(el('p','No matching checkout orders or subscriptions.','uc-empty'));return}
 for(const o of list){const card=el('article',undefined,'uc-order-row'),identity=el('div',undefined,'uc-order-identity'),sum=el('div',undefined,'uc-order-total');
  identity.append(el('strong',ref(o)),el('small',type(o)+' · '+when(o.created_at)),el('span',o.customer_name||o.customer_email||'Unknown customer'));
  if(priorityOrder(o))identity.append(priorityBadge());
  const pendingCad=interacRequest(o),estimate=requestEstimate(o);
  sum.append(el('strong',pendingCad?'CAD quote pending':cash(o.total_cents,o.currency)+(o.source==='research_subscription'?'/mo':'')),el('small',pendingCad&&Number.isSafeInteger(estimate?.total_cents)?cash(estimate.total_cents,'USD')+' USD estimate':orderState(o,o.source==='research_subscription'?o.research_status:o.source==='commerce'?o.commerce_status:o.fulfillment_status)));
  card.append(identity,sum,btn(o.source==='research_subscription'?'View subscription':pendingCad?'Review CAD order':'Manage order',()=>detail(o),'primary'));host.append(card)}
}
async function load(){if(!api||!root)return;const ticket=++epoch,params=new URLSearchParams({status:'all',page:String(page),page_size:'25',sort,search:query,type:filter});
 try{const result=await api('/api/admin-orders?'+params);if(ticket!==epoch)return;orders=result.orders||[];paging=result.pagination||{};const count=document.getElementById('orders-message');if(count)count.textContent=(paging.total||0)+' orders · use Manage order for payment and fulfillment';root.replaceChildren();
  const head=el('div',undefined,'uc-header');head.append(el('h2','Orders'),btn('Refresh',load));root.append(head);
  const tools=el('div',undefined,'uc-search'),q=el('input');q.type='search';q.placeholder='Search orders or customers';q.setAttribute('aria-label','Search orders');q.value=query;
  q.oninput=()=>{query=q.value;page=1;clearTimeout(timer);timer=setTimeout(()=>{const focused=document.activeElement===q,pos=q.selectionStart;load().then(()=>{if(focused){const replacement=root?.querySelector('.uc-search input');replacement?.focus();replacement?.setSelectionRange(pos,pos)}})},300)};
  const sorting=el('select');for(const [v,t]of [['fulfillment_priority','Fulfillment priority'],['newest','Newest first'],['oldest','Oldest first'],['highest_total','Highest total']]){const option=el('option',t);option.value=v;sorting.append(option)}sorting.value=sort;sorting.setAttribute('aria-label','Sort orders');sorting.onchange=()=>{sort=sorting.value;page=1;load()};
  const types=el('select');for(const [v,t]of [['all','All types'],['goods','Product orders'],['bulk','Bulk orders'],['membership','Membership purchases']]){const option=el('option',t);option.value=v;types.append(option)}types.value=filter;types.setAttribute('aria-label','Filter order type');types.onchange=()=>{filter=types.value;page=1;load()};
  tools.append(q,sorting,types);root.append(tools);const notice=el('p','','uc-message');notice.setAttribute('data-unified-message','');notice.setAttribute('role','status');root.append(notice);
  const list=el('div',undefined,'uc-list');list.setAttribute('data-unified-list','');root.append(list);rows();
  const pager=el('div',undefined,'uc-pager'),prev=btn('Previous',()=>{page--;return load()}),next=btn('Next',()=>{page++;return load()});prev.disabled=!paging.has_previous;next.disabled=!paging.has_next;
  pager.append(prev,el('span',`Page ${page} · ${paging.total||0} records`),next);root.append(pager);
 }catch(e){if(ticket===epoch){root.replaceChildren(el('p',e.message,'uc-message failed'),btn('Retry',load))}}}
async function reload(o){await load();await detail(o.id)}
async function detail(record){let row=typeof record==='object'?record:orders.find(o=>o.id===record);
 if(!row){const result=await api('/api/admin-orders?'+new URLSearchParams({status:'all',search:String(record),page_size:'5'}));row=result.orders?.find(o=>o.id===record)}
 if(!row)throw Error('Order unavailable. Refresh the list.');const ticket=epoch;
 const data=row.source==='commerce'?await api(lotus('detail','&id='+encodeURIComponent(row.id))):{order:row,allocations:[],jobs:[]};if(ticket!==epoch)return;const o=data.order;
 if(!dlg){dlg=el('dialog');dlg.className='fh-dialog uc-dialog';document.body.append(dlg)}dlg.replaceChildren();
 const head=el('div',undefined,'uc-dialog-head'),title=el('div');title.append(el('h2',ref(row)),el('small',type(row)+' · '+orderState(o,o.status||row.research_status||row.fulfillment_status)));if(priorityOrder({...row,...o,commerce_status:o.status||row.commerce_status}))title.append(priorityBadge());head.append(title,btn('Close',()=>dlg.close()));dlg.append(head);
 const notice=el('p','','uc-message');notice.setAttribute('data-unified-message','');notice.setAttribute('role','status');dlg.append(notice);
 const pendingCad=interacRequest(o),estimate=requestEstimate(o);
 const info=el('section',undefined,'uc-info');info.append(field('Customer',o.customer_name||row.customer_name),field('Email',o.customer_email||row.customer_email),field('Payment',pendingCad?'CAD order review pending':orderState(o,row.payment_status)),field('Fulfillment',row.source==='research_subscription'?state(row.research_status):orderState(o,o.status||row.fulfillment_status)),field(pendingCad?'USD request estimate':'Total',pendingCad?(Number.isSafeInteger(estimate?.total_cents)?cash(estimate.total_cents,'USD')+' USD':'Awaiting CAD quote'):cash(o.total_cents??row.total_cents,o.currency||row.currency)+(row.source==='research_subscription'?'/mo':'')),field('Placed',when(o.created_at||row.created_at)));
 if(row.organization)info.append(field('Organization',row.organization));
 if(row.source==='commerce'&&o.payment_snapshot?.label)info.append(field('Payment method',o.payment_snapshot.label));
 if(row.kind==='membership')info.append(field('Membership plan',({vip:'PURE WHITE',elite:'PURE BLACK'})[o.plan||row.plan]||'Membership'),field('Term',o.request_data?.billing_period==='annual'?'12 months prepaid':o.request_data?.billing_period==='monthly'?'1 month prepaid':'View purchase terms'));
 if(row.source==='research_subscription')info.append(field('Paid cycles',row.paid_cycles),field('Next billing',when(row.next_billing_at)));dlg.append(info);
 const items=el('section',undefined,'uc-items');items.append(el('h3',row.source==='research_subscription'?'Subscription items':'Order items'));
 const lines=row.source==='commerce'?(o.pricing?.lines||o.request_data?.items||[]):row.source==='research_subscription'?(row.lines||[]):row.store_order_items||[];
 for(const line of lines){const item=el('div',undefined,'uc-item'),name=line.name||line.product_name||line.id||'Product',size=line.size||line.variant_size||'',qty=line.qty||line.quantity||1;
  const description=[name+(size?' · '+size:'')+' × '+qty,row.source==='store'&&line.lot_number?'Lot: '+line.lot_number:''].filter(Boolean).join(' — ');
  item.append(el('span',description));const cents=line.line_total_cents??line.gross_cents??(line.unit_price_cents!=null?line.unit_price_cents*qty:pendingCad&&Number.isSafeInteger(line.unit_price_usd_cents)?line.unit_price_usd_cents*qty:null);if(cents!==null)item.append(el('strong',cash(cents,pendingCad?'USD':o.currency||row.currency)+(pendingCad?' USD':'')));items.append(item);
 }dlg.append(items);
 if(row.source!=='research_subscription'&&!pendingCad){const totals=el('section',undefined,'uc-total');totals.append(field('Subtotal',cash(o.subtotal_cents??row.subtotal_cents,o.currency||row.currency)),field('Discounts','−'+cash(o.discount_cents??row.discount_cents,o.currency||row.currency)),field('Shipping',cash(o.shipping_cents??row.shipping_cents,o.currency||row.currency)),field('Tax',cash(o.tax_cents??row.tax_cents,o.currency||row.currency)),field('Total',cash(o.total_cents??row.total_cents,o.currency||row.currency)));dlg.append(totals)}
 const addr=row.source==='commerce'?o.kind==='goods'?o.request_data?.address:null:row.shipping_address;if(addr&&Object.keys(addr).length)dlg.append(el('p','Ship to: '+address(addr),'uc-address'));
 if(o.tracking_number||row.tracking_number)dlg.append(el('p','Tracking: '+(o.tracking_carrier||row.tracking_carrier||'')+' '+(o.tracking_number||row.tracking_number),'uc-address'));
 if(row.source==='store'&&Array.isArray(row.internal_status_history)&&row.internal_status_history.length){
  const history=el('section',undefined,'uc-history');history.append(el('h3','Status history'));
  for(const change of row.internal_status_history)history.append(el('p',`${state(change.from)} → ${state(change.to)} · ${when(change.at)}`,'uc-hint'));
  dlg.append(history)}
 const actions=el('section',undefined,'uc-actions');actions.append(el('h3',row.source==='research_subscription'?'Subscription record':'Manage order'));dlg.append(actions);
 if(row.source==='commerce')commerceActions(actions,row,data);else if(row.source==='store')legacyActions(actions,row);else actions.append(el('p','Read-only record. Recurring checkout is unavailable; no new subscription can be purchased. Saved research lists are not orders.','uc-hint'));
 if(row.source==='commerce')historySection(dlg,data.history||[]);if(!dlg.open)dlg.showModal()}
async function downloadSheet(row,format){
 const params=new URLSearchParams({view:'fulfillment-sheet',id:row.id,source:row.source,format});
 const file=await api('/api/admin-orders?'+params,{responseType:'blob'}),url=URL.createObjectURL(file),a=el('a');
 a.href=url;a.download='fulfillment-'+ref(row)+'.'+format;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
 msg('Fulfillment sheet downloaded. The order status is unchanged.');
}
function exportSection(host,row,o){const box=el('section',undefined,'uc-export');box.append(el('h4','Fulfillment sheet'),el('p','Download the order reference, recipient, products, quantities, and delivery details in a reusable PURE template.','uc-hint'));
 if(!['paid','processing'].includes(o.status||row.payment_status))box.append(el('p','This sheet is marked HOLD / DO NOT SHIP until the order is ready for fulfillment.','uc-hint'));
 const buttons=el('div',undefined,'uc-button-row');buttons.append(btn('Download PDF',()=>downloadSheet(row,'pdf'),'primary'),btn('Download CSV',()=>downloadSheet(row,'csv')));box.append(buttons);host.append(box)}
function historySection(host,changes){const box=el('details',undefined,'uc-history');box.append(el('summary','Activity history'));
 if(!changes.length)box.append(el('p','No activity recorded.','uc-hint'));
 for(const change of changes){const item=el('div',undefined,'uc-history-item'),routing=/supplier|lotus|purity|fulfillment_(?:assign|retry|takeover)/i.test(String(change.action||'')),action=routing?'Fulfillment record updated':String(change.action||'Updated').replace(/_/g,' ');item.append(el('strong',action),el('small',when(change.created_at)+' · '+(routing?'fulfillment':change.actor||'system')));
  if(routing){box.append(item);continue}
  if(change.from||change.to)item.append(el('p',[change.from&&state(change.from),change.to&&state(change.to)].filter(Boolean).join(' → ')));
  if(change.note)item.append(el('p',change.note));if(change.reference)item.append(el('p','Reference: '+change.reference));box.append(item)}host.append(box)}
function commerceActions(host,row,data){const o=data.order,id=o.id,allocations=data.allocations||[],job=data.jobs?.[0];
 const pay=el('section',undefined,'uc-payment');pay.append(el('h3','Payment'));
 if(interacRequest(o)){
  if(window.PureInteracInvoiceAdmin)window.PureInteracInvoiceAdmin.mount({host:pay,order:o,api,onRefresh:()=>reload(row),onIssued:async()=>{await reload(row);msg('CAD order total prepared. The customer must accept it before viewing Interac payment instructions.')}});
  else pay.append(el('p','CAD order review is unavailable. Refresh the Orders page and try again.','uc-hint'));
 }
 else if(data.manual_payment_allowed){const f=form('Confirm received bank payment',pay);f.append(el('p',o.kind==='membership'?'Verify that the full amount has arrived before confirming payment and activating this prepaid membership.':'Verify that the full amount has arrived before confirming payment and preparing this order for fulfillment.','uc-hint'));
  f.append(field('Amount to verify',cash(o.total_cents,o.currency)),field('Method',data.payment_method?.label||o.payment_snapshot?.label));
  const reference=input(f,'Bank transaction reference','bank_reference','',true);reference.minLength=8;reference.maxLength=150;
  const check=el('label',undefined,'uc-check'),yes=el('input');yes.type='checkbox';yes.required=true;check.append(yes,el('span','I verified the full amount has arrived in the receiving account.'));f.append(check);
  const receipt=crypto.randomUUID();submit(f,'Mark payment received',async()=>{if(!yes.checked)throw Error('Verify received funds first.');if(!window.confirm('Confirm '+cash(o.total_cents,o.currency)+' was received? '+(o.kind==='membership'?'This activates the prepaid membership.':'This makes the order available for fulfillment.')))return;
   const result=await write({action:'record_payment',id,expected_version:o.version,method_id:o.method_id,receipt_id:receipt,external_reference:reference.value,confirm_funds_received:true});await reload(row);msg(o.kind==='membership'?'Payment recorded. The prepaid membership is active.':'Payment recorded. The fulfillment sheet is ready to review.')})}
 else if(['accepted','requested','issued'].includes(o.status))pay.append(el('p',o.kind==='membership'?'Awaiting confirmed payment. Membership benefits stay inactive until payment is verified.':'Awaiting confirmed payment. Shipping stays on hold until this payment is reconciled through its provider.','uc-hint'));
 else pay.append(el('p',o.paid_at?'Payment received '+when(o.paid_at)+'.':state(o.status)+'.','uc-hint'));
 if(o.cancellation_status==='pending')pay.append(el('p','Cancellation requested. Checkout and fulfillment are on hold while the wallet authorization expires and payment is checked automatically. Do not send payment.','uc-hint'));
 if(o.cancellation_status==='review')pay.append(el('p','A crypto transfer was received after cancellation was requested. Fulfillment remains on hold. Review the verified payment and arrange any refund before resolving this order.','uc-hint'));
 if(o.status==='accepted'&&o.cancellation_status!=='review')pay.append(btn(o.cancellation_status==='pending'?'Check cancellation':'Cancel unpaid order',async()=>{if(!o.cancellation_status&&!window.confirm('Cancel '+ref(row)+'? Verify no payment was sent.'))return;const result=await write({action:'cancel_order',id,confirm_unpaid:true});if(result.status==='void'){dlg.close();await load();msg(ref(row)+' canceled. No refund was issued.')}else if(['pending','review'].includes(result.cancellation_status)){await reload(row);msg(result.cancellation_status==='pending'?'Cancellation requested. Payment checks continue automatically; do not send payment.':'Payment received. Cancellation needs review; fulfillment remains on hold.')}else throw Error('Cancellation was not confirmed.')},'uc-danger'));
 host.append(pay);
 if(o.kind==='goods'){
  exportSection(host,row,o);
  const shipment=el('section',undefined,'uc-shipment');shipment.append(el('h3','Shipping and delivery'));
  const manual=allocations.length>0&&allocations.every(a=>a.route==='manual'),remote=!!(job?.supplier_id||job?.has_payload||['working','submitted','shipped'].includes(job?.status)),unresolved=remote&&!(job?.status==='cancelled'&&job?.provider_status==='cancelled');
  const options=[];if(o.status==='paid')options.push(['processing','Processing']);
  if(manual&&!unresolved&&['paid','processing'].includes(o.status))options.push(['shipped','Shipped']);
  if(o.status==='shipped')options.push(['delivered','Delivered']);
  if(options.length){const f=form('Update complete order',shipment),next=select(f,'Next status','status',options),carrier=input(f,'Carrier','carrier',o.tracking_carrier),tracking=input(f,'Tracking number','tracking',o.tracking_number),note=input(f,'Audit note','note','',true);note.minLength=8;
   submit(f,'Save fulfillment status',async()=>{if(next.value==='shipped'&&(!carrier.value.trim()||!tracking.value.trim()))throw Error('Carrier and tracking required before shipment.');await write({action:'update_order',id,version:o.version,status:next.value,note:note.value,tracking_carrier:carrier.value,tracking_number:tracking.value});await reload(row)})}
  if(manual&&['shipped','delivered'].includes(o.status)){const f=form('Correct shipment tracking',shipment),carrier=input(f,'Carrier','carrier',o.tracking_carrier,true),tracking=input(f,'Tracking number','tracking',o.tracking_number,true),note=input(f,'Reason for correction','note','',true);note.minLength=8;
   submit(f,'Save tracking correction',async()=>{await write({action:'update_tracking',id,version:o.version,tracking_carrier:carrier.value,tracking_number:tracking.value,note:note.value});await reload(row)})}
  if(!allocations.length)shipment.append(el('p','Shipment controls become available after payment is confirmed.','uc-hint'));
  else if(!manual&&!['shipped','delivered','void','refunded'].includes(o.status))shipment.append(el('p','An existing fulfillment record needs review. Resolve it before recording another shipment.','uc-hint'));
  if(['paid','processing'].includes(o.status)&&!remote){const f=form('Edit shipping address',shipment),addr=o.request_data?.address||{},fields={};
   for(const [title,key]of [['Street','line1'],['Address line 2','line2'],['City','city'],['State / province','region'],['Postal code','postal_code'],['Country code','country']])fields[key]=input(f,title,key,addr[key]||'',key!=='line2');
   fields.country.readOnly=true;const note=input(f,'Reason for address change','note','',true);note.minLength=8;
   submit(f,'Save address',async()=>{const address=Object.fromEntries(Object.entries(fields).map(([key,control])=>[key,control.value]));await write({action:'edit_shipping',id,version:o.version,address,note:note.value});await reload(row)})}
  else if(remote&&['paid','processing'].includes(o.status))shipment.append(el('p','Fulfillment has already started. Review the existing shipment before changing its destination.','uc-hint'));host.append(shipment);window.PureShippingLabels?.mount({host,row,api})}
 if(['paid','processing','shipped','delivered'].includes(o.status)){const advanced=el('details',undefined,'uc-history');advanced.append(el('summary','Refund management'));host.append(advanced);const f=form('Record a completed full refund',advanced);f.append(el('p','Complete and verify the refund with the provider first. This records it; it does not return funds.','uc-hint'));
  const transaction=input(f,'Provider refund transaction ID','external_reference','',true);transaction.minLength=8;const check=el('label',undefined,'uc-check'),yes=el('input');yes.type='checkbox';yes.required=true;check.append(yes,el('span','I verified the full external refund.'));f.append(check);
  submit(f,'Record verified refund',async()=>{if(!window.confirm('Record the completed external refund? This does not send money.'))return;await write({action:'record_verified_refund',id,version:o.version,confirm_external_refund:true,external_reference:transaction.value});await reload(row)})}
 if(o.status==='void')host.append(el('p','Canceled. Reconcile any late payment before refund or fulfillment.','uc-hint'));
 if(o.status==='refunded')host.append(el('p','Full external refund recorded.','uc-hint'));
 if(o.kind==='membership'&&o.status==='paid')host.append(el('p','Membership purchase recorded. No shipping workflow applies.','uc-hint'))}
function legacyActions(host,o){exportSection(host,o,o);window.PureShippingLabels?.mount({host,row:o,api});host.append(el('p','Earlier store order. Canceling fulfillment does not issue a refund or stop a provider payment.','uc-hint'));
 const transitions={unfulfilled:['processing','awaiting_supplier','canceled'],processing:['awaiting_supplier','partially_shipped','shipped'],awaiting_supplier:['processing','partially_shipped','shipped'],partially_shipped:['shipped'],shipped:['delivered']};
 const allowed=(transitions[o.fulfillment_status]||[]).filter(x=>!['processing','awaiting_supplier','partially_shipped','shipped','delivered'].includes(x)||['paid','partially_refunded'].includes(o.payment_status));
 const f=form('Update order details',host),next=select(f,'Fulfillment status','fulfillment_status',[[o.fulfillment_status,state(o.fulfillment_status)],...allowed.map(x=>[x,state(x)])]),priority=select(f,'Priority','priority',[['low','Low'],['normal','Normal'],['high','High']],o.priority||'normal'),carrier=input(f,'Carrier','tracking_carrier',o.tracking_carrier||''),tracking=input(f,'Tracking number','tracking_number',o.tracking_number||''),notes=input(f,'Internal notes','admin_notes',o.admin_notes||'');
 submit(f,'Save order',async()=>{if(next.value==='canceled'&&!window.confirm('Cancel fulfillment for '+ref(o)+'? No refund or payment cancellation will be issued.'))return;
  const result=await send('/api/admin-orders',{action:'update',order_id:o.id,fulfillment_status:next.value,priority:priority.value,tracking_carrier:carrier.value,tracking_number:tracking.value,admin_notes:notes.value},'PATCH');await load();await detail(result.order?.id||o.id);
  if(result.notification?.status==='failed')msg(result.notification.error||'Order saved, but customer notification failed.',true)})}
window.AltaFulfillment={manage:detail,mount(fn){api=fn;root=document.getElementById('fulfillment-hub');clearInterval(poll);poll=setInterval(()=>{if(root&&!document.hidden&&!dlg?.open&&!root.contains(document.activeElement))load()},60000);load()},refresh:load,clear:close,openPayments(){},paymentDesk(){}};
})();
