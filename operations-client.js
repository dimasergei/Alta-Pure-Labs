(() => {
 'use strict';
 const make=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);return n;};
 async function renderRequests(root,auth,offset=0){
  root.replaceChildren(make('p','Loading your requests…'));
  try{
   const {data}=await auth.auth.getSession(),token=data?.session?.access_token;if(!token)throw Error('Sign in again to view your requests.');
   const r=await fetch('/api/customer-config?workspace=requests&offset='+offset,{cache:'no-store',headers:{Authorization:'Bearer '+token}});const result=await r.json();if(!r.ok)throw Error(result.error||'Requests unavailable.');
   root.replaceChildren();const intro=make('p','Requests submitted with your verified account email appear here. Replies shown here are account updates, not a separate email thread.');intro.className='ap-fine';root.append(intro);
   if(!result.requests?.length)root.append(make('p','No requests are associated with this email yet.'));
   for(const request of result.requests||[]){const card=make('article');card.className='ap-request-card';const ref=make('p',request.reference);ref.className='ap-request-reference';card.append(make('h3',request.kind+' · '+request.status.replace(/_/g,' ')),ref,make('small','Received '+new Date(request.created_at).toLocaleString()));if(request.public_reply)card.append(make('pre',request.public_reply));else card.append(make('p','No account response has been posted yet.'));root.append(card);}
   const controls=make('div');controls.className='ap-actions';if(offset>0){const prev=make('button','Previous');prev.className='ap-button ap-button-secondary';prev.onclick=()=>renderRequests(root,auth,Math.max(0,offset-25));controls.append(prev);}if(result.has_more){const next=make('button','Next');next.className='ap-button ap-button-secondary';next.onclick=()=>renderRequests(root,auth,offset+25);controls.append(next);}const contact=make('a','Send a new request ↗');contact.className='ap-button ap-button-secondary';contact.href='/contact';controls.append(contact);root.append(controls);
  }catch(e){root.replaceChildren(make('p',e.message));}
 }
 window.AltaOperationsUI={renderRequests};
})();