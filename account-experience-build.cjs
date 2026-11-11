'use strict';
const fs=require('node:fs');
const patch=(file,fn)=>{const path='public-build/'+file;fs.writeFileSync(path,fn(fs.readFileSync(path,'utf8')));};
const replace=(s,from,to)=>{if(!s.includes(from))throw Error('Account integration anchor missing: '+from.slice(0,100));return s.replace(from,to);};
patch('account.html',s=>replace(s,'<script src="/account.js">','<script src="/account-experience.js"></script><script src="/account.js">').replace('</head>','<link rel="stylesheet" href="/account-experience.css"></head>'));
patch('account.js',s=>{
 const start=s.indexOf('function accountNav(active)'),end=s.indexOf('async function overview()',start);
 if(start<0||end<0)throw Error('Account navigation missing');
 s=s.slice(0,start)+`function accountNav(active){const current=active.startsWith('/account/orders')||active==='/account/tracking'?'/account/purchases':active==='/account/store-credit'?'/account/points':active==='/account/subscriptions'?'/account/membership':active;const items=[['Overview','/account'],['Orders','/account/purchases'],['Membership','/account/membership'],['Rewards','/account/points'],['Profile','/account/profile'],['Partner','/account/partner'],['Support','/account/requests']];return '<nav class="account-nav" aria-label="Account sections">'+items.map(([label,url])=>'<a href="'+url+'"'+(current===url?' aria-current="page"':'')+'>'+label+'</a>').join('')+'<button type="button" id="logout" class="account-nav-logout">Log out</button></nav>';}
`+s.slice(end);
 s=replace(s,"root.innerHTML=accountNav(p)+'<section id=\"direct-checkout-root\"></section>';document.getElementById('logout').onclick=logout;","document.body.classList.add('ap-checkout-page');root.innerHTML='<section id=\"direct-checkout-root\"></section>';");
 s=replace(s,"window.DirectCheckout.orders(document.getElementById('direct-orders-root'),auth,user)","window.AccountExperience.orders(document.getElementById('direct-orders-root'),auth,user,api,card)");
 s=replace(s,"window.DirectCheckout.balance(document.getElementById('direct-balance-root'),auth,p)","window.AccountExperience.rewards(document.getElementById('direct-balance-root'),auth,p)");
 s=replace(s,"window.ManualCommerce.membership(document.getElementById('manual-membership-root'),auth,user)","window.AccountExperience.membership(document.getElementById('manual-membership-root'),auth,user)");
 s=replace(s,"return profile();","root.innerHTML=head('Profile')+accountNav(p)+'<section id=\"ae-profile-root\"></section>';document.getElementById('logout').onclick=logout;window.AccountExperience.profile(document.getElementById('ae-profile-root'),auth,user);return;");
 s=replace(s,"if(p==='/account/tracking'){","if(p==='/account/orders')return go('/account/purchases?view=history');if(p==='/account/tracking')return go('/account/purchases?view=tracking');if(p==='/account/tracking'){");
 s=s.replaceAll("href=\"/account/orders\"","href=\"/account/purchases?view=history\"");
 s=s.replace("head('Your requests')","head('Support requests')");
 return s;
});
patch('workspace-v2.js',s=>{
 s=replace(s,'<a class="ap-button" href="/partner-program">Open partner program ↗</a></div>','</div><section class="ae-panel"><h2>Partner inquiry</h2>${inquiryForm(\'partner\')}</section><a href="/account/requests">View submitted requests and replies →</a>');
 s=s.replace('My account → Requests','My account → Support');
 return s;
});
console.log('Account navigation, inline membership/partner pages, profile editing and checkout presentation built.');
