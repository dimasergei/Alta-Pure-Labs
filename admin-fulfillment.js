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
 const head=e('div',undefined,'uc-header'),h=e('div');h.append(e('p','Manage all new checkout orders in one place.','uc-hint'));
 head.append(h,button('Refresh',load));root.append(head);
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
window.AltaFulfillment={mount(fn){client=fn;root=document.getElementById('fulfillment-hub');clearInterval(poll);poll=setInterval(()=>{if(!document.hidden&&!dlg?.open&&!root.contains(document.activeElement))load()},60000);load()},refresh:load,clear:close,openPayments(){},paymentDesk(){}};
})();
