(() => {
  'use strict';
  // Orders are a view inside Marketing's existing authenticated administration shell.
  // The only order writes are explicit clicks in the individual Manage Order dialog.
  const $ = id => document.getElementById(id);
  const make = (tag, value, cls) => {
    const e = document.createElement(tag);
    if (value !== undefined) e.textContent = String(value ?? '');
    if (cls) e.className = cls;
    return e;
  };
  const price = (value, currency = 'USD') => {
    try { return new Intl.NumberFormat('en-US', {style:'currency', currency:currency || 'USD'}).format(Number(value || 0) / 100); }
    catch { return String((Number(value || 0) / 100).toFixed(2)) + ' ' + currency; }
  };
  const orderStatus = s => ({
    accepted:'Awaiting payment', requested:'Pending review', issued:'Payment pending',
    unfulfilled:'Unfulfilled', awaiting_supplier:'Awaiting supplier', partially_shipped:'Partially shipped',
    pending:'Pending', paid:'Paid', processing:'Processing', shipped:'Shipped', delivered:'Delivered',
    refunded:'Refunded', partially_refunded:'Partially refunded', void:'Canceled', canceled:'Canceled', expired:'Expired'
  })[String(s || '').toLowerCase()] || String(s || 'Pending').replaceAll('_',' ');
  let secret = '', page = 1, total = 0, visible = [], epoch = 0, searchTimer, activeModal = null;
  const statusField = () => $('ap-orders-status');
  const scope = () => ($('ap-orders-panel')?.hidden ? 'marketing' : 'orders');
  function feedback(text, bad = false) {
    const e = $('ap-orders-feedback');
    if (!e) return;
    e.textContent = text || '';
    e.classList.toggle('ap-orders-error', bad);
  }
  async function request(path, options = {}) {
    if (!secret) throw Error('Admin session is not signed in.');
    const r = await fetch(path, {
      ...options, cache:'no-store',
      headers:{...options.headers,'x-admin-password':secret}
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw Error(body.error || 'Orders temporarily unavailable (' + r.status + ').');
    return body;
  }
  function switchView(view) {
    const app = $('mk-app'), orders = $('ap-orders-panel');
    if (!app || !orders || app.hidden || !secret) return;
    const showOrders = view === 'orders';
    orders.hidden = !showOrders;
    for (const selector of ['.mk-title:not(.ap-orders-heading)', '#mk-alert', '.mk-metrics', '.ap-marketing-workarea', '.mk-subnav']) {
      for (const node of app.querySelectorAll(selector)) {
        if (node.closest('#ap-orders-panel')) continue;
        node.hidden = showOrders;
      }
    }
    for (const node of app.querySelectorAll('.mk-panel')) node.hidden = showOrders || node.hidden;
    // When switching back, let Marketing restore whichever one of its own subtabs was selected.
    if (!showOrders) {
      const current = app.querySelector('.mk-subtab.is-active');
      const panel = current && $('mk-panel-' + current.dataset.panel);
      if (panel) panel.hidden = false;
    }
    for (const link of app.querySelectorAll('[data-ap-workspace]')) {
      const selected = link.dataset.apWorkspace === view;
      link.classList.toggle('is-active', selected);
      if (selected) link.setAttribute('aria-current','page'); else link.removeAttribute('aria-current');
    }
    const crumb = app.querySelector('.ap-breadcrumb strong');
    if (crumb) crumb.textContent = showOrders ? 'ORDERS' : 'MARKETING';
    app.classList.remove('ap-navigation-open');
    if (showOrders) void loadOrders();
  }
  function viewFromLocation() {
    return location.hash === '#orders' || new URLSearchParams(location.search).get('view') === 'orders' && location.hash !== '#marketing' ? 'orders' : 'marketing';
  }
  function render() {
    const tbody = $('ap-orders-rows'); if (!tbody) return;
    tbody.replaceChildren();
    if (!visible.length) {
      const tr = make('tr'), td = make('td', 'No orders match this view.');
      td.colSpan = 7; tr.append(td); tbody.append(tr);
    }
    for (const order of visible) {
      const tr = make('tr');
      tr.dataset.orderSource = order.source || 'store';
      const number = make('td', order.order_number || order.id);
      const customer = make('td');
      customer.append(make('span', order.customer_name || 'Customer', 'ap-order-name'), make('span', order.customer_email || '', 'ap-order-email'));
      const date = make('td', order.created_at ? new Date(order.created_at).toLocaleString() : '—');
      const cost = make('td', price(order.total_cents, order.currency));
      const pay = make('td'), ship = make('td');
      pay.append(make('span', orderStatus(order.payment_status),'ap-order-status ' + String(order.payment_status || '').toLowerCase()));
      ship.append(make('span', orderStatus(order.fulfillment_status),'ap-order-status ' + String(order.fulfillment_status || '').toLowerCase()));
      const action = make('td'), manage = make('button', 'Manage Order','mk-button mk-outline');
      manage.type = 'button';
      manage.addEventListener('click', async () => {
        manage.disabled = true;
        try {
          if (order.source === 'commerce') await window.AltaFulfillment.manage(order.id);
          else showLegacyDetail(order);
        } catch (error) { feedback(error.message, true); }
        finally { manage.disabled = false; }
      });
      action.append(manage); tr.append(number, customer, date, cost, pay, ship, action); tbody.append(tr);
    }
    const first = total ? (page - 1) * 25 + 1 : 0;
    const last = total ? first + visible.length - 1 : 0;
    $('ap-orders-page-summary').textContent = first + '–' + last + ' of ' + total + ' orders';
    $('ap-orders-previous').disabled = page <= 1;
    $('ap-orders-next').disabled = page * 25 >= total;
  }
  async function loadOrders() {
    if (!secret || scope() !== 'orders') return;
    const ticket = ++epoch;
    feedback('Loading orders…');
    try {
      const params = new URLSearchParams({
        status:statusField().value, sort:$('ap-orders-sort').value,
        search:$('ap-orders-search').value.trim(), page:String(page), page_size:'25'
      });
      const data = await request('/api/admin-workspace-orders?' + params);
      if (ticket !== epoch || scope() !== 'orders') return;
      visible = Array.isArray(data.orders) ? data.orders : [];
      total = Number(data.pagination?.total || 0);
      render(); feedback('');
    } catch (error) {
      if (ticket !== epoch) return;
      visible = []; total = 0; render(); feedback(error.message, true);
    }
  }
  function legacyField(form, label, name, value, tag = 'input') {
    const lbl = make('label',label,'uc-input-field');
    const input = make(tag);
    input.name = name; input.value = value == null ? '' : String(value);
    lbl.append(input); form.append(lbl); return input;
  }
  function showLegacyDetail(order) {
    activeModal?.remove();
    const d = make('dialog',undefined,'fh-dialog uc-dialog');
    activeModal = d;
    d.addEventListener('close',()=>{d.remove();if(activeModal===d)activeModal=null;});
    const header=make('div',undefined,'uc-dialog-head');
    header.append(make('h2',order.order_number || order.id));
    const close=make('button','Close','mk-button mk-outline');close.type='button';close.onclick=()=>d.close();header.append(close);d.append(header);
    const note=make('p','', 'uc-message');note.setAttribute('role','status');d.append(note);
    const summary=make('section',undefined,'uc-info');
    for(const [name,value] of [['Customer',order.customer_name],['Email',order.customer_email],
      ['Payment',orderStatus(order.payment_status)],['Total',price(order.total_cents,order.currency)],
      ['Created',order.created_at ? new Date(order.created_at).toLocaleString():'—']]){
      const field=make('div',undefined,'uc-field');field.append(make('span',name),make('strong',value || '—'));summary.append(field);
    }
    d.append(summary);
    const items=make('section',undefined,'uc-items');items.append(make('h3','Order items'));
    for(const item of order.store_order_items||[]){
      const line=make('div',undefined,'uc-item');
      line.append(make('span',(item.product_name||'Product')+' · '+(item.variant_size||'')+' × '+Number(item.quantity||0)),
        make('strong',price(Number(item.unit_price_cents||0)*Number(item.quantity||0),order.currency)));
      items.append(line);
    }
    d.append(items);
    const address=order.shipping_address||{};
    d.append(make('p','Ship to: '+[order.shipping_name,address.line1,address.line2,[address.city,address.state,address.postal_code].filter(Boolean).join(', '),address.country].filter(Boolean).join(' · '),'uc-address'));
    const form=make('form',undefined,'uc-action-form');
    form.append(make('h3','Manage fulfillment'));
    const status=legacyField(form,'Fulfillment status','fulfillment_status',order.fulfillment_status,'select');
    for(const value of ['unfulfilled','processing','awaiting_supplier','partially_shipped','shipped','delivered','canceled']){
      const option=make('option',orderStatus(value));option.value=value;status.append(option);
    }
    status.value=order.fulfillment_status || 'unfulfilled';
    const priority=legacyField(form,'Priority','priority',order.priority,'select');
    for(const value of ['low','normal','high']){const opt=make('option',value);opt.value=value;priority.append(opt);}
    priority.value=order.priority || 'normal';
    const supplier=legacyField(form,'Supplier status / reference','supplier_status',order.supplier_status);
    const carrier=legacyField(form,'Tracking carrier','tracking_carrier',order.tracking_carrier);
    const tracking=legacyField(form,'Tracking number','tracking_number',order.tracking_number);
    const notes=legacyField(form,'Internal notes','admin_notes',order.admin_notes,'textarea');
    notes.rows=3;
    form.append(make('p','Status or tracking updates may notify the customer. Changing the status does not process a refund.','uc-hint'));
    const save=make('button','Save order','mk-button');save.type='submit';form.append(save);
    form.addEventListener('submit',async event=>{
      event.preventDefault();save.disabled=true;
      try{
        await request('/api/admin-orders',{
          method:'PATCH',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({action:'update',order_id:order.id,fulfillment_status:status.value,priority:priority.value,
            supplier_status:supplier.value,tracking_carrier:carrier.value,tracking_number:tracking.value,admin_notes:notes.value})
        });
        note.textContent='Changes saved.';d.close();await loadOrders();
      }catch(error){note.textContent=error.message;note.classList.add('failed');}
      finally{save.disabled=false;}
    });
    d.append(form);document.body.append(d);d.showModal();
  }
  function csvCell(v) {
    let text=String(v == null?'':v);
    if (/^[\s\uFEFF]*[=+\-@]/.test(text)) text="'"+text;
    return '"' + text.replaceAll('"','""') + '"';
  }
  async function exportCSV(){
    if(!secret) return;
    const button=$('ap-orders-export');button.disabled=true;
    feedback('Preparing order export…');
    try{
      let orders=[];
      for(let p=1;p<=100;p++){
        const params=new URLSearchParams({status:statusField().value,sort:$('ap-orders-sort').value,
          search:$('ap-orders-search').value.trim(),page:String(p),page_size:'100'});
        const data=await request('/api/admin-workspace-orders?'+params);
        orders.push(...(data.orders||[]));
        if(!data.pagination?.has_next)break;
        if(p===100)throw Error('Export exceeds 10,000 orders; narrow the filters.');
      }
      const cols=['Order','ID','Created','Customer','Email','Total cents','Currency','Payment','Fulfillment','Product','Variant','Quantity'];
      const rows=[cols];
      for(const o of orders){
        const lines=o.store_order_items?.length?o.store_order_items:[null];
        for(const item of lines)rows.push([o.order_number||o.id,o.id,o.created_at,o.customer_name,o.customer_email,o.total_cents,
          o.currency,o.payment_status,o.fulfillment_status,item?.product_name,item?.variant_size,item?.quantity]);
      }
      const content='\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n');
      const blob=new Blob([content],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob);
      const a=make('a');a.href=url;a.download='AltaPure-Orders.csv';document.body.append(a);a.click();a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
      feedback('Exported '+orders.length+' orders.');
    }catch(error){feedback(error.message,true);}
    finally{button.disabled=false;}
  }
  function clear() {
    epoch++;secret='';visible=[];total=0;page=1;
    clearTimeout(searchTimer);
    activeModal?.remove();activeModal=null;
    window.AltaFulfillment?.clear?.();
    const orders=$('ap-orders-panel');if(orders)orders.hidden=true;
    if($('ap-orders-rows'))$('ap-orders-rows').replaceChildren();
  }
  function authenticate(value) {
    if(typeof value!=='string'||!value)return;
    secret=value;
    window.AltaFulfillment?.bind?.(request);
    switchView(viewFromLocation());
  }
  for(const nav of document.querySelectorAll('[data-ap-workspace]')){
    nav.addEventListener('click',event=>{
      event.preventDefault();
      const next=nav.dataset.apWorkspace;
      history.replaceState(null,'',location.pathname+location.search+'#'+next);
      switchView(next);
    });
  }
  addEventListener('hashchange',()=>{if(secret)switchView(viewFromLocation());});
  $('ap-orders-refresh').addEventListener('click',()=>loadOrders());
  $('ap-orders-status').addEventListener('change',()=>{page=1;loadOrders();});
  $('ap-orders-sort').addEventListener('change',()=>{page=1;loadOrders();});
  $('ap-orders-search').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{page=1;loadOrders();},250);});
  $('ap-orders-previous').addEventListener('click',()=>{if(page>1){page--;loadOrders();}});
  $('ap-orders-next').addEventListener('click',()=>{if(page*25<total){page++;loadOrders();}});
  $('ap-orders-export').addEventListener('click',exportCSV);
  window.AltaOrdersWorkspace={authenticate,clear,switchView,refresh:loadOrders};
})();
