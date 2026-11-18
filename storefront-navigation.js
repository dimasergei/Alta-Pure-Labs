/* Shared disclosure menus: hover, touch, keyboard, and outside/Escape dismissal. */
(() => {
 'use strict';
 const menus=[...document.querySelectorAll('[data-header-menu]')].map(root=>({root,trigger:root.querySelector('[data-menu-trigger]'),panel:root.querySelector('.ap-header-popover'),timer:0,suppressFocus:false})).filter(m=>m.trigger&&m.panel);
 function close(m){clearTimeout(m.timer);m.panel.hidden=true;m.trigger.setAttribute('aria-expanded','false');m.root.classList.remove('ap-menu-open');}
 function open(m){for(const other of menus)if(other!==m)close(other);clearTimeout(m.timer);m.panel.hidden=false;m.trigger.setAttribute('aria-expanded','true');m.root.classList.add('ap-menu-open');}
 for(const m of menus){
  m.root.addEventListener('pointerenter',e=>{if(e.pointerType!=='touch'&&window.matchMedia('(min-width: 1051px) and (hover: hover)').matches)open(m);});
  m.root.addEventListener('pointerleave',()=>{m.timer=setTimeout(()=>{if(!m.root.contains(document.activeElement))close(m);},150);});
  m.root.addEventListener('focusin',()=>{if(!m.suppressFocus)open(m);});
  m.root.addEventListener('focusout',e=>{if(!m.root.contains(e.relatedTarget))close(m);});
  m.trigger.addEventListener('pointerdown',()=>{m.pointerWasOpen=!m.panel.hidden;});
  m.trigger.addEventListener('click',e=>{if(m.trigger.tagName==='A')return;e.preventDefault();const wasOpen=e.detail?m.pointerWasOpen:!m.panel.hidden;wasOpen?close(m):open(m);});
  m.trigger.addEventListener('keydown',e=>{if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();open(m);const links=[...m.panel.querySelectorAll('a')];(e.key==='ArrowUp'?links.at(-1):links[0])?.focus();}});
  m.panel.addEventListener('keydown',e=>{const links=[...m.panel.querySelectorAll('a')],i=links.indexOf(document.activeElement);if(i<0)return;let next;if(e.key==='ArrowDown')next=(i+1)%links.length;else if(e.key==='ArrowUp')next=(i+links.length-1)%links.length;else if(e.key==='Home')next=0;else if(e.key==='End')next=links.length-1;if(next!==undefined){e.preventDefault();links[next].focus();}});
 }
 document.addEventListener('pointerdown',e=>{for(const m of menus)if(!m.root.contains(e.target))close(m);});
 document.addEventListener('keydown',e=>{
  if(e.key!=='Escape'||e.defaultPrevented||document.querySelector('dialog[open]'))return;
  const opened=menus.filter(m=>!m.panel.hidden),focused=opened.find(m=>m.root.contains(document.activeElement));
  if(opened.length){
   for(const m of opened)close(m);
   e.preventDefault();
   if(focused){focused.suppressFocus=true;focused.trigger.focus();focused.suppressFocus=false;}
   return;
  }
  const nav=document.querySelector('#ap-nav.ap-open');
  if(nav){
   nav.classList.remove('ap-open');
   const toggle=document.querySelector('[data-action="menu"][aria-controls="ap-nav"]');
   if(toggle){toggle.setAttribute('aria-expanded','false');toggle.focus();}
   e.preventDefault();
  }
 });
})();
