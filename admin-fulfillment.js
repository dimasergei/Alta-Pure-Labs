(()=>{'use strict';
const e=(t,text,cls)=>{const x=document.createElement(t);if(text!==undefined)x.textContent=String(text);if(cls)x.className=cls;return x};
const dollar=(n,c='USD')=>new Intl.NumberFormat('en-US',{style:'currency',currency:c}).format((+n||0)/100);
const ref=id=>'AP'+String(id||'').replace(/-/g,'').slice(0,10).toUpperCase();
const status=s=>({accepted:'Awaiting payment',requested:'Pending review',issued:'Payment pending',paid:'Paid',processing:'Processing',shipped:'Shipped',delivered:'Delivered',refunded:'Refunded',void:'Canceled'}[s]||String(s||'Pending'));
let client,root,dlg,offset=0,records=[],search='',sort='newest',epoch=0,poll;
const url=(view,extra='')=>'/api/customer-config?lotus=admin&view='+view+extra;
const write=b=>client(url('write'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});
function msg(t,bad=false){const x=dlg?.open?dlg.querySelector('[data-unified-message]'):root?.querySelector('[data-unified-message]');if(x){x.textContent=t;x.classList.toggle('failed',bad);}}
function button(t,fn,cls='ghost'){const x=e('button',t,cls);x.type='button';x.onclick=async()=>{x.disabled=true;try{await fn()}catch(err){msg(err.message,true)}finally{x.disabled=false}};return x;}
function close(){epoch++;clearInterval(poll);dlg?.remove();dlg=null;root?.replaceChildren();root=null;client=null;records=[];}
function field(k,v){const x=e('div',undefined,'uc-field');x.append(e('span',k),e('strong',v||'—'));return x;}
function input(f,txt,name,value='',required=false){const l=e('label',txt,'uc-input-field'),x=e('input');x.name=name;x.value=value||'';x.required=required;l.append(x);f.append(l);return x;}
function select(f,txt,name,values){const l=e('label',txt,'uc-input-field'),x=e('select');x.name=name;for(const [val,t]of values){const o=e('option',t);o.value=val;x.append(o)}l.append(x);f.append(l);return x;}
function rows(){
 const host=root?.querySelector('[data-unified-list]');if(!host)return;host.replaceChildren();
 let list=records.filter(x=>!search||[x.id,ref(x.id),x.customer_name,x.customer_email,x.status].some(y=>String(y||'').toLowerCase().includes(search.toLowerCase())));
 if(sort==='oldest')list=list.reverse();
 if(!list.length){host.append(e('p',search?'No matching orders.':'No checkout orders yet.','uc-empty'));return}
 for(const r of list){const card=e('article',undefined,'uc-order-row'),l=e('div',undefined,'uc-order-identity'),total=e('div',undefined,'uc-order-total');
  l.append(e('strong',ref(r.id)),e('small',new Date(r.created_at).toLocaleString()),e('span',r.customer_name||r.customer_email));
  total.append(e('strong',dollar(r.total_cents,r.currency)),e('small',status(r.status)));
  card.append(l,total,button('Manage order',()=>detail(r.id),'primary'));host.append(card);
 }
}
async function load(){
 if(!client||!root)return;const ticket=++epoch;root.replaceChildren();
 const head=e('div',undefined,'uc-header');
 head.append(button('Refresh',load));root.append(head);
 const tools=e('div',undefined,'uc-search'),q=e('input');q.type='search';q.placeholder='Search orders or customers';q.setAttribute('aria-label','Search orders');q.value=search;q.oninput=()=>{search=q.value;rows()};
 const sorting=e('select');for(const [v,t]of [['newest','Newest first'],['oldest','Oldest first']]){const o=e('option',t);o.value=v;sorting.append(o)}sorting.value=sort;sorting.onchange=()=>{sort=sorting.value;rows()};tools.append(q,sorting);root.append(tools);
 const note=e('p','', 'uc-message');note.setAttribute('data-unified-message','');note.setAttribute('role','status');root.append(note);
 const list=e('div',undefined,'uc-list');list.setAttribute('data-unified-list','');root.append(list);
 try{const d=await client(url('orders','&offset='+offset));if(epoch!==ticket)return;records=d.orders||[];rows();
   const pager=e('div',undefined,'uc-pager'),prev=button('Previous',async()=>{offset=Math.max(0,offset-25);await load()}),next=button('Next',async()=>{offset+=25;await load()});
   prev.disabled=!offset;next.disabled=!d.has_more;pager.append(prev,e('span','Page '+(offset/25+1)),next);root.append(pager);
 }catch(err){msg(err.message,true);}
}
async function detail(id){
 const ticket=epoch;const d=await client(url('detail','&id='+encodeURIComponent(id)));if(ticket!==epoch)return;
 const r=d.order;if(!dlg){dlg=e('dialog');dlg.className='fh-dialog uc-dialog';document.body.append(dlg)}dlg.replaceChildren();
 const h=e('div',undefined,'uc-dialog-head'),left=e('div');left.append(e('h2',ref(r.id)),e('small',status(r.status)));h.append(left,button('Close',()=>dlg.close()));dlg.append(h);
 const note=e('p','', 'uc-message');note.setAttribute('role','status');note.setAttribute('data-unified-message','');dlg.append(note);
 const info=e('section',undefined,'uc-info');info.append(field('Customer',r.customer_name),field('Email',r.customer_email),field('Payment status',status(r.status)),field('Total',dollar(r.total_cents,r.currency)),field('Placed',new Date(r.created_at).toLocaleString()));dlg.append(info);
 const items=e('section',undefined,'uc-items');items.append(e('h3','Order items'));
 for(const x of r.pricing?.lines||r.request_data?.items||[]){const item=e('div',undefined,'uc-item');item.append(e('span',(x.name||'Product')+' · '+(x.size||'')+' × '+(x.qty||1)),e('strong',dollar(x.line_total_cents??x.gross_cents??((x.unit_price_usd_cents||0)*(x.qty||1)),r.currency)));items.append(item)}dlg.append(items);
 const total=e('section',undefined,'uc-total');total.append(field('Subtotal',dollar(r.subtotal_cents,r.currency)),field('Discounts','−'+dollar(r.discount_cents,r.currency)),field('Delivery',dollar(r.shipping_cents,r.currency)),field('Total',dollar(r.total_cents,r.currency)));dlg.append(total);
 const addr=r.request_data?.address||{},address=[r.request_data?.name||r.customer_name,addr.line1,addr.line2,[addr.city,addr.region,addr.postal_code].filter(Boolean).join(', '),addr.country].filter(Boolean).join(' · ');if(address)dlg.append(e('p','Ship to: '+address,'uc-address'));
 if(r.tracking_number)dlg.append(e('p','Tracking: '+(r.tracking_carrier||'')+' '+r.tracking_number,'uc-address'));

 // All supplier information belongs to this individual Manage Order dialog.
 const supplier=e('section',undefined,'uc-supplier-section');
 supplier.append(e('h3','Supplier fulfillment'));
 const allocations=Array.isArray(d.allocations)?d.allocations:[],jobs=Array.isArray(d.jobs)?d.jobs:[],job=jobs[0]||null;
 const orderItems=Array.isArray(r.request_data?.items)?r.request_data.items:[];
 const verified=new Map((d.mappings||[]).filter(m=>m.verified_at).map(m=>[String(m.variant_key),m]));
 const country=String(addr.country||'').toUpperCase(),region=String(addr.region||'').toUpperCase(),zip=String(addr.postal_code||'');
 const supported=country==='US'&&/^[A-Z]{2}$/.test(region)&&/^\d{5}(?:-\d{4})?$/.test(zip);
 const unmatched=orderItems.filter(item=>!verified.has(String(item.id)+'|'+String(item.size)));
 const allLotus=allocations.length===orderItems.length&&allocations.length>0&&allocations.every(a=>a.route==='lotus');
 const reasons=[];
 if(!['paid','processing'].includes(r.status))reasons.push('Payment not confirmed for fulfillment');
 if(r.kind!=='goods')reasons.push('Not a physical goods order');
 if(!supported)reasons.push('Destination requires manual fulfillment');
 if(unmatched.length)reasons.push(unmatched.length+' product variant(s) not mapped to Lotus');
 if(allocations.length&&!allLotus)reasons.push('Order allocated to manual fulfillment');
 if(d.supplier_enabled===false)reasons.push('Lotus automatic worker is disabled');
 if(job?.last_error)reasons.push('Supplier exception: '+job.last_error);
 supplier.append(e('p',job?.supplier_id?'Existing Lotus supplier order':reasons.length?reasons.join(' · '):'Lotus candidate. A live supplier quote and stock check are required before submission.','uc-hint'));
 for(const item of orderItems){
  const key=String(item.id)+'|'+String(item.size),mapping=verified.get(key);
  const row=e('div',undefined,'uc-item');
  row.append(e('span',(item.name||item.id)+' · '+(item.size||'')+' × '+(item.qty||1)),
   e('strong',mapping?'Mapped: Lotus #'+mapping.product+' · pack '+mapping.vials:'Manual / unmapped'));
  supplier.append(row);
 }
 if(job){
  supplier.append(e('p','Lotus: '+(job.status||'pending')+' · Reference: '+(job.reference||'—'),'uc-hint'));
  supplier.append(e('p','Supplier order: '+(job.supplier_id||'Not submitted')+
   ' · Settlement: '+(job.settlement||'pending')+
   ' · Amount owed: '+(job.owed_total||'Not quoted'),'uc-hint'));
  if(job.tracking_number)supplier.append(e('p','Tracking: '+(job.carrier||'')+' '+job.tracking_number,'uc-hint'));
  if(job.last_error)supplier.append(e('p','Last exception: '+job.last_error,'uc-hint'));
  const link=e('a','Open Lotus partner portal for settlement and shipping labels');
  link.href='https://partners.lotuspeptide.com/orders';link.rel='noopener noreferrer';link.target='_blank';supplier.append(link);
  if(job.status==='blocked'&&!job.takeover_requested){
   const form=e('form',undefined,'uc-action-form');
   const reason=input(form,'Reason for retry','note','',true);reason.minLength=8;
   const save=e('button','Retry blocked Lotus order','mk-button');form.append(save);
   form.onsubmit=async event=>{event.preventDefault();save.disabled=true;try{await write({action:'retry',id:r.id,note:reason.value});await detail(id);window.AltaOrdersWorkspace?.refresh?.()}catch(err){msg(err.message,true)}finally{save.disabled=false}};
   supplier.append(form);
  }
  if(!['shipped','cancelled'].includes(job.status)&&!job.takeover_requested){
   const form=e('form',undefined,'uc-action-form');
   form.append(e('p','Switch to manual only after Lotus cancellation is confirmed. No replacement order is created automatically.','uc-hint'));
   const reason=input(form,'Cancellation / manual takeover reason','note','',true);reason.minLength=8;
   const save=e('button','Request Lotus cancellation and manual takeover','ghost');form.append(save);
   form.onsubmit=async event=>{event.preventDefault();if(!window.confirm('Request supplier cancellation? Do not reorder until Lotus confirms cancellation.'))return;save.disabled=true;try{await write({action:'takeover',id:r.id,note:reason.value});await detail(id);window.AltaOrdersWorkspace?.refresh?.()}catch(err){msg(err.message,true)}finally{save.disabled=false}};
   supplier.append(form);
  }
  if(job.takeover_requested&&job.status!=='cancelled')supplier.append(e('p','Manual takeover requested — wait for confirmed cancellation before assigning another supplier.','uc-hint'));
  if(job.supplier_id&&!job.takeover_requested&&!['cancelled','shipped'].includes(job.status)){
   const form=e('form',undefined,'uc-action-form');
   form.append(e('p','Attach a shipping label already purchased in Pirate Ship. This does not buy a label or charge the supplier.','uc-hint'));
   const label=input(form,'Pirate Ship HTTPS share link','url','',true);label.type='url';
   const tracking=input(form,'Tracking number','tracking','',true);
   const save=e('button','Attach purchased label','mk-button');form.append(save);
   form.onsubmit=async event=>{event.preventDefault();save.disabled=true;try{await write({action:'label',id:r.id,url:label.value,tracking:tracking.value});msg('Label submitted. Tracking updates after Lotus confirms dispatch.');await detail(id)}catch(err){msg(err.message,true)}finally{save.disabled=false}};
   supplier.append(form);
  }
 }
 if(allocations.length&&['paid','processing'].includes(r.status)&&allocations.every(a=>!['shipped','delivered'].includes(a.status))){
  const first=allocations[0],form=e('form',undefined,'uc-action-form');
  form.append(e('h4','Manual fulfillment — one supplier for the entire order'));
  const chosen=input(form,'Supplier name','supplier_name',allocations.find(a=>a.route==='manual'&&a.supplier_name)?.supplier_name||'',true);
  chosen.maxLength=180;chosen.minLength=2;
  const reason=input(form,'Audit note','note','',true);reason.minLength=8;reason.maxLength=2000;
  const save=e('button','Assign complete order to manual supplier','mk-button');form.append(save);
  form.onsubmit=async event=>{event.preventDefault();save.disabled=true;try{
   await write({action:'assign',id:r.id,variant_key:first.variant_key,version:first.version,route:'manual',supplier_name:chosen.value,note:reason.value});
   await detail(id);window.AltaOrdersWorkspace?.refresh?.();
  }catch(err){msg(err.message,true)}finally{save.disabled=false}};
  supplier.append(form);
 }
 if(!allocations.length)supplier.append(e('p',r.status==='paid'?'No supplier allocations recorded yet; review automatic routing.':'Supplier allocations are created only after confirmed payment.','uc-hint'));
 if(allocations.some(a=>a.route==='manual'&&a.supplier_name)){
  const a=allocations.find(x=>x.route==='manual'&&x.supplier_name);
  supplier.append(e('p','Manual supplier: '+a.supplier_name+' · Fulfillment: '+(a.status||'pending'),'uc-hint'));
  if(a.tracking_number)supplier.append(e('p','Tracking: '+(a.tracking_carrier||'')+' '+a.tracking_number,'uc-hint'));
  if(allocations.length>1)supplier.append(e('p','One combined shipment only. Use the order-level status and tracking controls; do not split items.','uc-hint'));
 }
 dlg.append(supplier);

 const actions=e('section',undefined,'uc-actions');actions.append(e('h3','Manage order'));dlg.append(actions);
 if(r.status==='accepted'){actions.append(e('p','Only cancel if no funds were sent. Existing payment links may remain payable; late funds require manual refund review.','uc-hint'));
  actions.append(button('Cancel unpaid order',async()=>{
   if(!window.confirm('Cancel '+ref(r.id)+'? Verify that no payment has been sent. Any existing payment link may remain usable.'))return;
   const result=await write({action:'cancel_order',id:r.id,confirm_unpaid:true});if(result.status!=='void')throw Error('Cancellation was not confirmed.');
   dlg.close();await load();msg(ref(r.id)+' canceled. No refund was issued.');
  },'uc-danger'));}
 const steps={paid:[['processing','Processing'],['shipped','Shipped']],processing:[['shipped','Shipped']],shipped:[['delivered','Delivered']]};
 if(steps[r.status]){const f=e('form',undefined,'uc-action-form');f.append(e('h4','Update order status'));const s=select(f,'Next status','status',steps[r.status]),carrier=input(f,'Carrier','tracking_carrier',r.tracking_carrier),tracking=input(f,'Tracking number','tracking_number',r.tracking_number),reason=input(f,'Reason / note','note','',true);reason.minLength=8;const save=e('button','Save status','primary');f.append(save);
 f.onsubmit=async event=>{event.preventDefault();save.disabled=true;try{if(s.value==='shipped'&&(!carrier.value.trim()||!tracking.value.trim()))throw Error('Carrier and tracking are required to mark shipped.');await write({action:'update_order',id:r.id,version:r.version,status:s.value,note:reason.value,tracking_carrier:carrier.value,tracking_number:tracking.value});await load();await detail(id)}catch(err){msg(err.message,true)}finally{save.disabled=false}};actions.append(f);}
 if(['paid','processing','shipped','delivered'].includes(r.status)){const f=e('form',undefined,'uc-action-form');f.append(e('h4','Record a completed refund'),e('p','This records a FULL refund that you have already completed with the provider. This button does not send money.','uc-hint'));const transaction=input(f,'Verified provider refund transaction ID','external_reference','',true);transaction.minLength=8;
 const confirm=e('label',undefined,'uc-check'),cb=e('input');cb.type='checkbox';cb.required=true;confirm.append(cb,e('span','I verified the full external refund was completed.'));f.append(confirm);const save=e('button','Record verified refund','ghost');f.append(save);
 f.onsubmit=async event=>{event.preventDefault();save.disabled=true;try{if(!cb.checked)throw Error('Confirm the external refund first.');if(!window.confirm('Record the completed external refund for '+ref(r.id)+'? This does not return money.'))return;await write({action:'record_verified_refund',id:r.id,version:r.version,confirm_external_refund:true,external_reference:transaction.value});await load();await detail(id)}catch(err){msg(err.message,true)}finally{save.disabled=false}};actions.append(f);}
 if(r.status==='void')actions.append(e('p','Canceled. Any late payment must be reconciled before refund; no order fulfillment is authorized.','uc-hint'));
 if(r.status==='refunded')actions.append(e('p','Full external refund recorded.','uc-hint'));
 if(!dlg.open)dlg.showModal();
}
window.AltaFulfillment={mount(fn){client=fn;root=document.getElementById('fulfillment-hub');clearInterval(poll);poll=setInterval(()=>{if(!document.hidden&&!dlg?.open&&!root.contains(document.activeElement))load()},60000);load()},bind(fn){client=fn;},manage:detail,refresh:load,clear:close,openPayments(){},paymentDesk(){}};
})();
