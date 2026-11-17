'use strict';
const fs=require('node:fs'),path=require('node:path');
const views=require('./reference-ui-functions.cjs'),out='public-build';
for(const [file,anchor,functions] of [['storefront-v2.js',' window.AltaStore=',views.store],['workspace-v2.js',' window.AltaWorkspace=',views.workspace]]){
 const p=path.join(out,file);let s=fs.readFileSync(p,'utf8');if(!s.includes(anchor))throw Error('Missing view integration point: '+file);
 s=s.replace(anchor,Object.entries(functions).map(([name,fn])=>'\n '+name+' = '+fn.toString()+';\n').join('')+anchor);
 s=s.replace('Documentation,<br>without the search party.','Certificates of Analysis').replace('COA library','COAS').replace('One place for the value<br>you’ve earned.','Rewards & Store Credit').replace('From your account<br>to your shipment.','Track Your Order').replace('Request a bulk quote ↗','View bulk orders ↗');
 s=s.replace('limit:12,','limit:20,').replace(":1;if(!Number.isInteger(qty)",":Number(button.dataset.quantity||1);if(!Number.isInteger(qty)");
 fs.writeFileSync(p,s);
}
for(const file of ['reference-ui.css','reference-ui.js'])fs.copyFileSync(file,path.join(out,file));
function decorate(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())decorate(p);else if(e.name.endsWith('.html')&&!e.name.startsWith('admin-')){let s=fs.readFileSync(p,'utf8');if(!s.includes('ap-site'))continue;s=s.replace('</head>','<link rel="stylesheet" href="/reference-ui.css?v=20261117-reset"></head>').replace('</body>','<script src="/reference-ui.js?v=20261117-reset"></script></body>');fs.writeFileSync(p,s);}}}
decorate(out);
console.log('Built reference storefront layouts, product cards and shared customer-page styling.');
