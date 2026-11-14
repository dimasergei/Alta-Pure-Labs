(()=>{'use strict';
const e=(t,text,cls)=>{const x=document.createElement(t);if(text!==undefined)x.textContent=String(text);if(cls)x.className=cls;return x};
const ref=id=>'AP'+String(id||'').replace(/-/g,'').slice(0,10).toUpperCase();
let api,root,offset=0,epoch=0;
const route=(v,extra='')=>'/api/customer-config?lotus=admin&view='+v+extra;
async function load(){
 if(!api||!root)return;const ticket=++epoch;root.replaceChildren(e('h2','Customer notifications'),e('p','Checkout order emails and delivery results.','uc-hint'));
 const refresh=e('button','Refresh','ghost');refresh.onclick=()=>load();root.append(refresh);
 const note=e('p','');note.setAttribute('role','status');root.append(note);
 try{
  const result=await api(route('notifications','&offset='+offset));
  if(ticket!==epoch)return;
  const list=e('div',undefined,'uc-notice-list');root.append(list);
  for(const item of result.notifications||[]){
   const row=e('article',undefined,'uc-notification');
   row.append(e('strong',ref(item.invoice_id)+' · '+String(item.event_action||'').replace(/_/g,' ')),e('span',item.snapshot?.customer_email||''),e('small',item.state),e('small',new Date(item.created_at).toLocaleString()));
   if(item.state==='failed'){
    const retry=e('button','Retry email','ghost');
    retry.onclick=async()=>{retry.disabled=true;try{await api(route('write'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'retry_notification',id:item.id})});await load()}catch(err){note.textContent=err.message;retry.disabled=false}};
    row.append(retry);
   }list.append(row);
  }
  if(!list.childElementCount)list.append(e('p','No checkout notifications yet.'));
  const nav=e('div',undefined,'uc-pager'),back=e('button','Previous','ghost'),next=e('button','Next','ghost');
  back.disabled=!offset;next.disabled=!result.has_more;back.onclick=()=>{offset=Math.max(0,offset-25);load()};next.onclick=()=>{offset+=25;load()};
  nav.append(back,e('span','Page '+(offset/25+1)),next);root.append(nav);
 }catch(err){note.textContent=err.message;}
}
window.AltaUnifiedNotifications={mount(client){api=client;root=document.getElementById('unified-notifications');if(root)load()},clear(){epoch++;root?.replaceChildren();root=null;api=null}};
})();
