(()=>{'use strict';
const el=(tag,text,cls)=>{const x=document.createElement(tag);if(text!==undefined)x.textContent=String(text);if(cls)x.className=cls;return x};
const cash=(n,c='USD')=>new Intl.NumberFormat('en-US',{style:'currency',currency:c||'USD'}).format((Number(n)||0)/100);
const ref=o=>o.order_number||'AP'+String(o.id).replace(/-/g,'').slice(0,10).toUpperCase();
const type=o=>o.source==='research_subscription'?'Research subscription':o.kind==='membership'?'Membership purchase':o.kind==='bulk'?'Bulk order':o.origin==='research_builder'?'Research Builder product order':o.source==='store'?'Earlier store order':'Product order';
const state=s=>({accepted:'Awaiting payment',requested:'Pending review',issued:'Payment pending',paid:'Paid',processing:'Processing',awaiting_supplier:'Awaiting supplier',unfulfilled:'Unfulfilled',pending:'Pending payment',pending_payment:'Pending payment',active:'Active',past_due:'Past due',cancel_pending:'Cancellation pending',canceled:'Canceled',shipped:'Shipped',delivered:'Delivered',refunded:'Refunded',void:'Canceled'}[s]||String(s||'Pending'));
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
 try{const result=await api('/api/admin-orders?'+params);if(ticket!==epoch)return;orders=result.orders||[];paging=result.pagination||{};root.replaceChildren();
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
 if(!dlg.open)dlg.showModal()}
function commerceActions(host,row,data){const o=data.order,id=o.id;
 if(o.status==='accepted'){host.append(el('p','Cancel only if no funds were sent. Existing payment links may remain payable; late funds need manual review.','uc-hint'));
  host.append(btn('Cancel unpaid order',async()=>{if(!window.confirm('Cancel '+ref(row)+'? Verify no payment was sent.'))return;const result=await write({action:'cancel_order',id,confirm_unpaid:true});if(result.status!=='void')throw Error('Cancellation was not confirmed.');dlg.close();await load();msg(ref(row)+' canceled. No refund was issued.')},'uc-danger'))}
 if(['requested','issued'].includes(o.status))host.append(el('p','This older invoice state requires payment reconciliation before cancellation. Do not void issued instructions or links without confirming funds and provider status.','uc-hint'));
 const steps=o.kind==='membership'?{}:{paid:[['processing','Processing'],['shipped','Shipped']],processing:[['shipped','Shipped']],shipped:[['delivered','Delivered']]};
 if(steps[o.status]){const f=form('Update fulfillment status',host),next=select(f,'Next status','status',steps[o.status]),carrier=input(f,'Carrier','carrier',o.tracking_carrier),tracking=input(f,'Tracking number','tracking',o.tracking_number),note=input(f,'Audit note','note','',true);note.minLength=8;
  submit(f,'Save status',async()=>{if(next.value==='shipped'&&(!carrier.value.trim()||!tracking.value.trim()))throw Error('Carrier and tracking required before shipment.');await write({action:'update_order',id,version:o.version,status:next.value,note:note.value,tracking_carrier:carrier.value,tracking_number:tracking.value});await reload(row)})}
 if(o.kind==='goods'&&['paid','processing'].includes(o.status)){const job=data.jobs?.[0],began=!!(job?.supplier_id||job?.has_payload||['working','submitted','shipped'].includes(job?.status));
  if(!began){const f=form('Edit shipping address before supplier submission',host),addr=o.request_data?.address||{},fields={};
   for(const [title,key]of [['Street','line1'],['Address line 2','line2'],['City','city'],['State / province','region'],['Postal code','postal_code'],['Country code','country']])fields[key]=input(f,title,key,addr[key]||'',key!=='line2');
   fields.country.readOnly=true;const note=input(f,'Reason for address change','note','',true);note.minLength=8;
   submit(f,'Save address',async()=>{const address=Object.fromEntries(Object.entries(fields).map(([key,control])=>[key,control.value]));await write({action:'edit_shipping',id,version:o.version,address,note:note.value});await reload(row)})}
  else host.append(el('p','Supplier processing has started. Coordinate address changes with the supplier.','uc-hint'))}
 if(['paid','processing','shipped','delivered'].includes(o.status)){const f=form('Record a completed full refund',host);f.append(el('p','Complete and verify the refund with the provider first. This records it; it does not return funds.','uc-hint'));
  const transaction=input(f,'Provider refund transaction ID','external_reference','',true);transaction.minLength=8;const check=el('label',undefined,'uc-check'),yes=el('input');yes.type='checkbox';yes.required=true;check.append(yes,el('span','I verified the full external refund.'));f.append(check);
  submit(f,'Record verified refund',async()=>{if(!window.confirm('Record the completed external refund? This does not send money.'))return;await write({action:'record_verified_refund',id,version:o.version,confirm_external_refund:true,external_reference:transaction.value});await reload(row)})}
 if(o.kind==='goods')supplierActions(host,row,data);
 if(o.status==='void')host.append(el('p','Canceled. Reconcile any late payment before refund or fulfillment.','uc-hint'));
 if(o.status==='refunded')host.append(el('p','Full external refund recorded.','uc-hint'));
 if(o.kind==='membership'&&o.status==='paid')host.append(el('p','Membership purchase recorded. No shipping workflow applies.','uc-hint'))}
function supplierActions(host,row,data){const allocations=data.allocations||[],job=data.jobs?.[0],o=data.order,box=el('section',undefined,'uc-supplier');box.append(el('h3','Supplier and fulfillment'));
 box.append(field('Supplier job',job?state(job.status)+(job.provider_status?' · '+job.provider_status:''):'No supplier job'),field('Supplier reference',job?.reference));
 if(job?.last_error)box.append(el('p','Supplier issue: '+job.last_error,'uc-hint'));if(job?.tracking_number)box.append(field('Supplier tracking',(job.carrier||'')+' '+job.tracking_number));
 if(!data.supplier_enabled)box.append(el('p','Lotus automatic fulfillment is disabled. Manual supplier assignment remains available.','uc-hint'));
 if(!allocations.length){box.append(el('p','No paid fulfillment lines have been allocated.','uc-hint'));host.append(box);return}
 for(const a of allocations){const item=el('div',undefined,'uc-allocation');item.append(field(a.variant_key,`${a.route||'manual'} · ${a.supplier_name||'Unassigned'} · ${state(a.status)}`));if(a.tracking_number)item.append(field('Tracking',(a.tracking_carrier||'')+' '+a.tracking_number));box.append(item)}
 const editable=['paid','processing'].includes(o.status)&&!allocations.some(a=>['shipped','delivered'].includes(a.status)),remote=!!(job?.supplier_id||job?.has_payload||['working','submitted','shipped'].includes(job?.status));
 if(editable&&!remote){const f=form('Assign one supplier for the complete order',box),supplier=input(f,'Manual supplier name','supplier_name',allocations[0].route==='manual'?allocations[0].supplier_name:'',true),note=input(f,'Audit note','note','',true);note.minLength=8;
  submit(f,'Assign manual supplier',async()=>{await write({action:'assign',id:o.id,variant_key:allocations[0].variant_key,version:allocations[0].version,route:'manual',supplier_name:supplier.value,note:note.value});await reload(row)});
  const mapped=allocations.every(a=>(data.mappings||[]).some(m=>m.variant_key===a.variant_key&&m.verified_at));
  if(mapped&&o.request_data?.address?.country==='US'&&data.supplier_enabled){const lf=form('Route complete order to Lotus',box),lotusNote=input(lf,'Audit note','lotus_note','',true);lotusNote.minLength=8;submit(lf,'Assign complete order to Lotus',async()=>{if(!window.confirm('Assign the complete order to Lotus? Confirm all products and shipping details first.'))return;await write({action:'assign',id:o.id,variant_key:allocations[0].variant_key,version:allocations[0].version,route:'lotus',note:lotusNote.value});await reload(row)})}}
 if(job?.status==='blocked'&&!job.takeover_requested){const f=form('Retry blocked supplier job',box),note=input(f,'Audit note','note','',true);note.minLength=8;submit(f,'Retry Lotus job',async()=>{await write({action:'retry',id:o.id,note:note.value});await reload(row)})}
 if(job?.supplier_id&&['queued','retry','working','submitted','blocked'].includes(job.status)&&!job.takeover_requested){const f=form('Request manual takeover',box),note=input(f,'Audit note','note','',true);note.minLength=8;f.append(el('p','The worker must confirm supplier cancellation before reassignment.','uc-hint'));submit(f,'Request supplier cancellation',async()=>{if(!window.confirm('Request Lotus cancellation and manual takeover?'))return;await write({action:'takeover',id:o.id,note:note.value});await reload(row)})}
 for(const a of allocations){const allowed=a.route==='lotus'?(a.status==='shipped'?['delivered']:[]):a.status==='pending'?['ordered','shipped']:a.status==='ordered'?['shipped']:a.status==='shipped'?['delivered']:[];if(!allowed.length)continue;
  const f=form('Update line · '+a.variant_key,box),next=select(f,'Line status','status',allowed.map(x=>[x,state(x)])),carrier=input(f,'Carrier','carrier',a.tracking_carrier||''),tracking=input(f,'Tracking number','tracking',a.tracking_number||''),note=input(f,'Audit note','note','',true);note.minLength=8;
  submit(f,'Save line status',async()=>{await write({action:'shipment',id:o.id,variant_key:a.variant_key,version:a.version,status:next.value,tracking_carrier:carrier.value,tracking_number:tracking.value,note:note.value});await reload(row)})}
 host.append(box)}
function legacyActions(host,o){host.append(el('p','Earlier store order. Canceling fulfillment does not issue a refund or stop a provider payment.','uc-hint'));
 const transitions={unfulfilled:['processing','awaiting_supplier','canceled'],processing:['awaiting_supplier','partially_shipped','shipped'],awaiting_supplier:['processing','partially_shipped','shipped'],partially_shipped:['shipped'],shipped:['delivered']};
 const allowed=(transitions[o.fulfillment_status]||[]).filter(x=>!['processing','awaiting_supplier','partially_shipped','shipped','delivered'].includes(x)||['paid','partially_refunded'].includes(o.payment_status));
 const f=form('Update order details',host),next=select(f,'Fulfillment status','fulfillment_status',[[o.fulfillment_status,state(o.fulfillment_status)],...allowed.map(x=>[x,state(x)])]),priority=select(f,'Priority','priority',[['low','Low'],['normal','Normal'],['high','High']],o.priority||'normal'),supplier=input(f,'Supplier status','supplier_status',o.supplier_status||''),carrier=input(f,'Carrier','tracking_carrier',o.tracking_carrier||''),tracking=input(f,'Tracking number','tracking_number',o.tracking_number||''),notes=input(f,'Internal notes','admin_notes',o.admin_notes||'');
 submit(f,'Save order',async()=>{if(next.value==='canceled'&&!window.confirm('Cancel fulfillment for '+ref(o)+'? No refund or payment cancellation will be issued.'))return;
  const result=await send('/api/admin-orders',{action:'update',order_id:o.id,fulfillment_status:next.value,priority:priority.value,supplier_status:supplier.value,tracking_carrier:carrier.value,tracking_number:tracking.value,admin_notes:notes.value},'PATCH');await load();await detail(result.order?.id||o.id);
  if(result.notification?.status==='failed')msg(result.notification.error||'Order saved, but customer notification failed.',true)})}
window.AltaFulfillment={manage:detail,mount(fn){api=fn;root=document.getElementById('fulfillment-hub');clearInterval(poll);poll=setInterval(()=>{if(root&&!document.hidden&&!dlg?.open&&!root.contains(document.activeElement))load()},60000);load()},refresh:load,clear:close,openPayments(){},paymentDesk(){}};
})();
