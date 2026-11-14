/* AltaPure admin experience: structural layout, not a theme-only override.
 * Preserves original element IDs, controls, handlers, and hidden-view semantics.
 */
(() => {
  'use strict';
  const el=(tag,cls,html)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(html!==undefined)node.innerHTML=html;return node;};
  const isOrders=Boolean(document.getElementById('orders-view'));
  const isMarketing=Boolean(document.getElementById('mk-app'));
  if(!isOrders&&!isMarketing)return;

  function authLayout(){
    const login=document.getElementById(isOrders?'login-view':'mk-login');
    if(!login||login.dataset.apEnhanced)return;
    login.dataset.apEnhanced='true';
    login.classList.add('ap-auth-layout');
    const contents=el('div','ap-auth-content');
    while(login.firstChild)contents.append(login.firstChild);
    const left=el('aside','ap-auth-visual');
    left.setAttribute('aria-label','AltaPure Labs secure business workspace');
    const logo=el('div','ap-auth-symbol');
    const img=document.createElement('img');
    img.src='/favicon.svg?v=20261114-neon-admin-v3';
    img.alt='';
    img.width=76;
    img.height=76;
    logo.append(img);
    const title=el('div','ap-auth-message');
    title.append(el('div','ap-auth-overline','PRIVATE WORKSPACE'));
    title.append(el('h2','ap-auth-hero-title','One focused place<br>to run what matters.'));
    title.append(el('p','ap-auth-hero-copy','Orders and creator relationships, organized around the work you do every day.'));
    const bottom=el('div','ap-auth-bottom');
    bottom.append(el('span','ap-auth-bottom-brand','ALTAPURE <span>LABS</span>'));
    bottom.append(el('span','ap-auth-bottom-status','ADMIN CONSOLE'));
    left.append(logo,title,bottom);
    const main=el('div','ap-auth-form-panel');
    main.append(el('div','ap-auth-form-eyebrow','ALTAPURE / ADMINISTRATION'));
    main.append(contents);
    login.append(left,main);
  }

  function mobileNav(root){
    const backdrop=el('button','ap-nav-backdrop');
    backdrop.type='button';
    backdrop.setAttribute('aria-label','Close admin navigation');
    backdrop.addEventListener('click',()=>root.classList.remove('ap-navigation-open'));
    root.append(backdrop);
  }

  function workspaceLayout(){
    const root=document.getElementById(isOrders?'orders-view':'mk-app');
    if(!root||root.dataset.apEnhanced)return;
    root.dataset.apEnhanced='true';
    root.classList.add('ap-workspace',isOrders?'ap-workspace-orders':'ap-workspace-marketing');
    const sidebar=root.querySelector(':scope > .admin-brandbar');
    if(!sidebar)return;
    const body=el('div','ap-workspace-body');
    const children=[...root.children].filter(n=>n!==sidebar);
    for(const node of children)body.append(node);
    sidebar.classList.add('ap-workspace-sidebar');
    sidebar.setAttribute('aria-label','AltaPure administration navigation');
    root.append(sidebar,body);
    const originalNav=sidebar.querySelector('.admin-nav');
    if(originalNav){
      const label=el('p','ap-sidebar-eyebrow','WORKSPACE');
      originalNav.before(label);
      originalNav.classList.add('ap-primary-nav');
      for(const link of originalNav.querySelectorAll('.admin-nav-link')){
        if(link.textContent.trim()==='Orders')link.dataset.apIcon='orders';
        if(link.textContent.trim()==='Marketing')link.dataset.apIcon='marketing';
        link.addEventListener('click',()=>root.classList.remove('ap-navigation-open'));
      }
    }
    const header=sidebar.querySelector('.admin-header-left');
    const utilities=sidebar.querySelector('.admin-utilities');
    if(utilities){
      utilities.classList.add('ap-sidebar-tools');
      sidebar.append(utilities);
    }
    if(header)header.classList.add('ap-sidebar-brand');
    const foot=el('div','ap-sidebar-footer','<span class="ap-status-dot" aria-hidden="true"></span><span>PRIVATE ADMIN ACCESS</span>');
    sidebar.append(foot);
    const top=el('div','ap-workspace-topbar');
    const context=el('div','ap-workspace-context');
    const crumb=el('div','ap-breadcrumb');
    crumb.append(el('span','','ADMINISTRATION'));
    crumb.append(el('span','ap-breadcrumb-divider','/'));
    crumb.append(el('strong','',isOrders?'ORDERS':'MARKETING'));
    context.append(crumb);
    const controls=el('div','ap-workspace-top-actions');
    const site=document.createElement('a');
    site.href='/';site.className='ap-workspace-store-link';
    site.textContent='View storefront';
    site.setAttribute('aria-label','Open AltaPure storefront');
    const toggle=el('button','ap-sidebar-toggle');
    toggle.type='button';
    toggle.setAttribute('aria-label','Open admin navigation');
    toggle.textContent='☰';
    toggle.addEventListener('click',()=>root.classList.toggle('ap-navigation-open'));
    controls.append(site,toggle);
    top.append(context,controls);
    body.prepend(top);
    mobileNav(root);
    const pageHead=body.querySelector(isOrders?'.admin-section-heading':'.mk-title');
    if(pageHead){
      pageHead.classList.add('ap-page-intro');
      const copy=pageHead.querySelector('h1');
      if(copy && isOrders){
        copy.before(el('div','ap-section-eyebrow','COMMERCE OPERATIONS'));
      }
    }
    if(isOrders)ordersWorkarea(body);
    if(isMarketing)marketingWorkarea(body);
  }
  function ordersWorkarea(body){
    const section=body.querySelector('#admin-orders-section');
    const hub=section?.querySelector('#fulfillment-hub');
    if(!hub)return;
    const surface=el('section','ap-orders-console');
    surface.setAttribute('aria-label','Order queue');
    const label=el('div','ap-content-heading');
    const title=el('div','ap-content-heading-copy');
    title.append(el('span','ap-content-kicker','WORK QUEUE'));
    title.append(el('h2','','Orders console'));
    title.append(el('p','','Review payments, inspect order details, and manage fulfillment in one place.'));
    label.append(title);
    section.insertBefore(surface,hub);
    surface.append(label,hub);
    section.classList.add('ap-orders-section');
  }
  function marketingWorkarea(body){
    const nav=body.querySelector('.mk-subnav');
    if(!nav)return;
    nav.classList.add('ap-marketing-sections');
    const panels=[...body.querySelectorAll(':scope > .mk-panel')];
    const area=el('section','ap-marketing-workarea');
    area.setAttribute('aria-label','Marketing workspace tools');
    nav.before(area);
    area.append(nav);
    const content=el('div','ap-marketing-panel-container');
    area.append(content);
    for(const p of panels)content.append(p);
    const pipeline=content.querySelector('#mk-panel-pipeline');
    if(pipeline){
      const head=el('div','ap-content-heading');
      const copy=el('div','ap-content-heading-copy');
      copy.append(el('span','ap-content-kicker','CREATOR DISCOVERY'));
      copy.append(el('h2','','Creator pipeline'));
      copy.append(el('p','','Search and qualify prospects, track next steps, and prepare tailored outreach.'));
      head.append(copy);
      pipeline.prepend(head);
    }
    const score=body.querySelector('.mk-metrics');
    if(score){
      score.classList.add('ap-marketing-overview');
      const names=['Tracked profiles','Outreach recorded','Responses recorded','Need attention'];
      for(const [i,card] of [...score.children].entries()){
        card.classList.add('ap-metric');
        card.dataset.apMetric=String(i+1).padStart(2,'0');
        const hint=card.querySelector('small');
        if(hint)hint.textContent=names[i]||hint.textContent;
      }
    }
  }
  function init(){
    authLayout();
    workspaceLayout();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();
