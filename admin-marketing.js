(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const key = 'altapure_marketing_workspace_v1';
  const stages = ['New','Qualified','Drafted','Contacted','Replied','Negotiating','Partner','Dormant'];
  const fields = ['name','handle','platform','followers','views','stage','email','followup','url','niche','notes'];
  const clean = (value,max=1000) => String(value ?? '').trim().slice(0,max);
  const today = () => new Date().toLocaleDateString('en-CA');
  const fmt = n => Number(n || 0).toLocaleString();
  const uid = () => (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : 'm-'+Date.now()+'-'+Math.random().toString(36).slice(2);
  const safeURL = value => { try {const u=new URL(value);return ['https:','http:'].includes(u.protocol)?u.href:'';}catch{return '';} };
  const original = {leads:[],messages:[],style:'Direct and professional. Ask whether the creator is open to a long-term collaboration; do not imply we reviewed content we have not seen. No unverified claims.'};
  let data = read(), selected='',draftId='', password='', aiAvailable=false, loggedIn=false;
  let revision=0,remoteReady=false,syncTimer=null,syncRunning=false,syncQueued=false;
  let instagram={connected:false,credentials_configured:false},igMessages=[];

  function read(){
    try{
      const raw=JSON.parse(localStorage.getItem(key)||'null');
      if(!raw || typeof raw !== 'object')return structuredClone(original);
      return {
        leads:Array.isArray(raw.leads)?raw.leads.slice(0,5000).map(normalize):[],
        messages:Array.isArray(raw.messages)?raw.messages.slice(-10000).filter(m=>m && typeof m==='object'):[],
        style:clean(raw.style,2000)||original.style
      };
    }catch{return {leads:[],messages:[],style:original.style};}
  }
  function normalize(input){
    const v={id:clean(input.id||uid(),100),updated:clean(input.updated||new Date().toISOString(),40),created:clean(input.created||new Date().toISOString(),40)};
    for(const f of fields)v[f]=clean(input[f],f==='notes'?3000:f==='url'?1000:254);
    v.followers=Math.max(0,Math.min(1000000000,Number(v.followers)||0));
    v.views=Math.max(0,Math.min(1000000000,Number(v.views)||0));
    v.stage=stages.includes(v.stage)?v.stage:'New';
    v.platform=['Instagram','TikTok','YouTube','Other'].includes(v.platform)?v.platform:'Other';
    v.url=safeURL(v.url);
    v.draft=clean(input.draft,6000);
    return v;
  }
  function save(){
    try{
      localStorage.setItem(key,JSON.stringify(data));
      if(remoteReady)queueCloudSave();
      return true;
    }catch{notice('Could not save browser backup. Export JSON and check browser storage.',true);return false;}
  }
  function queueCloudSave(){
    syncQueued=true;
    $('mk-sync-status').textContent='Saving…';
    clearTimeout(syncTimer);
    syncTimer=setTimeout(persistCloud,350);
  }
  async function persistCloud(){
    if(!remoteReady||syncRunning)return;
    syncRunning=true;
    try{
      while(syncQueued){
        syncQueued=false;
        const snapshot=JSON.parse(JSON.stringify(data));
        const reply=await endpoint({action:'save_workspace',revision,payload:snapshot});
        revision=reply.revision;
        $('mk-sync-status').textContent='Cloud saved';
        $('mk-crm-state').textContent='Synced';
      }
    }catch(err){
      $('mk-sync-status').textContent='Cloud sync needs attention';
      $('mk-crm-state').textContent='Sync error';
      notice(err.message+' Local backup is preserved. Do not clear this browser until synced.',true);
    }finally{
      syncRunning=false;
    }
  }
  function notice(message,error=false){const el=$('mk-alert');el.textContent=message||'';el.style.color=error?'#a93434':'#1c7a73';}
  function elem(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=String(text);if(cls)e.className=cls;return e;}
  function accountPassword(){
    try{return sessionStorage.getItem('altapure_admin_password')||'';}catch{return '';}
  }
  function setPassword(v){
    try{if(v)sessionStorage.setItem('altapure_admin_password',v);else sessionStorage.removeItem('altapure_admin_password');}catch{}
  }
  async function endpoint(body){
    const opt={method:body?'POST':'GET',cache:'no-store',headers:{'x-admin-password':password,...(body?{'Content-Type':'application/json'}:{})}};
    if(body)opt.body=JSON.stringify(body);
    const r=await fetch('/api/customer-config?marketing=admin',opt);
    const payload=await r.json().catch(()=>({error:'Unable to read server response.'}));
    if(!r.ok)throw Error(payload.error||'Marketing endpoint unavailable.');
    return payload;
  }
  function showApp(){loggedIn=true;$('mk-login').hidden=true;$('mk-app').hidden=false;$('mk-style').value=data.style;render();notice('');}
  function showLogin(message){loggedIn=false;remoteReady=false;password='';$('mk-app').hidden=true;$('mk-login').hidden=false;if(message){$('mk-login-error').hidden=false;$('mk-login-error').textContent=message;}}
  async function login(value){
    password=value;
    try{
      const status=await endpoint();
      aiAvailable=status.ai_enabled===true;
      $('mk-ai-state').textContent=aiAvailable?'Available — draft review required':'Not configured — editable templates available';
      const cached=data;
      const remote=status.workspace;
      if(remote&&Array.isArray(remote.leads)&&Array.isArray(remote.messages)){
        data={leads:remote.leads.map(normalize),messages:remote.messages,style:remote.style||original.style};
      }
      revision=Number(status.revision)||0;
      instagram=status.instagram||{connected:false};
      igMessages=Array.isArray(status.instagram_messages)?status.instagram_messages:[];
      remoteReady=true;
      try{localStorage.setItem(key,JSON.stringify(data));}catch{}
      setPassword(value);$('mk-login-error').hidden=true;showApp();
      $('mk-sync-status').textContent='Connected to Supabase';
      $('mk-crm-state').textContent='Synced';
      const existingIds=new Set(data.leads.map(x=>x.id));
      const existingHandles=new Set(data.leads.map(x=>String(x.handle||'').toLowerCase()).filter(Boolean));
      const localOnly=cached.leads.filter(x=>!existingIds.has(x.id)&&!(x.handle&&existingHandles.has(String(x.handle).toLowerCase())));
      const existingMessageIds=new Set(data.messages.map(x=>x.id));
      const localMessages=cached.messages.filter(x=>x.id&&!existingMessageIds.has(x.id));
      if(localOnly.length||localMessages.length){
        // Preserve previous browser-only CRM work even if the cloud has been seeded.
        data.leads.push(...localOnly);data.messages.push(...localMessages);
        save();render();notice('Recovered '+localOnly.length+' previous creator records and '+localMessages.length+' conversation notes into the shared CRM.');
      }
      const result=new URLSearchParams(location.search).get('instagram');
      if(result){switchPanel('instagram');notice(result==='connected'?'Instagram connected. Inbox synchronization is ready.':'Instagram connection status: '+result.replaceAll('_',' '));history.replaceState(null,'',location.pathname);}
    }catch(err){setPassword('');showLogin(err.message);}
  }

  function find(id){return data.leads.find(x=>x.id===id);}
  function render(){
    if(!loggedIn)return;
    const due=data.leads.filter(x=>x.followup && x.followup<=today() && x.stage!=='Dormant');
    $('mk-total').textContent=fmt(data.leads.length);
    $('mk-contacted').textContent=fmt(data.leads.filter(x=>['Contacted','Replied','Negotiating','Partner'].includes(x.stage)).length);
    $('mk-replied').textContent=fmt(data.leads.filter(x=>['Replied','Negotiating','Partner'].includes(x.stage)).length);
    $('mk-due').textContent=fmt(due.length);
    renderLeads();renderConversations();renderStages();renderInstagram();
  }
  function renderLeads(){
    const q=$('mk-search').value.trim().toLowerCase(),stage=$('mk-filter').value;
    const leads=data.leads.filter(p=>(!stage||p.stage===stage)&&(!q||[p.name,p.handle,p.niche,p.notes,p.email].some(v=>String(v||'').toLowerCase().includes(q))));
    const sort=$('mk-sort').value;
    leads.sort((a,b)=>sort==='name'?a.name.localeCompare(b.name):sort==='followers'?b.followers-a.followers:sort==='recent'?(b.updated||'').localeCompare(a.updated||''):((a.followup||'9999-12-31').localeCompare(b.followup||'9999-12-31')));
    const tbody=$('mk-leads');tbody.replaceChildren();
    if(!leads.length){const tr=elem('tr'),td=elem('td',data.leads.length?'No matching creators.':'Add your first prospect or import a CSV.');td.colSpan=6;tr.append(td);tbody.append(tr);}
    for(const lead of leads){
      const tr=elem('tr');
      const name=elem('td'),strong=elem('span',lead.name||'Unnamed','mk-name'),handle=elem('small',lead.handle||lead.email||'—','mk-secondary');name.append(strong,handle);
      const platform=elem('td',lead.platform),followers=elem('td',fmt(lead.followers));
      const stageCell=elem('td'),pill=elem('span',lead.stage,'mk-stage-label');stageCell.append(pill);
      const follow=elem('td',lead.followup||'—');if(lead.followup&&lead.followup<=today()&&lead.stage!=='Dormant')follow.style.color='#a93434';
      const actions=elem('td'),wrap=elem('div',undefined,'mk-actions');
      for(const [label,func] of [['Edit',()=>edit(lead.id)],['Draft',()=>draft(lead.id)]]){
        const b=elem('button',label);b.type='button';b.addEventListener('click',func);wrap.append(b);
      }
      if(lead.url){const a=elem('a','Profile');a.href=lead.url;a.target='_blank';a.rel='noopener noreferrer';a.className='mk-secondary';wrap.append(a);}
      actions.append(wrap);tr.append(name,platform,followers,stageCell,follow,actions);tbody.append(tr);
    }
    $('mk-count').textContent=leads.length+' of '+data.leads.length+' records';
  }
  function renderConversations(){
    const select=$('mk-conversation-select'),prior=select.value||selected;
    select.replaceChildren();
    if(!data.leads.length){select.append(new Option('No prospects yet',''));$('mk-conversation-timeline').replaceChildren();return;}
    for(const x of [...data.leads].sort((a,b)=>a.name.localeCompare(b.name)))select.append(new Option(x.name||x.handle||x.id,x.id));
    select.value=data.leads.some(x=>x.id===prior)?prior:data.leads[0].id;
    selected=select.value;
    const root=$('mk-conversation-timeline');root.replaceChildren();
    const records=data.messages.filter(m=>m.lead_id===selected).slice(-100);
    if(!records.length){root.append(elem('p','No messages logged for this creator.','mk-muted'));return;}
    for(const m of records){
      const article=elem('article',undefined,'mk-entry');
      const h=elem('strong',({inbound:'Received',outbound:'Sent manually',note:'Internal note'})[m.type]||'Note');
      const time=elem('small',new Date(m.at).toLocaleString());
      const p=elem('p',clean(m.text,4000));article.append(h,time,p);root.append(article);
    }
  }
  function renderStages(){
    const root=$('mk-stage-bars');root.replaceChildren();
    const max=Math.max(1,...stages.map(s=>data.leads.filter(p=>p.stage===s).length));
    for(const stage of stages){
      const count=data.leads.filter(p=>p.stage===stage).length, row=elem('div',undefined,'mk-stage-row'),
        label=elem('strong',stage),track=elem('div',undefined,'mk-stage-track'),bar=elem('div',undefined,'mk-stage-fill'),value=elem('span',count);
      bar.style.width=(count/max*100)+'%';track.append(bar);row.append(label,track,value);root.append(row);
    }
  }
  function edit(id=''){
    const lead=find(id);
    $('mk-editor-title').textContent=lead?'Edit prospect':'Add prospect';
    $('mk-id').value=lead?.id||'';
    for(const f of fields){const input=$('mk-'+f);if(input)input.value=lead?.[f]??(['stage'].includes(f)?'New':f==='platform'?'Instagram':'');}
    $('mk-delete').hidden=!lead;
    $('mk-editor').showModal();
  }
  function saveLead(ev){
    ev.preventDefault();
    const id=$('mk-id').value,existing=find(id);
    const input={id:id||uid(),created:existing?.created||new Date().toISOString(),updated:new Date().toISOString(),draft:existing?.draft||''};
    for(const f of fields)input[f]=$('mk-'+f).value;
    const row=normalize(input);if(!row.name){notice('Creator name is required.',true);return;}
    if(existing){Object.assign(existing,row);}else data.leads.push(row);
    if(save()){render();$('mk-editor').close();notice('Prospect saved.');}
  }
  function template(lead,type,context){
    const greet=lead.name?('Hi '+lead.name.split(' ')[0]+','):'Hi,';
    const reference=context?'\n\n'+context.trim()+'\n':'';
    const outro='\n\nBest,\nAltaPure Labs\nadmin@altapurelabs.com';
    if(type==='followup')return greet+'\n\nFollowing up on my note about a potential AltaPure Labs creator partnership. Would you be open to sharing your media kit or the best contact for collaboration inquiries?'+reference+outro;
    if(type==='reply')return greet+'\n\nThanks for getting back to us. I would be glad to discuss a possible collaboration and learn what placements work best for your audience. Could you share your media kit, audience geography and standard deliverables?'+reference+outro;
    return greet+'\n\nI’m reaching out from AltaPure Labs. We’re exploring a small number of ongoing creator collaborations, and I’d like to see whether there could be a fit with your content.'+reference+'\n\nAre you currently considering brand partnerships? If so, could you share your media kit or business contact?'+outro;
  }
  function draft(id){
    const lead=find(id);if(!lead)return;
    draftId=id;
    $('mk-draft-target').textContent=[lead.name,lead.handle,lead.platform].filter(Boolean).join(' · ');
    $('mk-draft-type').value='intro';$('mk-draft-context').value='';$('mk-draft-output').value=lead.draft||'';
    $('mk-draft-status').textContent=aiAvailable?'AI drafting available. Review all output before sending.':'AI service not configured. Use the manual template.';
    $('mk-draft-dialog').showModal();
  }
  function manualTemplate(){const lead=find(draftId);if(!lead)return;$('mk-draft-output').value=template(lead,$('mk-draft-type').value,$('mk-draft-context').value);$('mk-draft-status').textContent='Editable template generated locally; no message sent.';}
  async function generate(e){
    e.preventDefault();
    const lead=find(draftId);if(!lead)return;
    if(!aiAvailable){manualTemplate();return;}
    const button=$('mk-generate');button.disabled=true;$('mk-draft-status').textContent='Generating…';
    try{
      const response=await endpoint({action:'draft',name:lead.name,handle:lead.handle,niche:lead.niche,notes:lead.notes,platform:lead.platform,type:$('mk-draft-type').value,context:$('mk-draft-context').value,style:data.style});
      $('mk-draft-output').value=response.draft||'';
      $('mk-draft-status').textContent='AI draft ready for your review. It has not been sent.';
    }catch(error){$('mk-draft-status').textContent=error.message+' You can use the template instead.';}
    finally{button.disabled=false;}
  }
  function saveDraft(){
    const lead=find(draftId);if(!lead)return;
    lead.draft=clean($('mk-draft-output').value,6000);
    if(['New','Qualified'].includes(lead.stage))lead.stage='Drafted';
    lead.updated=new Date().toISOString();
    if(save()){render();notice('Draft saved to prospect. Nothing was sent.');$('mk-draft-dialog').close();}
  }
  async function copyDraft(){
    const value=$('mk-draft-output').value;
    if(!value){$('mk-draft-status').textContent='No text to copy.';return;}
    try{await navigator.clipboard.writeText(value);$('mk-draft-status').textContent='Copied. Send manually after review.';}
    catch{$('mk-draft-output').focus();$('mk-draft-output').select();$('mk-draft-status').textContent='Select and copy the text manually.';}
  }
  function download(name,body,contentType){
    const url=URL.createObjectURL(new Blob([body],{type:contentType})),a=elem('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);
  }
  function cell(value){let s=String(value??'');if(/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}
  function exportCSV(){
    const columns=['name','handle','platform','followers','views','stage','email','followup','url','niche','notes'];
    const csv=[columns.join(','),...data.leads.map(x=>columns.map(f=>cell(x[f])).join(','))].join('\r\n');
    download('AltaPure-Marketing-Prospects.csv','\ufeff'+csv,'text/csv;charset=utf-8');
  }
  function parseCSV(raw){
    const rows=[];let row=[],current='',inQuotes=false;
    for(let i=0;i<raw.length;i++){
      const c=raw[i];
      if(c==='"'){if(inQuotes&&raw[i+1]==='"'){current+='"';i++;}else inQuotes=!inQuotes;}
      else if(c===','&&!inQuotes){row.push(current);current='';}
      else if((c==='\n'||c==='\r')&&!inQuotes){if(c==='\r'&&raw[i+1]==='\n')i++;row.push(current);if(row.some(s=>s.trim()))rows.push(row);row=[];current='';}
      else current+=c;
    }
    row.push(current);if(row.some(s=>s.trim()))rows.push(row);
    return rows;
  }
  function importCSV(raw){
    const rows=parseCSV(raw.replace(/^\ufeff/,''));if(rows.length<2)throw Error('CSV must have a header and at least one creator.');
    const headers=rows.shift().map(s=>s.trim().toLowerCase().replace(/[^a-z0-9]/g,''));
    const aliases={name:['name','creator','creatorname','full name','account'].map(s=>s.replace(/[^a-z0-9]/g,'')),handle:['handle','username','instagram','ig','instagramhandle'],platform:['platform','primaryplatform','channel'],followers:['followers','followercount','subscribers','audience'],views:['views','averageviews','avgviews','medianviews'],email:['email','businessemail','contactemail'],url:['url','profile','profileurl','contacturl','link'],niche:['niche','category','audienceniche'],notes:['notes','researchnotes','qualificationnotes'],stage:['stage','status'],followup:['followup','nextfollowup']};
    const ix=Object.fromEntries(Object.entries(aliases).map(([f,a])=>[f,headers.findIndex(h=>a.includes(h))]));
    if(ix.name===-1&&ix.handle===-1)throw Error('CSV needs a Name/Creator or Handle column.');
    let added=0;
    for(const row of rows.slice(0,5000)){
      const v={};
      for(const [f,index] of Object.entries(ix))v[f]=index>=0?row[index]||'':'';
      if(!v.name&&!v.handle)continue;
      v.name=v.name||v.handle;
      if(v.followup&&!/^\d{4}-\d{2}-\d{2}$/.test(v.followup))v.followup='';
      if(!v.platform) v.platform='Instagram';
      const candidate=normalize(v);
      const already=data.leads.some(x=>(candidate.handle&&x.handle.toLowerCase()===candidate.handle.toLowerCase())||(candidate.url&&x.url===candidate.url));
      if(!already){data.leads.push(candidate);added++;}
    }
    if(!save())return;render();notice('Imported '+added+' new prospects. Existing matching handles/URLs were skipped.');
  }
  async function fileText(file){if(!file||file.size>5_000_000)throw Error('Choose a file smaller than 5 MB.');return file.text();}

  function renderInstagram(){
    const connected=instagram?.connected===true,configured=instagram?.credentials_configured===true;
    $('mk-ig-connection-badge').textContent=connected?'Connected: @'+(instagram.username||'Instagram'):'Not connected';
    $('mk-ig-settings-status').textContent=connected?'@'+(instagram.username||'Instagram'):'Not connected';
    $('mk-ig-status').textContent=connected?
      '@'+(instagram.username||'Instagram')+(instagram.webhook_subscribed?' · Webhook subscribed':' · Webhook subscription pending')
       +(instagram.token_expired?' · Token expired — reconnect Instagram':
         instagram.token_expiring?' · Token renewal due; use Sync inbox':''):
      'Connect an Instagram professional account to see messages';
    $('mk-ig-setup-state').textContent=configured?
      'Meta OAuth app credentials detected. Connect your professional account; verify the webhook callback and permissions in Meta Developer Dashboard.':
      'Meta app credentials not yet configured. Add INSTAGRAM_APP_ID and INSTAGRAM_APP_SECRET in Vercel Production. Set INSTAGRAM_APP_SECRET and INSTAGRAM_WEBHOOK_VERIFY_TOKEN as Supabase Edge Function secrets for webhook verification. Then open Connect Instagram.';
    $('mk-ig-connect').disabled=!configured;
    $('mk-ig-sync').disabled=!connected;
    $('mk-ig-disconnect').disabled=!connected;
    $('mk-ig-callback').textContent=instagram.callback_url||'https://altapurelabs.com/api/instagram/callback';
    $('mk-ig-webhook').textContent=instagram.webhook_url||'https://mqtitxfsdphqbsxhwdma.supabase.co/functions/v1/alta-instagram-webhook';
    const select=$('mk-ig-thread'),prior=select.value;
    const participants=[...new Set(igMessages.map(x=>x.participant_id).filter(Boolean))];
    select.replaceChildren();
    if(!connected)select.append(new Option('Connect Instagram first',''));
    else if(!participants.length)select.append(new Option('No synced conversations yet',''));
    else for(const id of participants)select.append(new Option('Instagram user '+id,id));
    if(prior&&participants.includes(prior))select.value=prior;
    const id=select.value;
    const events=igMessages.filter(x=>x.participant_id===id).sort((a,b)=>new Date(a.message_at)-new Date(b.message_at));
    const root=$('mk-ig-messages');root.replaceChildren();
    if(!events.length)root.append(elem('p','No conversation selected. Sync the Instagram inbox or wait for a new incoming DM.','mk-muted'));
    for(const item of events){
      const el=elem('article',undefined,'mk-entry'),
        title=elem('strong',item.direction==='incoming'?'Instagram user':'AltaPure'),
        date=elem('small',new Date(item.message_at).toLocaleString()),
        body=elem('p',item.body||'[Media message]');
      el.append(title,date,body);root.append(el);
    }
    const latest=events.filter(x=>x.direction==='incoming').at(-1);
    const canReply=connected&&instagram.can_send===true&&Boolean(latest)&&Date.now()-Date.parse(latest.message_at)<24*3600000;
    $('mk-ig-reply').disabled=!canReply;
    $('mk-ig-send').disabled=!canReply;
    $('mk-ig-reply').placeholder=canReply?'Write a manual reply…':'Reply available only during the standard messaging window after an inbound DM';
  }
  async function refreshInstagram(sync=false){
    try{
      $('mk-ig-status').textContent=sync?'Syncing recent Instagram conversations…':'Refreshing account status…';
      if(sync)await endpoint({action:'instagram_sync'});
      const status=await endpoint();
      instagram=status.instagram||{connected:false};
      igMessages=Array.isArray(status.instagram_messages)?status.instagram_messages:[];
      renderInstagram();notice('Instagram account and messages refreshed.');
    }catch(err){notice(err.message,true);renderInstagram();}
  }

  function switchPanel(name){
    for(const b of document.querySelectorAll('.mk-subtab')){const active=b.dataset.panel===name;b.classList.toggle('is-active',active);b.setAttribute('aria-selected',String(active));}
    for(const panel of ['pipeline','conversations','instagram','insights','settings'])$('mk-panel-'+panel).hidden=panel!==name;
  }

  $('mk-login-form').addEventListener('submit',e=>{e.preventDefault();const v=$('mk-password').value;$('mk-password').value='';login(v);});
  $('mk-logout').addEventListener('click',()=>{setPassword('');showLogin('Logged out.');});
  for(const b of document.querySelectorAll('.mk-subtab'))b.addEventListener('click',()=>switchPanel(b.dataset.panel));
  $('mk-add-button').addEventListener('click',()=>edit());
  $('mk-lead-form').addEventListener('submit',saveLead);
  $('mk-editor-close').addEventListener('click',()=>$('mk-editor').close());
  $('mk-delete').addEventListener('click',()=>{
    const id=$('mk-id').value,lead=find(id);
    if(lead&&confirm('Delete '+lead.name+' and related notes? This cannot be undone.')){
      data.leads=data.leads.filter(x=>x.id!==id);
      data.messages=data.messages.filter(x=>x.lead_id!==id);
      if(save()){render();$('mk-editor').close();notice('Prospect deleted.');}
    }
  });
  for(const id of ['mk-search','mk-filter','mk-sort'])$(id).addEventListener(id==='mk-search'?'input':'change',renderLeads);
  $('mk-conversation-select').addEventListener('change',()=>{selected=$('mk-conversation-select').value;renderConversations();});
  $('mk-message-form').addEventListener('submit',e=>{
    e.preventDefault();const lead_id=$('mk-conversation-select').value,text=clean($('mk-message-text').value,4000);
    if(!lead_id||!text)return;
    data.messages.push({id:uid(),lead_id,type:$('mk-message-type').value,text,at:new Date().toISOString()});
    const lead=find(lead_id);
    if(lead&&$('mk-message-type').value==='inbound'&&!['Partner','Negotiating'].includes(lead.stage))lead.stage='Replied';
    if(lead&&$('mk-message-type').value==='outbound'&&['New','Qualified','Drafted'].includes(lead.stage))lead.stage='Contacted';
    if(lead)lead.updated=new Date().toISOString();
    if(save()){$('mk-message-text').value='';render();notice('Conversation event recorded manually.');}
  });
  $('mk-draft-close').addEventListener('click',()=>$('mk-draft-dialog').close());
  $('mk-draft-form').addEventListener('submit',generate);
  $('mk-template').addEventListener('click',manualTemplate);
  $('mk-copy').addEventListener('click',copyDraft);
  $('mk-mark-drafted').addEventListener('click',saveDraft);
  $('mk-save-settings').addEventListener('click',()=>{data.style=clean($('mk-style').value,2000);if(save())notice('Brand voice saved for future drafting.');});
  $('mk-export-csv').addEventListener('click',exportCSV);
  $('mk-export-json').addEventListener('click',()=>download('AltaPure-Marketing-Backup.json',JSON.stringify(data,null,2),'application/json'));
  $('mk-import-button').addEventListener('click',()=>$('mk-import-csv').click());
  $('mk-import-csv').addEventListener('change',async e=>{
    try{importCSV(await fileText(e.target.files?.[0]));}catch(err){notice(err.message,true);}finally{e.target.value='';}
  });
  $('mk-import-json').addEventListener('change',async e=>{
    try{
      const raw=JSON.parse(await fileText(e.target.files?.[0]));
      if(!Array.isArray(raw.leads))throw Error('Backup must contain a leads array.');
      if(!confirm('Restore this backup? It will replace all browser-local marketing data.'))return;
      data={leads:raw.leads.slice(0,5000).map(normalize),messages:Array.isArray(raw.messages)?raw.messages.slice(-10000):[],style:clean(raw.style,2000)||original.style};
      if(save()){render();notice('Backup restored.');}
    }catch(err){notice(err.message,true);}finally{e.target.value='';}
  });

  $('mk-ig-thread').addEventListener('change',renderInstagram);
  $('mk-ig-connect').addEventListener('click',async()=>{
    try{
      const result=await endpoint({action:'instagram_connect'});
      if(result.authorization_url)location.assign(result.authorization_url);
    }catch(err){notice(err.message,true);}
  });
  $('mk-ig-sync').addEventListener('click',()=>refreshInstagram(true));
  $('mk-ig-disconnect').addEventListener('click',async()=>{
    if(!confirm('Disconnect this Instagram account and delete its stored inbox history?'))return;
    try{await endpoint({action:'instagram_disconnect'});await refreshInstagram();notice('Instagram disconnected.');}catch(err){notice(err.message,true);}
  });
  $('mk-ig-send').addEventListener('click',async()=>{
    const recipient_id=$('mk-ig-thread').value,message=$('mk-ig-reply').value.trim();
    if(!recipient_id||!message)return;
    if(!confirm('Send this exact reply through the connected Instagram account?'))return;
    $('mk-ig-send').disabled=true;
    try{
      await endpoint({action:'instagram_send',recipient_id,message});
      $('mk-ig-reply').value='';await refreshInstagram();notice('Instagram confirmed the reply was sent.');
    }catch(err){notice(err.message,true);renderInstagram();}
  });
  const existing=accountPassword();
  if(existing)login(existing);
})();