(()=>{
 'use strict';
 if(/^\/research-checkout(?:\.html)?\/?$/.test(location.pathname)){
  const root=document.getElementById('ap-main');
  if(root)window.ResearchCheckout.render(root,null);
 }
})();
