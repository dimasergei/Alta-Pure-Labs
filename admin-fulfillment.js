(()=>{'use strict';
const el=(tag,text,cls)=>{const x=document.createElement(tag);if(text!==undefined)x.textContent=String(text);if(cls)x.className=cls;return x};
const cash=(n,c='USD')=>new Intl.NumberFormat('en-US',{style:'currency',currency:c||'USD'}).format((Number(n)||0)/100);
const ref=o=>o.order_number||'AP'+String(o.id).replace(/-/g,'').slice(0,10).toUpperCase();
const type=o=>o.source==='research_subscription'?'Research subscription':o.kind==='membership'?'Membership purchase':o.kind==='bulk'?'Bulk order':o.origin==='research_builder'?'Research Builder product order':o.source==='store'?'Earlier store order':'Product order';
const state=s=>({queued:'Queued for Lotus',retry:'Retry scheduled',working:'Sync in progress',submitted:'Sent to Lotus',blocked:'Needs attention',ordered:'Ordered from supplier',accepted:'Awaiting payment',requested:'Pending review',issued:'Payment pending',paid:'Paid',processing:'Processing',awaiting_supplier:'Awaiting supplier',unfulfilled:'Unfulfilled',pending:'Pending payment',pending_payment:'Pending payment',active:'Active',past_due:'Past due',cancel_pending:'Cancellation pending',canceled:'Canceled',shipped:'Shipped',delivered:'Delivered',refunded:'Refunded',void:'Canceled'}[s]||String(s||'Pending'));
let api,root,dlg,orders=[],paging={},page=1,query='',sort='newest',filter='all',epoch=0,poll,timer;
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
  sum.append(el('strong',cash(o.total_cents,o.currency)+(o.source==='research_subscription'?'/mo':'')),el('small',state(o.source==='research_subscription'?o.research_status:o.source==='commerce'?o.commerce_status:o.fulfillment_status)));
  card.append(identity,sum,btn(o.source==='research_subscription'?'View subscription':'Manage order',()=>detail(o),'primary'));host.append(card)}
}
async function load(){if(!api||!root)return;const ticket=++epoch,params=new URLSearchParams({status:'all',page:String(page),page_size:'25',sort,search:query,type:filter});
 try{const result=await api('/api/admin-orders?'+params);if(ticket!==epoch)return;orders=result.orders||[];paging=result.pagination||{};const count=document.getElementById('orders-message');if(count)count.textContent=(paging.total||0)+' orders · use Manage order for payment and fulfillment';root.replaceChildren();
  const head=el('div',undefined,'uc-header');head.append(el('h2','Orders'),btn('Refresh',load));root.append(head);
  const tools=el('div',undefined,'uc-search'),q=el('input');q.type='search';q.placeholder='Search orders or customers';q.setAttribute('aria-label','Search orders');q.value=query;
  q.oninput=()=>{query=q.value;page=1;clearTimeout(timer);timer=setTimeout(()=>{const focused=document.activeElement===q,pos=q.selectionStart;load().then(()=>{if(focused){const replacement=root?.querySelector('.uc-search input');replacement?.focus();replacement?.setSelectionRange(pos,pos)}})},300)};
  const sorting=el('select');for(const [v,t]of [['newest','Newest first'],['oldest','Oldest first'],['highest_total','Highest total']]){const option=el('option',t);option.value=v;sorting.append(option)}sorting.value=sort;sorting.setAttribute('aria-label','Sort orders');sorting.onchange=()=>{sort=sorting.value;page=1;load()};
  const types=el('select');for(const [v,t]of [['all','All types'],['goods','Product orders'],['bulk','Bulk orders'],['membership','Membership purchases'],['research_subscription','Research subscriptions']]){const option=el('option',t);option.value=v;types.append(option)}types.value=filter;types.setAttribute('aria-label','Filter order type');types.onchange=()=>{filter=types.value;page=1;load()};
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
 const head=el('div',undefined,'uc-dialog-head'),title=el('div');title.append(el('h2',ref(row)),el('small',type(row)+' · '+state(o.status||row.research_status||row.fulfillment_status)));head.append(title,btn('Close',()=>dlg.close()));dlg.append(head);
 const notice=el('p','','uc-message');notice.setAttribute('data-unified-message','');notice.setAttribute('role','status');dlg.append(notice);
 const info=el('section',undefined,'uc-info');info.append(field('Customer',o.customer_name||row.customer_name),field('Email',o.customer_email||row.customer_email),field('Payment',state(row.payment_status)),field('Fulfillment',row.source==='research_subscription'?state(row.research_status):state(o.status||row.fulfillment_status)),field('Total',cash(o.total_cents??row.total_cents,o.currency||row.currency)+(row.source==='research_subscription'?'/mo':'')),field('Placed',when(o.created_at||row.created_at)));
 if(row.organization)info.append(field('Organization',row.organization));
 if(row.source==='commerce'&&o.payment_snapshot?.label)info.append(field('Payment method',o.payment_snapshot.label));
 if(row.kind==='membership')info.append(field('Membership plan',o.plan||row.plan));
 if(row.source==='research_subscription')info.append(field('Paid cycles',row.paid_cycles),field('Next billing',when(row.next_billing_at)));dlg.append(info);
 const items=el('section',undefined,'uc-items');items.append(el('h3',row.source==='research_subscription'?'Subscription items':'Order items'));
 const lines=row.source==='commerce'?(o.pricing?.lines||o.request_data?.items||[]):row.source==='research_subscription'?(row.lines||[]):row.store_order_items||[];
 for(const line of lines){const item=el('div',undefined,'uc-item'),name=line.name||line.product_name||line.id||'Product',size=line.size||line.variant_size||'',qty=line.qty||line.quantity||1;
  const description=[name+(size?' · '+size:'')+' × '+qty,row.source==='store'?[line.supplier_name,line.supplier_sku,line.lot_number].filter(Boolean).join(' · '):''].filter(Boolean).join(' — ');
  item.append(el('span',description));const cents=line.line_total_cents??line.gross_cents??(line.unit_price_cents!=null?line.unit_price_cents*qty:null);if(cents!==null)item.append(el('strong',cash(cents,o.currency||row.currency)));items.append(item);
  if(row.source==='store'&&line.fulfillment_notes)items.append(el('small',line.fulfillment_notes,'uc-hint'))}dlg.append(items);
 if(row.source!=='research_subscription'){const totals=el('section',undefined,'uc-total');totals.append(field('Subtotal',cash(o.subtotal_cents??row.subtotal_cents,o.currency||row.currency)),field('Discounts','−'+cash(o.discount_cents??row.discount_cents,o.currency||row.currency)),field('Shipping',cash(o.shipping_cents??row.shipping_cents,o.currency||row.currency)),field('Tax',cash(o.tax_cents??row.tax_cents,o.currency||row.currency)),field('Total',cash(o.total_cents??row.total_cents,o.currency||row.currency)));dlg.append(totals)}
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
 msg('Supplier sheet downloaded. No fulfillment request was sent.');
}
function exportSection(host,row,o){const box=el('section',undefined,'uc-export');box.append(el('h4','Supplier fulfillment sheet'),el('p','Recipient, address, exact products and quantities, supplier mapping, and shipping instructions. Customer pricing and payment instructions are excluded.','uc-hint'));
 if(!['paid','processing'].includes(o.status||row.payment_status))box.append(el('p','This sheet is marked HOLD / DO NOT SHIP until the order is ready for fulfillment.','uc-hint'));
 const buttons=el('div',undefined,'uc-button-row');buttons.append(btn('Download PDF',()=>downloadSheet(row,'pdf'),'primary'),btn('Download CSV',()=>downloadSheet(row,'csv')));box.append(buttons);host.append(box)}
function historySection(host,changes){const box=el('details',undefined,'uc-history');box.append(el('summary','Activity history'));
 if(!changes.length)box.append(el('p','No activity recorded.','uc-hint'));
 for(const change of changes){const item=el('div',undefined,'uc-history-item'),action=String(change.action||'Updated').replace(/_/g,' ');item.append(el('strong',action),el('small',when(change.created_at)+' · '+(change.actor||'system')));
  if(change.from||change.to)item.append(el('p',[change.from&&state(change.from),change.to&&state(change.to)].filter(Boolean).join(' → ')));
  if(change.note)item.append(el('p',change.note));if(change.reference)item.append(el('p','Reference: '+change.reference));box.append(item)}host.append(box)}
function commerceActions(host,row,data){const o=data.order,id=o.id,allocations=data.allocations||[],job=data.jobs?.[0];
 const pay=el('section',undefined,'uc-payment');pay.append(el('h3','Payment'));
 if(data.manual_payment_allowed){const f=form('Confirm received bank payment',pay);f.append(el('p','Record only funds that have actually arrived. Confirming payment makes the order eligible for fulfillment and may send it to Lotus.','uc-hint'));
  f.append(field('Amount to verify',cash(o.total_cents,o.currency)),field('Method',data.payment_method?.label||o.payment_snapshot?.label));
  const reference=input(f,'Bank transaction reference','bank_reference','',true);reference.minLength=8;reference.maxLength=150;
  const check=el('label',undefined,'uc-check'),yes=el('input');yes.type='checkbox';yes.required=true;check.append(yes,el('span','I verified the full amount has arrived in the receiving account.'));f.append(check);
  const receipt=crypto.randomUUID();submit(f,'Mark payment received',async()=>{if(!yes.checked)throw Error('Verify received funds first.');if(!window.confirm('Confirm '+cash(o.total_cents,o.currency)+' was received? This can start supplier fulfillment.'))return;
   const result=await write({action:'record_payment',id,expected_version:o.version,method_id:o.method_id,receipt_id:receipt,external_reference:reference.value,confirm_funds_received:true});await reload(row);msg('Payment recorded. '+(result.supplier?.error?'Supplier sync needs attention; inspect the fulfillment status.':'Supplier fulfillment status is shown below.'))})}
 else if(['accepted','requested','issued'].includes(o.status))pay.append(el('p','Awaiting confirmed payment. Shipping and supplier submission stay on hold. This payment method must be reconciled through its provider.','uc-hint'));
 else pay.append(el('p',o.paid_at?'Payment received '+when(o.paid_at)+'.':state(o.status)+'.','uc-hint'));
 if(o.status==='accepted')pay.append(btn('Cancel unpaid order',async()=>{if(!window.confirm('Cancel '+ref(row)+'? Verify no payment was sent.'))return;const result=await write({action:'cancel_order',id,confirm_unpaid:true});if(result.status!=='void')throw Error('Cancellation was not confirmed.');dlg.close();await load();msg(ref(row)+' canceled. No refund was issued.')},'uc-danger'));
 host.append(pay);
 if(o.kind==='goods'){
  exportSection(host,row,o);supplierActions(host,row,data);
  const shipment=el('section',undefined,'uc-shipment');shipment.append(el('h3','Shipping and delivery'));
  const manual=allocations.length>0&&allocations.every(a=>a.route==='manual'),remote=!!(job?.supplier_id||job?.has_payload||['working','submitted','shipped'].includes(job?.status)),unresolved=remote&&!(job?.status==='cancelled'&&job?.provider_status==='cancelled');
  const options=[];if(o.status==='paid')options.push(['processing','Processing']);
  if(manual&&allocations.every(a=>String(a.supplier_name||'').trim().length>=2)&&!unresolved&&['paid','processing'].includes(o.status))options.push(['shipped','Shipped']);
  if(o.status==='shipped')options.push(['delivered','Delivered']);
  if(options.length){const f=form('Update complete order',shipment),next=select(f,'Next status','status',options),carrier=input(f,'Carrier','carrier',o.tracking_carrier),tracking=input(f,'Tracking number','tracking',o.tracking_number),note=input(f,'Audit note','note','',true);note.minLength=8;
   submit(f,'Save fulfillment status',async()=>{if(next.value==='shipped'&&(!carrier.value.trim()||!tracking.value.trim()))throw Error('Carrier and tracking required before shipment.');await write({action:'update_order',id,version:o.version,status:next.value,note:note.value,tracking_carrier:carrier.value,tracking_number:tracking.value});await reload(row)})}
  if(manual&&['shipped','delivered'].includes(o.status)){const f=form('Correct shipment tracking',shipment),carrier=input(f,'Carrier','carrier',o.tracking_carrier,true),tracking=input(f,'Tracking number','tracking',o.tracking_number,true),note=input(f,'Reason for correction','note','',true);note.minLength=8;
   submit(f,'Save tracking correction',async()=>{await write({action:'update_tracking',id,version:o.version,tracking_carrier:carrier.value,tracking_number:tracking.value,note:note.value});await reload(row)})}
  if(manual&&allocations.some(a=>String(a.supplier_name||'').trim().length<2))shipment.append(el('p','Assign the complete order to a supplier before recording shipment.','uc-hint'));
  if(!allocations.length)shipment.append(el('p','Shipment controls become available after payment is confirmed.','uc-hint'));
  else if(!manual&&!['shipped','delivered','void','refunded'].includes(o.status))shipment.append(el('p','Lotus shipment status and tracking sync automatically. After Lotus reports shipment, you can confirm delivery here. For a manual supplier, assign the complete order first, then record its tracking here.','uc-hint'));
  if(['paid','processing'].includes(o.status)&&!remote){const f=form('Edit shipping address',shipment),addr=o.request_data?.address||{},fields={};
   for(const [title,key]of [['Street','line1'],['Address line 2','line2'],['City','city'],['State / province','region'],['Postal code','postal_code'],['Country code','country']])fields[key]=input(f,title,key,addr[key]||'',key!=='line2');
   fields.country.readOnly=true;const note=input(f,'Reason for address change','note','',true);note.minLength=8;
   submit(f,'Save address',async()=>{const address=Object.fromEntries(Object.entries(fields).map(([key,control])=>[key,control.value]));await write({action:'edit_shipping',id,version:o.version,address,note:note.value});await reload(row)})}
  else if(remote&&['paid','processing'].includes(o.status))shipment.append(el('p','Supplier processing has started. Coordinate address changes with the supplier.','uc-hint'));host.append(shipment)}
 if(['paid','processing','shipped','delivered'].includes(o.status)){const advanced=el('details',undefined,'uc-history');advanced.append(el('summary','Refund management'));host.append(advanced);const f=form('Record a completed full refund',advanced);f.append(el('p','Complete and verify the refund with the provider first. This records it; it does not return funds.','uc-hint'));
  const transaction=input(f,'Provider refund transaction ID','external_reference','',true);transaction.minLength=8;const check=el('label',undefined,'uc-check'),yes=el('input');yes.type='checkbox';yes.required=true;check.append(yes,el('span','I verified the full external refund.'));f.append(check);
  submit(f,'Record verified refund',async()=>{if(!window.confirm('Record the completed external refund? This does not send money.'))return;await write({action:'record_verified_refund',id,version:o.version,confirm_external_refund:true,external_reference:transaction.value});await reload(row)})}
 if(o.status==='void')host.append(el('p','Canceled. Reconcile any late payment before refund or fulfillment.','uc-hint'));
 if(o.status==='refunded')host.append(el('p','Full external refund recorded.','uc-hint'));
 if(o.kind==='membership'&&o.status==='paid')host.append(el('p','Membership purchase recorded. No shipping workflow applies.','uc-hint'))}
function renderSupplierPreview(host,result){host.replaceChildren();host.append(el('p',result.quote_available?'Current Lotus quote retrieved. No order was submitted.':'No current Lotus quote is available. No order was submitted.','uc-hint'));
 if(result.supplier_total_cents!=null)host.append(field('Current supplier cost',cash(result.supplier_total_cents,'USD')));
 for(const issue of result.issues||[])host.append(el('p',typeof issue==='string'?issue:issue.message,'uc-hint'));
 if(result.comparison?.comparable&&result.comparison.remaining_before_other_costs_cents!=null){host.append(field('Revenue remaining before other costs',cash(result.comparison.remaining_before_other_costs_cents,'USD')));host.append(el('p','Before shipping labels, payment fees, tax and other costs. This is not net profit.','uc-hint'))}
 if(result.mode)host.append(field('Supplier API mode',result.mode));
}
function supplierActions(host,row,data){const allocations=data.allocations||[],job=data.jobs?.[0],o=data.order,box=el('section',undefined,'uc-supplier');box.append(el('h3','Supplier and fulfillment'));
 box.append(field('Supplier job',job?state(job.status)+(job.provider_status?' · '+job.provider_status:''):'No supplier job'),field('Supplier reference',job?.reference));
 if(job?.last_error)box.append(el('p','Supplier issue: '+job.last_error,'uc-hint'));if(job?.tracking_number)box.append(field('Supplier tracking',(job.carrier||'')+' '+job.tracking_number));
 if(!data.supplier_enabled)box.append(el('p','Lotus automatic fulfillment is disabled. Manual supplier assignment remains available.','uc-hint'));
 const preview=el('div',undefined,'uc-preview');box.append(btn('Check Lotus availability & cost',async()=>{preview.replaceChildren(el('p','Checking current supplier availability…','uc-hint'));try{const result=await write({action:'preview_lotus_order',id:o.id});renderSupplierPreview(preview,result)}catch(e){preview.replaceChildren();throw e}}),preview);
 if(!allocations.length){box.append(el('p','Payment is not confirmed. No supplier request has been sent. Once payment is received, eligible US orders go to Lotus; other complete orders require a manual supplier.','uc-hint'));host.append(box);return}
 if(job?.supplier_id){box.append(field('Lotus payment',job.settlement||job.provider_status||'Pending'),field('Supplier amount due',job.owed_total!=null?'$'+job.owed_total+' USD':'—'));
  const portal=el('a','Open Lotus orders','uc-portal');portal.href='https://partners.lotuspeptide.com/orders';portal.target='_blank';portal.rel='noopener noreferrer';box.append(portal);
  box.append(el('p',job.status==='cancelled'&&job.provider_status==='cancelled'?'The previous Lotus order is canceled. Assign a replacement manual supplier for the complete order.':'Pay Lotus in the partner portal, then attach its shipping label here. Creating a supplier order does not pay Lotus or buy postage.','uc-hint'));
  if(job.provider_status==='paid'&&!job.takeover_requested&&['paid','processing'].includes(o.status)){const f=form('Send shipping label to Lotus',box),url=input(f,'Pirate Ship HTTPS share link','label_url','',true),tracking=input(f,'USPS / UPS tracking number','tracking','',true);url.type='url';
   submit(f,'Attach label to Lotus order',async()=>{await write({action:'label',id:o.id,url:url.value,tracking:tracking.value});msg('Shipping label attached to Lotus. Shipment status updates after Lotus dispatches the order.')})}}
 box.append(el('p','The background worker checks queued orders every 10 minutes. Submitted orders are checked again when due; tracking typically refreshes within about 20 minutes.','uc-hint'));
 for(const a of allocations){const item=el('div',undefined,'uc-allocation');item.append(field(a.variant_key,`${a.route||'manual'} · ${a.supplier_name||'Unassigned'} · ${state(a.status)}`));if(a.tracking_number)item.append(field('Tracking',(a.tracking_carrier||'')+' '+a.tracking_number));box.append(item)}
 const editable=['paid','processing'].includes(o.status)&&!allocations.some(a=>['shipped','delivered'].includes(a.status)),remote=!!(job?.supplier_id||job?.has_payload||['working','submitted','shipped'].includes(job?.status)),unresolved=remote&&!(job?.status==='cancelled'&&job?.provider_status==='cancelled');
 if(editable&&!unresolved){const f=form('Assign one supplier for the complete order',box),supplier=input(f,'Manual supplier name','supplier_name',allocations[0].route==='manual'?allocations[0].supplier_name:'',true),note=input(f,'Audit note','note','',true);note.minLength=8;
  submit(f,'Assign manual supplier',async()=>{await write({action:'assign',id:o.id,variant_key:allocations[0].variant_key,version:allocations[0].version,route:'manual',supplier_name:supplier.value,note:note.value});await reload(row)});
  const mapped=allocations.every(a=>(data.mappings||[]).some(m=>m.variant_key===a.variant_key&&m.verified_at));
  if(mapped&&!remote&&!job?.takeover_requested&&o.request_data?.address?.country==='US'&&data.supplier_enabled){const lf=form('Route complete order to Lotus',box),lotusNote=input(lf,'Audit note','lotus_note','',true);lotusNote.minLength=8;submit(lf,'Assign complete order to Lotus',async()=>{if(!window.confirm('Assign the complete order to Lotus? Confirm all products and shipping details first.'))return;await write({action:'assign',id:o.id,variant_key:allocations[0].variant_key,version:allocations[0].version,route:'lotus',note:lotusNote.value});await reload(row)})}}
 if(job?.status==='blocked'&&!job.takeover_requested){const f=form('Retry blocked supplier job',box),note=input(f,'Audit note','note','',true);note.minLength=8;submit(f,'Retry Lotus job',async()=>{await write({action:'retry',id:o.id,note:note.value});await reload(row)})}
 if(job?.supplier_id&&['queued','retry','working','submitted','blocked'].includes(job.status)&&!job.takeover_requested){const f=form('Request manual takeover',box),note=input(f,'Audit note','note','',true);note.minLength=8;f.append(el('p','The worker must confirm supplier cancellation before reassignment.','uc-hint'));submit(f,'Request supplier cancellation',async()=>{if(!window.confirm('Request Lotus cancellation and manual takeover?'))return;await write({action:'takeover',id:o.id,note:note.value});await reload(row)})}
 host.append(box)}
function legacyActions(host,o){exportSection(host,o,o);host.append(el('p','Earlier store order. Canceling fulfillment does not issue a refund or stop a provider payment.','uc-hint'));
 const transitions={unfulfilled:['processing','awaiting_supplier','canceled'],processing:['awaiting_supplier','partially_shipped','shipped'],awaiting_supplier:['processing','partially_shipped','shipped'],partially_shipped:['shipped'],shipped:['delivered']};
 const allowed=(transitions[o.fulfillment_status]||[]).filter(x=>!['processing','awaiting_supplier','partially_shipped','shipped','delivered'].includes(x)||['paid','partially_refunded'].includes(o.payment_status));
 const f=form('Update order details',host),next=select(f,'Fulfillment status','fulfillment_status',[[o.fulfillment_status,state(o.fulfillment_status)],...allowed.map(x=>[x,state(x)])]),priority=select(f,'Priority','priority',[['low','Low'],['normal','Normal'],['high','High']],o.priority||'normal'),supplier=input(f,'Supplier status','supplier_status',o.supplier_status||''),carrier=input(f,'Carrier','tracking_carrier',o.tracking_carrier||''),tracking=input(f,'Tracking number','tracking_number',o.tracking_number||''),notes=input(f,'Internal notes','admin_notes',o.admin_notes||'');
 submit(f,'Save order',async()=>{if(next.value==='canceled'&&!window.confirm('Cancel fulfillment for '+ref(o)+'? No refund or payment cancellation will be issued.'))return;
  const result=await send('/api/admin-orders',{action:'update',order_id:o.id,fulfillment_status:next.value,priority:priority.value,supplier_status:supplier.value,tracking_carrier:carrier.value,tracking_number:tracking.value,admin_notes:notes.value},'PATCH');await load();await detail(result.order?.id||o.id);
  if(result.notification?.status==='failed')msg(result.notification.error||'Order saved, but customer notification failed.',true)})}
window.AltaFulfillment={manage:detail,mount(fn){api=fn;root=document.getElementById('fulfillment-hub');clearInterval(poll);poll=setInterval(()=>{if(root&&!document.hidden&&!dlg?.open&&!root.contains(document.activeElement))load()},60000);load()},refresh:load,clear:close,openPayments(){},paymentDesk(){}};
})();
