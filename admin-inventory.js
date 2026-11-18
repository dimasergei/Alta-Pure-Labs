(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const API = '/api/customer-config?inventory=1';
  const PAGE_SIZE = 25, ACTIVITY_SIZE = 50, MAX_INTEGER = 2147483647;
  const COLUMNS = ['sku','product_name','strength','quantity','unit','minimum','unit_cost','currency','location','notes'];
  const META = COLUMNS.filter(name => name !== 'quantity');
  const UNITS = ['vial','pen','bottle','pack','unit'];
  const STATUS = { in:'In stock',low:'Low stock',out:'Out of stock',unknown:'Not counted',archived:'Archived' };
  let items = [], loaded = false, loggedIn = false, page = 0, activeView = 'stock';
  let activityOffset = 0, activityLoaded = false, activityMore = false;
  let epoch = 0, readGeneration = 0, activityGeneration = 0, opening = null, loading = null;
  let editor = null, adjustment = null, importRows = null, skuTouched = false, retryAction = null;
  const archiveRequests = new Map();
  const numberFormat = new Intl.NumberFormat();
  const dateFormat = new Intl.DateTimeFormat(undefined, {month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});

  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text !== undefined && text !== null) element.textContent = String(text);
    if (className) element.className = className;
    return element;
  }
  function button(text, handler, className, label) {
    const element = node('button', text, className); element.type = 'button';
    if (label) { element.setAttribute('aria-label',label); element.title = label; }
    element.addEventListener('click',handler); return element;
  }
  function quantityText(value) { return value === null || value === undefined ? 'Not counted' : numberFormat.format(value); }
  function displayName(item) { return item.product_name + (item.strength ? ' · '+item.strength : ''); }
  function stockStatus(item) {
    if (item.archived) return 'archived';
    if (item.quantity === null || item.quantity === undefined) return 'unknown';
    if (item.quantity === 0) return 'out';
    return item.quantity <= item.minimum ? 'low' : 'in';
  }
  function unitHint(unit) {
    if (unit === 'vial') return 'Count individual vials. A box of 10 adds 10.';
    if (unit === 'pack') return 'Count sealed packs. One pack counts as 1.';
    return 'Count individual '+(unit === 'unit' ? 'items' : unit+'s')+'.';
  }
  function saveStatus(text, state='saved') { $('iv-save-text').textContent=text; $('iv-save-status').dataset.state=state; }
  function notice(text, error=false, retry=null) {
    $('iv-notice-text').textContent=text || ''; $('iv-notice').hidden=!text;
    $('iv-notice').classList.toggle('is-error',error); retryAction=retry; $('iv-retry').hidden=!retry;
  }
  function formMessage(prefix,text,info=false) {
    const target=$(prefix+'-error'); target.textContent=text || ''; target.hidden=!text; target.classList.toggle('is-info',info);
  }
  function controlsReady() {
    for (const id of ['iv-add','iv-import']) $(id).disabled=!loaded;
    $('iv-export').disabled=!loaded || filteredItems().length===0;
    $('iv-refresh').disabled=!loggedIn || Boolean(loading);
  }
  function formBusy(form,busy,expectedTicket) {
    if(expectedTicket!==undefined && expectedTicket!==form._busyTicket) return;
    if (busy) {
      form._busyTicket=(form._busyTicket || 0)+1;
      form._disabledStates=[...form.elements].map(element=>[element,element.disabled]);
      for(const [element] of form._disabledStates) element.disabled=true;
    } else {
      for(const [element,wasDisabled] of form._disabledStates || []) element.disabled=wasDisabled;
      form._disabledStates=null;
      form._busyTicket=(form._busyTicket || 0)+1;
    }
    form.dataset.busy=String(busy); form.setAttribute('aria-busy',String(busy));
    return form._busyTicket;
  }
  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const bytes=crypto.getRandomValues(new Uint8Array(16)); bytes[6]=(bytes[6]&15)|64; bytes[8]=(bytes[8]&63)|128;
    const text=[...bytes].map(byte=>byte.toString(16).padStart(2,'0')).join('');
    return text.slice(0,8)+'-'+text.slice(8,12)+'-'+text.slice(12,16)+'-'+text.slice(16,20)+'-'+text.slice(20);
  }
  // Reusing a request ID for an unchanged retry prevents a timed-out save being applied twice.
  function mutationBody(owner,body) {
    const key=JSON.stringify(body);
    if (!owner._request || owner._request.key!==key) owner._request={key,id:uuid()};
    return {...body,request_id:owner._request.id};
  }
  async function request(body,query='') {
    const ticket=epoch;
    let response;
    try {
      response=await window.PureAdminAuth.fetch(API+query,body ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)} : {method:'GET'});
    } catch(error) {
      if(ticket!==epoch) {const failure=new Error('Sign in to continue.');failure.code='SESSION_CHANGED';throw failure;}
      if (error.status===401 || !window.PureAdminAuth.authenticated) { showLogin('Sign in to continue.');const failure=new Error('Sign in to continue.');failure.code='SESSION_CHANGED';throw failure; }
      const failure=new Error('Could not reach Inventory. Your entries are still here. Try again.'); failure.network=true; throw failure;
    }
    const payload=await response.json().catch(()=>null);
    if (ticket!==epoch || !window.PureAdminAuth.authenticated) {const failure=new Error('Sign in to continue.');failure.code='SESSION_CHANGED';throw failure;}
    if (!response.ok) {
      const failure=new Error(payload?.error || 'Inventory could not complete that request. Try again.');
      failure.status=response.status; failure.code=payload?.code; failure.uncertain=response.status>=500; throw failure;
    }
    if (!payload || typeof payload!=='object') { const failure=new Error('The server response could not be read. Try again.'); failure.network=true; throw failure; }
    return payload;
  }
  function emptyRow(target,span,title,description,action) {
    const tr=node('tr'), td=node('td',null,'iv-empty'); td.colSpan=span;
    if(title) td.append(node('strong',title));
    if(description) td.append(node('div',description));
    if(action) td.append(action); tr.append(td); target.replaceChildren(tr);
  }
  async function loadItems(quiet=false) {
    if (loading) return loading;
    const session=epoch, ticket=++readGeneration;
    saveStatus('Loading…','loading'); $('iv-refresh').disabled=true;
    loading=(async()=>{
      try {
        const result=await request();
        if (!Array.isArray(result.items)) throw new Error('The stock list could not be read. Try again.');
        if (session!==epoch || ticket!==readGeneration) return false;
        items=result.items; loaded=true; renderStock(); saveStatus('Up to date');
        if(!quiet) notice(''); return true;
      } catch(error) {
        if(session!==epoch) return false;
        saveStatus('Connection needs attention','error'); notice(error.message,true,()=>loadItems());
        if(!loaded) emptyRow($('iv-items'),8,'Inventory could not load','Your saved items will appear when the connection is restored.',button('Try again',()=>loadItems(),'iv-button'));
        return false;
      } finally { if(session===epoch) { loading=null; controlsReady(); } }
    })();
    return loading;
  }
  function upsert(savedItems) {
    ++readGeneration;
    for(const item of savedItems) {
      const at=items.findIndex(current=>current.id===item.id);
      if(at<0) items.push(item); else items[at]=item;
    }
    loaded=true; renderStock(); controlsReady(); saveStatus('Saved'); activityLoaded=false;
    if(activeView==='activity') { activityOffset=0; void loadActivity(); }
  }
  function filteredItems() {
    const query=$('iv-search').value.trim().toLocaleLowerCase(), filter=$('iv-filter-status').value, unit=$('iv-filter-unit').value;
    const filtered=items.filter(item=>{
      const status=stockStatus(item);
      if(filter==='archived' ? !item.archived : item.archived) return false;
      if(!['active','archived'].includes(filter) && status!==filter) return false;
      if(unit && item.unit!==unit) return false;
      return !query || [item.product_name,item.strength,item.sku,item.location,item.notes].join(' ').toLocaleLowerCase().includes(query);
    });
    const compareName=(a,b)=>String(a.product_name).localeCompare(String(b.product_name),undefined,{numeric:true}) || String(a.strength).localeCompare(String(b.strength),undefined,{numeric:true});
    return filtered.sort((a,b)=>{
      switch($('iv-sort').value) {
        case 'quantity': return (a.quantity===null ? Infinity : a.quantity)-(b.quantity===null ? Infinity : b.quantity) || compareName(a,b);
        case 'recent': return String(b.updated_at || '').localeCompare(String(a.updated_at || '')) || compareName(a,b);
        case 'sku': return String(a.sku).localeCompare(String(b.sku),undefined,{numeric:true});
        default:return compareName(a,b);
      }
    });
  }
  function renderStock() {
    if(!loaded) return;
    const active=items.filter(item=>!item.archived);
    $('iv-stat-total').textContent=numberFormat.format(active.length);
    for(const [id,status] of [['low','low'],['out','out'],['unknown','unknown']]) $('iv-stat-'+id).textContent=numberFormat.format(active.filter(item=>stockStatus(item)===status).length);
    const filtered=filteredItems(), pages=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE)); page=Math.min(page,pages-1);
    const target=$('iv-items'); target.replaceChildren();
    if(!filtered.length) {
      const isNew=items.length===0;
      emptyRow(target,8,isNew?'Your stock list starts here':'No items in this view',isNew?'Add an item or import a CSV to start tracking.':'Try another search or filter.',isNew?button('+ Add your first item',()=>openEditor(),'iv-button iv-primary'):null);
    }
    for(const item of filtered.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE)) {
      const tr=node('tr'); tr.dataset.itemId=item.id;
      const identity=node('td'); identity.append(button(item.product_name,()=>openEditor(item.id),'iv-product-name','Edit '+displayName(item)),node('span',item.strength || '—','iv-secondary'));
      const sku=node('td',item.sku,'iv-sku'), count=node('td',null,'iv-number');
      const countButton=button(item.quantity===null?'—':numberFormat.format(item.quantity),()=>openAdjustment(item.id,'set'),'iv-quantity'+(item.quantity===null?' is-unknown':''),'Record a count for '+displayName(item)+'. Current: '+quantityText(item.quantity));
      countButton.disabled=Boolean(item.archived); count.append(countButton);
      const unit=node('td',item.unit), minimum=node('td',numberFormat.format(item.minimum),'iv-number'), location=node('td',item.location || '—');
      location.title=item.location || ''; const status=node('td'); status.append(node('span',STATUS[stockStatus(item)],'iv-status iv-status-'+stockStatus(item)));
      const actions=node('td'), actionWrap=node('div',null,'iv-row-actions');
      actionWrap.append(button('Edit',()=>openEditor(item.id),null,'Edit '+displayName(item)));
      if(!item.archived) {
        for(const [label,mode,title] of [['+','add','Stock in'],['−','remove','Stock out']]) {
          const action=button(label,()=>openAdjustment(item.id,mode),'iv-adjust-shortcut',title+' — '+displayName(item));
          action.disabled=item.quantity===null || (mode==='remove' && item.quantity===0); actionWrap.append(action);
        }
      }
      actionWrap.append(button(item.archived?'Restore':'Archive',event=>archiveItem(item.id,!item.archived,event.currentTarget),'iv-archive-action',(item.archived?'Restore ':'Archive ')+displayName(item)));
      actions.append(actionWrap); tr.append(identity,sku,count,unit,minimum,location,status,actions); target.append(tr);
    }
    $('iv-record-count').textContent=filtered.length ? (page*PAGE_SIZE+1)+'–'+Math.min((page+1)*PAGE_SIZE,filtered.length)+' of '+numberFormat.format(filtered.length)+' items' : '0 items';
    $('iv-page-label').textContent='Page '+(page+1)+' of '+pages; $('iv-prev').disabled=page===0; $('iv-next').disabled=page>=pages-1;
    $('iv-export').disabled=filtered.length===0; $('iv-export').title='Export all '+filtered.length+' items in the current view';
  }
  function integer(value,label,nullable=false) {
    const text=String(value ?? '').trim(); if(!text && nullable) return null;
    if(!/^\d+$/.test(text) || !Number.isSafeInteger(Number(text)) || Number(text)>MAX_INTEGER) throw new Error(label+' must be a whole number from 0 to '+numberFormat.format(MAX_INTEGER)+'.');
    return Number(text);
  }
  function costValue(value) {
    const text=String(value ?? '').trim(); if(!text) return null;
    const amount=Number(text);
    if(!/^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(text) || !Number.isFinite(amount) || amount<0 || amount>9999999999.99) throw new Error('Unit cost must be a decimal amount or zero, with no more than two decimal places.');
    return amount;
  }
  function validateItem(input,includeQuantity=true) {
    const item={sku:String(input.sku || '').trim().toUpperCase(),product_name:String(input.product_name || '').trim(),strength:String(input.strength || '').trim(),unit:String(input.unit || 'vial').trim().toLowerCase(),minimum:integer(input.minimum === '' || input.minimum === undefined ? 0 : input.minimum,'Minimum'),unit_cost:costValue(input.unit_cost),currency:String(input.currency || 'USD').trim().toUpperCase(),location:String(input.location || '').trim(),notes:String(input.notes || '').trim()};
    if(!item.product_name || item.product_name.length>160) throw new Error('Enter a product name of up to 160 characters.');
    if(!/^[A-Z0-9][A-Z0-9._-]{0,63}$/.test(item.sku)) throw new Error('Enter a unique SKU of up to 64 letters, numbers, dots, dashes or underscores.');
    if(!UNITS.includes(item.unit)) throw new Error('Unit must be vial, pen, bottle, pack or unit.');
    if(!['CAD','USD'].includes(item.currency)) throw new Error('Currency must be CAD or USD.');
    for(const [key,max] of [['strength',80],['location',120],['notes',2000]]) if(item[key].length>max) throw new Error(key+' is too long (maximum '+max+' characters).');
    if(includeQuantity) item.quantity=integer(input.quantity,'Quantity',true); return item;
  }
  function editorValues(includeQuantity=true) {
    return validateItem({product_name:$('iv-name').value,strength:$('iv-strength').value,sku:$('iv-sku').value,unit:$('iv-unit').value,minimum:$('iv-minimum').value,quantity:$('iv-opening').value,unit_cost:$('iv-cost').value,currency:$('iv-currency').value,location:$('iv-location').value,notes:$('iv-notes').value},includeQuantity);
  }
  function fillEditor(item) {
    for(const [id,key] of [['iv-name','product_name'],['iv-strength','strength'],['iv-sku','sku'],['iv-unit','unit'],['iv-minimum','minimum'],['iv-opening','quantity'],['iv-location','location'],['iv-cost','unit_cost'],['iv-currency','currency'],['iv-notes','notes']]) $(id).value=item[key] ?? '';
    $('iv-unit-help').textContent=unitHint(item.unit);
  }
  function openEditor(id) {
    if(!loaded) return;
    const existing=items.find(item=>item.id===id);
    editor=existing ? {id:existing.id,version:existing.version,base:{...existing}} : {id:null,version:null,base:null};
    const form=$('iv-item-form'); form.reset(); delete form._request; skuTouched=Boolean(existing);
    fillEditor(existing || {product_name:'',strength:'',sku:'',unit:'vial',minimum:0,quantity:null,unit_cost:null,currency:'USD',location:'',notes:''});
    $('iv-opening-field').hidden=Boolean(existing); $('iv-opening').disabled=Boolean(existing);
    $('iv-editor-title').textContent=existing?'Edit item':'Add item'; $('iv-editor-save').textContent=existing?'Save changes':'Add item';
    $('iv-item-details').open=Boolean(existing && (existing.location || existing.notes || existing.unit_cost!==null));
    formMessage('iv-editor',''); $('iv-editor-reload').hidden=true; $('iv-editor').showModal(); $('iv-name').focus();
  }
  function suggestSku() {
    if(editor?.id || skuTouched) return;
    const suffix={vial:'V',pen:'PEN',bottle:'BOT',pack:'PK',unit:'EA'}[$('iv-unit').value];
    const value=[$('iv-name').value,$('iv-strength').value,suffix].filter(Boolean).join('-').toUpperCase().replace(/[^A-Z0-9._-]+/g,'-').replace(/-+/g,'-').replace(/^[^A-Z0-9]+|[-.]+$/g,'').slice(0,64);
    $('iv-sku').value=$('iv-name').value.trim()?value:'';
  }
  function handleFormError(prefix,error) {
    if(error.code==='SESSION_CHANGED' || !loggedIn) return;
    const conflict=error.code==='VERSION_CONFLICT';
    formMessage(prefix,conflict?'This item changed in another tab. Your entries are still here. Load the latest saved details, review your changes, then save again.':error.message);
    $(prefix+'-reload').hidden=!conflict; saveStatus(error.network || error.uncertain?'Save not confirmed':'Changes not saved','error');
  }
  async function saveItem(event) {
    event.preventDefault(); const form=$('iv-item-form'); if(form.dataset.busy==='true' || !editor) return;
    let busyTicket;const session=epoch;
    formMessage('iv-editor',''); $('iv-editor-reload').hidden=true;
    try {
      const item=editorValues(!editor.id);
      let body={action:'create',item};
      if(editor.id) {
        const changed={}; for(const key of META) if((editor.base[key] ?? '')!==(item[key] ?? '')) changed[key]=item[key];
        if(!Object.keys(changed).length) { $('iv-editor').close(); notice('No changes to save.'); return; }
        body={action:'update',id:editor.id,expected_version:editor.version,item:changed};
      }
      busyTicket=formBusy(form,true); saveStatus('Saving…','saving');
      const result=await request(mutationBody(form,body));
      if(session!==epoch || !loggedIn)return;
      if(!result.item?.id) throw new Error('The saved item could not be read. Refresh the list before trying again.');
      upsert([result.item]); delete form._request; $('iv-editor').close(); notice(editor.id?'Item updated.':'Item added.');
    } catch(error) { if(session===epoch)handleFormError('iv-editor',error); }
    finally { if(busyTicket!==undefined) formBusy(form,false,busyTicket); }
  }
  async function reloadEditor() {
    if(!editor?.id) return;
    const form=$('iv-item-form'),session=epoch;let busyTicket;
    try {
      const draft=editorValues(false), changed={};
      for(const key of META) if((editor.base[key] ?? '')!==(draft[key] ?? '')) changed[key]=draft[key];
      busyTicket=formBusy(form,true);
      if(!await loadItems(true)) throw new Error('Could not refresh this item. Your entries are still here.');
      if(session!==epoch || !editor)return;
      const latest=items.find(item=>item.id===editor.id); if(!latest) throw new Error('This item is no longer available.');
      const conflicts=Object.keys(changed).filter(key=>(editor.base[key] ?? '')!==(latest[key] ?? ''));
      editor={id:latest.id,version:latest.version,base:{...latest}}; fillEditor({...latest,...changed}); delete form._request;
      formMessage('iv-editor','Latest details loaded. Your edits are kept; review them before saving.'+(conflicts.length?'\nLatest saved values: '+conflicts.map(key=>key.replace(/_/g,' ')+': '+(latest[key] ?? 'blank')).join('; '):''),true); $('iv-editor-reload').hidden=true;
    } catch(error) { if(session===epoch)formMessage('iv-editor',error.message); }
    finally { if(busyTicket!==undefined) formBusy(form,false,busyTicket); }
  }
  function openAdjustment(id,mode) {
    const item=items.find(current=>current.id===id); if(!item || item.archived) return;
    adjustment={...item}; const form=$('iv-adjust-form'); form.reset(); delete form._request;
    $('iv-adjust-mode').value=item.quantity===null?'set':mode; $('iv-adjust-quantity').value='';
    $('iv-adjust-item').textContent=displayName(item)+' · '+item.sku;
    $('iv-current-quantity').textContent=quantityText(item.quantity); $('iv-adjust-unit-help').textContent=unitHint(item.unit);
    for(const option of $('iv-adjust-mode').options) option.disabled=item.quantity===null && option.value!=='set';
    formMessage('iv-adjust',''); $('iv-adjust-reload').hidden=true; updateAdjustmentPreview(); $('iv-adjuster').showModal(); $('iv-adjust-quantity').focus();
  }
  function updateAdjustmentPreview() {
    if(!adjustment) return;
    const mode=$('iv-adjust-mode').value, raw=$('iv-adjust-quantity').value, value=Number(raw);
    const title=mode==='set'?'Record a count':mode==='add'?'Stock in':'Stock out';
    $('iv-adjust-title').textContent=title; $('iv-adjust-quantity-label').textContent=mode==='set'?'New quantity':mode==='add'?'Quantity to add':'Quantity to remove';
    $('iv-adjust-quantity').min=mode==='set'?'0':'1'; $('iv-adjust-save').textContent=mode==='set'?'Save count':mode==='add'?'Add stock':'Remove stock';
    if(!raw || !Number.isInteger(value) || value<0) { $('iv-adjust-preview').textContent=''; return; }
    const next=mode==='set'?value:mode==='add'?adjustment.quantity+value:adjustment.quantity-value;
    $('iv-adjust-preview').textContent=next<0?'This would remove more than the current count.':'After saving: '+numberFormat.format(next)+' '+adjustment.unit+(next===1?'':'s')+'.';
  }
  async function saveAdjustment(event) {
    event.preventDefault(); const form=$('iv-adjust-form'); if(form.dataset.busy==='true' || !adjustment) return;
    let busyTicket;const session=epoch;
    formMessage('iv-adjust',''); $('iv-adjust-reload').hidden=true;
    try {
      const mode=$('iv-adjust-mode').value, amount=integer($('iv-adjust-quantity').value,'Quantity'), reason=$('iv-adjust-reason').value.trim();
      if(!reason) throw new Error('Add a short note for this stock change.');
      if(mode!=='set' && (adjustment.quantity===null || amount===0)) throw new Error(adjustment.quantity===null?'Record a first count before adding or removing stock.':'Enter a quantity greater than zero.');
      if(mode==='remove' && amount>adjustment.quantity) throw new Error('You cannot remove more than the current count.');
      const body={action:'adjust',id:adjustment.id,expected_version:adjustment.version,mode,quantity:amount,reason};
      busyTicket=formBusy(form,true); saveStatus('Saving…','saving'); const result=await request(mutationBody(form,body));
      if(session!==epoch || !loggedIn)return;
      if(!result.item?.id) throw new Error('The saved count could not be read. Refresh the list before trying again.');
      upsert([result.item]); delete form._request; $('iv-adjuster').close(); notice('Stock count saved.');
    } catch(error) { if(session===epoch)handleFormError('iv-adjust',error); }
    finally { if(busyTicket!==undefined) formBusy(form,false,busyTicket); }
  }
  async function reloadAdjustment() {
    const form=$('iv-adjust-form'); if(!adjustment) return;
    const session=epoch,busyTicket=formBusy(form,true);
    try {
      if(!await loadItems(true)) throw new Error('Could not refresh this count. Your entries are still here.');
      if(session!==epoch || !adjustment)return;
      const latest=items.find(item=>item.id===adjustment.id); if(!latest) throw new Error('This item is no longer available.');
      if(latest.archived) throw new Error('This item is archived. Restore it from the stock list before changing its count.');
      adjustment={...latest}; $('iv-current-quantity').textContent=quantityText(latest.quantity); delete form._request;
      for(const option of $('iv-adjust-mode').options) option.disabled=latest.quantity===null && option.value!=='set';
      if(latest.quantity===null) $('iv-adjust-mode').value='set'; updateAdjustmentPreview();
      formMessage('iv-adjust','Latest count loaded. Your entry and note are kept. Review the new total before saving.',true); $('iv-adjust-reload').hidden=true;
    } catch(error) { if(session===epoch)formMessage('iv-adjust',error.message); }
    finally { formBusy(form,false,busyTicket); }
  }
  async function archiveItem(id,archived,trigger) {
    const item=items.find(current=>current.id===id); if(!item || trigger.disabled) return;
    const session=epoch;
    let owner=archiveRequests.get(id); if(!owner) {owner={};archiveRequests.set(id,owner);} trigger.disabled=true; saveStatus('Saving…','saving');
    try {
      const result=await request(mutationBody(owner,{action:'archive',id,expected_version:item.version,archived}));
      if(session!==epoch || !loggedIn)return;
      if(!result.item?.id) throw new Error('The item could not be read. Refresh the list to check its status.');
      upsert([result.item]); archiveRequests.delete(id); notice(archived?'Item archived. You can restore it from the Archived filter.':'Item restored.');
    } catch(error) { if(session!==epoch || error.code==='SESSION_CHANGED' || !loggedIn)return;saveStatus(error.network || error.uncertain?'Save not confirmed':'Changes not saved','error'); notice(error.code==='VERSION_CONFLICT'?'This item changed in another tab. Refresh the list, then try again.':error.message,true,()=>loadItems()); }
    finally { trigger.disabled=false; }
  }

  async function loadActivity() {
    const session=epoch, ticket=++activityGeneration, offset=activityOffset;
    $('iv-activity-prev').disabled=true; $('iv-activity-next').disabled=true;
    emptyRow($('iv-events'),5,null,'Loading activity…');
    try {
      const result=await request(null,'&view=activity&offset='+offset+'&page_size='+ACTIVITY_SIZE);
      if(session!==epoch || ticket!==activityGeneration) return;
      if(!Array.isArray(result.events)) throw new Error('Activity could not be read. Try again.');
      const target=$('iv-events'); target.replaceChildren(); activityMore=Boolean(result.has_more); activityLoaded=true;
      if(!result.events.length) emptyRow(target,5,'No activity yet','Your saved stock changes will appear here.');
      for(const event of result.events) {
        const tr=node('tr'), date=node('td'); const parsed=new Date(event.created_at);
        date.textContent=Number.isNaN(parsed.valueOf())?'—':dateFormat.format(parsed);
        const item=node('td'); item.append(node('strong',event.product_name || event.sku),node('span',[event.strength,event.sku].filter(Boolean).join(' · '),'iv-secondary'));
        const labels={create:'Item added',import:'Imported',update:'Details edited',archive:'Archived',restore:'Restored'};
        const label=event.action==='adjust'?({add:'Stock in',remove:'Stock out',set:'Count recorded'}[event.mode] || 'Count updated'):(labels[event.action] || 'Item updated');
        const changed=node('td',label);
        const changes=event.changes && typeof event.changes==='object' ? Object.entries(event.changes).filter(([key])=>META.includes(key)) : [];
        if(changes.length) {
          const details=node('details',null,'iv-change-details'), list=node('ul'); details.append(node('summary','View changes'));
          for(const [key,values] of changes) list.append(node('li',key.replace(/_/g,' ')+': '+String(values?.before ?? 'blank')+' → '+String(values?.after ?? 'blank')));
          details.append(list); changed.append(details);
        }
        const before=event.quantity_before, after=event.quantity_after;
        const counts=node('td',before===after ? quantityText(after) : quantityText(before)+' → '+quantityText(after));
        const note=node('td',event.reason || '—','iv-activity-note'); tr.append(date,item,changed,counts,note); target.append(tr);
      }
      $('iv-activity-count').textContent=result.events.length ? 'Showing '+(offset+1)+'–'+(offset+result.events.length)+' changes' : '0 changes on this page';
      $('iv-activity-page').textContent='Page '+(Math.floor(offset/ACTIVITY_SIZE)+1); $('iv-activity-prev').disabled=offset===0; $('iv-activity-next').disabled=!activityMore;
    } catch(error) {
      if(session!==epoch || ticket!==activityGeneration) return;
      emptyRow($('iv-events'),5,'Activity could not load',error.message,button('Try again',()=>loadActivity(),'iv-button'));
      $('iv-activity-prev').disabled=offset===0; $('iv-activity-count').textContent='Connection needs attention';
    }
  }
  function switchView(view) {
    activeView=view;
    for(const name of ['stock','activity']) {
      const selected=name===view; $( 'iv-'+name+'-tab').classList.toggle('is-active',selected); $('iv-'+name+'-tab').setAttribute('aria-selected',String(selected)); $('iv-'+name+'-tab').tabIndex=selected?0:-1; $('iv-'+name+'-panel').hidden=!selected;
    }
    if(view==='activity' && !activityLoaded) void loadActivity();
  }

  function parseCSV(text) {
    text=String(text).replace(/^\uFEFF/,''); const rows=[]; let row=[],field='',quoted=false,closedQuote=false;
    function finishField() { row.push(field);field='';closedQuote=false; }
    function finishRow() { finishField();if(row.some(value=>value.trim()!=='')) rows.push(row);row=[];if(rows.length>501) throw new Error('Import up to 500 items at a time.'); }
    for(let i=0;i<text.length;i++) {
      const char=text[i];
      if(quoted) { if(char==='"') { if(text[i+1]==='"'){field+='"';i++;}else{quoted=false;closedQuote=true;} } else field+=char; continue; }
      if(char===','){finishField();continue;}
      if(char==='\n' || char==='\r'){if(char==='\r' && text[i+1]==='\n')i++;finishRow();continue;}
      if(closedQuote){if(char===' ' || char==='\t')continue;throw new Error('The CSV has text after a closing quote. Check row '+(rows.length+1)+'.');}
      if(char==='"'){if(field.length)throw new Error('The CSV has an unexpected quote near row '+(rows.length+1)+'.');quoted=true;}else field+=char;
    }
    if(quoted)throw new Error('The CSV contains an unclosed quote.');
    if(field.length || row.length || closedQuote)finishRow();
    if(rows.length<2)throw new Error('Add at least one item below the CSV header.');
    const header=rows.shift().map(value=>value.trim().toLowerCase());
    if(new Set(header).size!==header.length)throw new Error('The CSV has duplicate column names.');
    if(!header.includes('sku') || !header.includes('product_name'))throw new Error('The CSV needs sku and product_name columns. Download the template to get started.');
    const unknown=header.filter(value=>!COLUMNS.includes(value));if(unknown.length)throw new Error('Unrecognized CSV column: '+unknown.join(', ')+'. Use the template column names.');
    return rows.map((cells,index)=>{
      if(cells.length!==header.length)throw new Error('Row '+(index+2)+' has '+cells.length+' columns; expected '+header.length+'.');
      const raw=Object.fromEntries(header.map((name,column)=>[name,cells[column]]));
      try{return validateItem(raw);}catch(error){throw new Error('Row '+(index+2)+': '+error.message);}
    });
  }
  function csvCell(value) {
    let text=value===null || value===undefined?'':String(value);
    // Keep the protective apostrophe literal on reimport: stripping it could alter intentional text.
    if(/^[\s\u0000-\u001f]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text="'"+text;
    return '"'+text.replace(/"/g,'""')+'"';
  }
  function csvText(rows) { return '\uFEFF'+COLUMNS.join(',')+'\r\n'+rows.map(row=>COLUMNS.map(name=>csvCell(row[name])).join(',')).join('\r\n')+(rows.length?'\r\n':''); }
  function download(name,text) {
    const url=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'})), link=node('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function openImport() {
    if(!loaded)return;const form=$('iv-import-form');form.reset();delete form._request;importRows=null;
    $('iv-import-preview').hidden=true;$('iv-import-save').hidden=true;$('iv-preview-button').hidden=false;formMessage('iv-import','');$('iv-importer').showModal();
  }
  function clearImportPreview() { importRows=null;delete $('iv-import-form')._request;$('iv-import-preview').hidden=true;$('iv-import-save').hidden=true;$('iv-preview-button').hidden=false;formMessage('iv-import',''); }
  async function previewImport(event) {
    event.preventDefault();const form=$('iv-import-form');if(form.dataset.busy==='true')return;clearImportPreview();
    let busyTicket;const session=epoch;
    try {
      const file=$('iv-csv-file').files?.[0];if(!file)throw new Error('Choose a CSV file first.');if(file.size>2*1024*1024)throw new Error('Choose a CSV smaller than 2 MB, with up to 500 items.');
      busyTicket=formBusy(form,true);const rows=parseCSV(await file.text());
      if(session!==epoch)return;
      const result=await request({action:'preview_import',request_id:uuid(),items:rows});
      if(session!==epoch || !loggedIn)return;
      if(!Array.isArray(result.items) || result.items.length!==rows.length)throw new Error('The import preview could not be read. Try again.');
      importRows=result.items.map(item=>Object.fromEntries(COLUMNS.map(key=>[key,item[key] ?? (['quantity','unit_cost'].includes(key)?null:'')])));
      const target=$('iv-import-rows');target.replaceChildren();
      for(const item of importRows) {const tr=node('tr'),identity=node('td');identity.append(node('strong',item.product_name),node('span',item.strength || '—','iv-secondary'));tr.append(identity,node('td',item.sku,'iv-sku'),node('td',quantityText(item.quantity)),node('td',item.unit),node('td',item.minimum));target.append(tr);}
      $('iv-import-summary').textContent=importRows.length+' new '+(importRows.length===1?'item':'items')+' ready to add';$('iv-import-preview-caption').textContent='All '+importRows.length+' rows are shown below. Review them before adding.';
      $('iv-import-save').textContent='Add '+importRows.length+' '+(importRows.length===1?'item':'items');$('iv-import-preview').hidden=false;$('iv-import-save').hidden=false;$('iv-preview-button').hidden=true;
    } catch(error) {if(session===epoch)formMessage('iv-import',error.message);}
    finally {if(busyTicket!==undefined)formBusy(form,false,busyTicket);}
  }
  async function commitImport() {
    const form=$('iv-import-form');if(form.dataset.busy==='true' || !importRows?.length)return;
    const session=epoch;
    formMessage('iv-import','');const busyTicket=formBusy(form,true);saveStatus('Saving…','saving');
    try {
      const result=await request(mutationBody(form,{action:'import',items:importRows}));
      if(session!==epoch || !loggedIn)return;
      if(!Array.isArray(result.items))throw new Error('The imported items could not be read. Retry with the same file to confirm the saved result.');
      upsert(result.items);delete form._request;$('iv-importer').close();notice(result.items.length+' '+(result.items.length===1?'item':'items')+' added.');importRows=null;
    } catch(error) {if(session!==epoch || error.code==='SESSION_CHANGED' || !loggedIn)return;formMessage('iv-import',error.message);saveStatus(error.network || error.uncertain?'Save not confirmed':'Import not saved','error');}
    finally {formBusy(form,false,busyTicket);}
  }

  function navigation(open) { $('iv-app').classList.toggle('iv-navigation-open',open);$('iv-nav-toggle').setAttribute('aria-expanded',String(open));$('iv-nav-backdrop').hidden=!open; }
  function showLogin(message) {
    ++epoch;loggedIn=false;loaded=false;items=[];loading=null;opening=null;activityLoaded=false;importRows=null;
    editor=null;adjustment=null;archiveRequests.clear();retryAction=null;skuTouched=false;page=0;activityOffset=0;activityMore=false;
    $('iv-app').hidden=true;$('iv-login').hidden=false;navigation(false);
    for(const dialog of document.querySelectorAll('.iv-dialog'))if(dialog.open)dialog.close();
    for(const id of ['iv-item-form','iv-adjust-form','iv-import-form']) {const form=$(id);formBusy(form,false);form.reset();delete form._request;}
    $('iv-items').replaceChildren();$('iv-events').replaceChildren();$('iv-import-rows').replaceChildren();
    for(const prefix of ['iv-editor','iv-adjust','iv-import'])formMessage(prefix,'');
    for(const id of ['iv-adjust-item','iv-current-quantity','iv-adjust-preview','iv-import-summary','iv-import-preview-caption'])$(id).textContent='';
    for(const name of ['total','low','out','unknown'])$('iv-stat-'+name).textContent='—';
    $('iv-search').value='';$('iv-filter-status').value='active';$('iv-filter-unit').value='';$('iv-sort').value='name';
    $('iv-record-count').textContent='';$('iv-activity-count').textContent='';$('iv-export').title='';notice('');switchView('stock');saveStatus('Signed out','loading');
    if(message){$('iv-login-error').textContent=message;$('iv-login-error').hidden=false;}controlsReady();
  }
  async function openWorkspace() {
    if(opening)return opening;if(loggedIn)return;
    loggedIn=true;$('iv-login').hidden=true;$('iv-app').hidden=false;$('iv-login-error').hidden=true;
    for(const name of ['total','low','out','unknown'])$('iv-stat-'+name).textContent='—';
    emptyRow($('iv-items'),8,null,'Loading your inventory…');
    const session=epoch;opening=loadItems().finally(()=>{if(session===epoch)opening=null;});return opening;
  }
  if(!window.PureAdminAuth){$('iv-login-error').textContent='Inventory could not start. Refresh this page to try again.';$('iv-login-error').hidden=false;return;}
  window.PureAdminAuth.bindForm({form:$('iv-login-form'),heading:$('iv-login-heading'),description:$('iv-login-description'),status:$('iv-login-status'),error:$('iv-login-error'),workspace:'inventory',onAuthenticated:openWorkspace});
  window.addEventListener('pure-admin-auth-change',event=>{if(!event.detail.authenticated)showLogin();else if(!loggedIn)void openWorkspace();});
  $('iv-logout').addEventListener('click',async()=>{try{await window.PureAdminAuth.logout();showLogin('Logged out.');}catch(error){notice(error.message,true);}});
  $('iv-add').addEventListener('click',()=>openEditor());$('iv-item-form').addEventListener('submit',saveItem);$('iv-editor-reload').addEventListener('click',reloadEditor);
  $('iv-adjust-form').addEventListener('submit',saveAdjustment);$('iv-adjust-reload').addEventListener('click',reloadAdjustment);
  for(const id of ['iv-adjust-mode','iv-adjust-quantity'])$(id).addEventListener(id==='iv-adjust-mode'?'change':'input',updateAdjustmentPreview);
  $('iv-sku').addEventListener('input',()=>{skuTouched=true;});for(const id of ['iv-name','iv-strength'])$(id).addEventListener('input',suggestSku);
  $('iv-unit').addEventListener('change',()=>{suggestSku();$('iv-unit-help').textContent=unitHint($('iv-unit').value);});
  for(const id of ['iv-search','iv-filter-status','iv-filter-unit','iv-sort'])$(id).addEventListener(id==='iv-search'?'input':'change',()=>{page=0;renderStock();});
  $('iv-prev').addEventListener('click',()=>{page=Math.max(0,page-1);renderStock();});$('iv-next').addEventListener('click',()=>{page++;renderStock();});
  $('iv-refresh').addEventListener('click',()=>{if(activeView==='activity')void loadActivity();else void loadItems();});$('iv-retry').addEventListener('click',()=>{if(retryAction)void retryAction();});
  for(const view of ['stock','activity'])$('iv-'+view+'-tab').addEventListener('click',()=>switchView(view));
  for(const [index,view] of ['stock','activity'].entries())$('iv-'+view+'-tab').addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const next=event.key==='Home'?'stock':event.key==='End'?'activity':index===0?'activity':'stock';switchView(next);$('iv-'+next+'-tab').focus();});
  $('iv-activity-prev').addEventListener('click',()=>{activityOffset=Math.max(0,activityOffset-ACTIVITY_SIZE);void loadActivity();});$('iv-activity-next').addEventListener('click',()=>{if(activityMore){activityOffset+=ACTIVITY_SIZE;void loadActivity();}});
  $('iv-import').addEventListener('click',openImport);$('iv-csv-file').addEventListener('change',clearImportPreview);$('iv-import-form').addEventListener('submit',previewImport);$('iv-import-save').addEventListener('click',commitImport);
  $('iv-template').addEventListener('click',()=>download('PURE-inventory-template.csv',csvText([])));
  $('iv-export').addEventListener('click',()=>{const rows=filteredItems();if(rows.length)download('PURE-inventory-'+new Date().toISOString().slice(0,10)+'.csv',csvText(rows));});
  for(const close of document.querySelectorAll('[data-close]'))close.addEventListener('click',()=>{const dialog=$(close.dataset.close);if(dialog.querySelector('form')?.dataset.busy!=='true')dialog.close();});
  for(const dialog of document.querySelectorAll('.iv-dialog'))dialog.addEventListener('cancel',event=>{if(dialog.querySelector('form')?.dataset.busy==='true')event.preventDefault();});
  $('iv-nav-toggle').addEventListener('click',()=>navigation(!$('iv-app').classList.contains('iv-navigation-open')));$('iv-nav-backdrop').addEventListener('click',()=>navigation(false));
  document.addEventListener('keydown',event=>{if(event.key==='Escape')navigation(false);});
  window.addEventListener('beforeunload',event=>{if(document.querySelector('.iv-form[data-busy="true"]')){event.preventDefault();event.returnValue='';}});
})();
