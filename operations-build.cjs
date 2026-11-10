'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const root=process.cwd(),out=path.join(root,'public-build'),base='https://altapurelabs.com';
const catalog=JSON.parse(fs.readFileSync('lib/catalog.json','utf8'));
// Build-time integration preserves the existing account authentication and order logic.
let account=fs.readFileSync('account.js','utf8');
if(!account.includes('AltaOperationsUI.renderRequests')){
 const anchor="if(p==='/account/reset-password'";
 if(!account.includes(anchor))throw Error('Account route integration point missing.');
 account=account.replace(anchor,"if(p==='/account/requests'){if(!user)return go('/account/login?returnTo=%2Faccount%2Frequests');root.innerHTML=head('Your requests')+accountNav(p)+'<section id=\"ap-requests-panel\"></section>';document.getElementById('logout').onclick=logout;window.AltaOperationsUI.renderRequests(document.getElementById('ap-requests-panel'),auth);return;}"+anchor);
 account=account.replace("['Partner','/account/partner']","['Requests','/account/requests'],['Partner','/account/partner']");
 fs.writeFileSync('account.js',account);
}
let accountHtml=fs.readFileSync('account.html','utf8');
if(!accountHtml.includes('operations-client.js'))accountHtml=accountHtml.replace('<script src="/account.js">','<script src="/operations-client.js"></script><script src="/account.js">');
if(!accountHtml.includes('operations.css'))accountHtml=accountHtml.replace('</head>','<link rel="stylesheet" href="/operations.css"></head>');
fs.writeFileSync('account.html',accountHtml);
// Avoid claiming inbox delivery: submission is durable even when email is queued.
let workspace=fs.readFileSync('workspace-v2.js','utf8');
workspace=workspace.replace("'Request received by our email service. Reference: '+result.reference+'. The team will review it; no purchase or enrollment was created.'","'Request saved. Reference: '+result.reference+'. Team notification: '+(result.notification||'queued')+'. View account responses under My account → Requests. No purchase or enrollment was created.'");
fs.writeFileSync('workspace-v2.js',workspace);
let storefront=fs.readFileSync('storefront-v2.js','utf8');
storefront=storefront.replace("t('requestSent')+' No paid membership was created.'","'Your update request has been saved. No paid membership was created.'");
fs.writeFileSync('storefront-v2.js',storefront);
// Extend navigation to the real operations inbox without modifying order workflows.
for(const file of ['admin-inventory.html','admin-operations-overview.html']){let html=fs.readFileSync(file,'utf8');if(!html.includes('href="/admin-operations.html"'))html=html.replace('</main>','<p><a href="/admin-operations.html">Requests & operating readiness →</a></p></main>');fs.writeFileSync(file,html);}
fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(out,{recursive:true});
for(const entry of fs.readdirSync(root,{withFileTypes:true}))if(entry.isFile()&&/\.(html|css|js)$/.test(entry.name))fs.copyFileSync(entry.name,path.join(out,entry.name));
function copyImages(dir){if(!fs.existsSync(dir))return;for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const src=path.join(dir,entry.name);if(entry.isDirectory())copyImages(src);else if(/\.(png|jpe?g|webp|svg|gif|ico)$/i.test(entry.name)){fs.mkdirSync(path.dirname(path.join(out,src)),{recursive:true});fs.copyFileSync(src,path.join(out,src));}}}
copyImages('assets');copyImages('ALTA_83_curved_label_photos');
fs.mkdirSync(path.join(out,'data'),{recursive:true});for(const file of ['verified-coas.json','storefront-programs.json','coa-demo-samples.json','supplier-references.json'])if(fs.existsSync('data/'+file))fs.copyFileSync('data/'+file,path.join(out,'data',file));
// Only the genuine provider-issued Apple Pay association file may be published here.
// Do not copy an entire hidden directory or generate a substitute verification file.
const appleAssociation='.well-known/apple-developer-merchantid-domain-association';
if(fs.existsSync(appleAssociation)){fs.mkdirSync(path.join(out,'.well-known'),{recursive:true});fs.copyFileSync(appleAssociation,path.join(out,appleAssociation));}
const shell=fs.readFileSync('storefront-v2.html','utf8');
function page(html,url,title,description,main,structured){html=html.replace(/<title>[\s\S]*?<\/title>/,'<title>'+esc(title)+'</title>');html=html.replace(/<meta name="description"[^>]*>/,'<meta name="description" content="'+esc(description)+'">');html=html.replace('</head>','<link rel="canonical" href="'+esc(base+url)+'"><meta property="og:title" content="'+esc(title)+'"><meta property="og:description" content="'+esc(description)+'"><meta property="og:url" content="'+esc(base+url)+'"><meta property="og:type" content="website">'+(structured?'<script type="application/ld+json">'+JSON.stringify(structured).replace(/</g,'\\u003c')+'</script>':'')+'</head>');if(main)html=html.replace(/<main id="ap-main">[\s\S]*?<\/main>/,'<main id="ap-main">'+main+'</main>');return html;}
const routes={
 '/shop':['Research Catalog','Browse all AltaPure research products and exact product-size variants.'],
 '/research-builder':['Research Builder','Prepare, save and export a four-compound research planning list.'],
 '/bulk-orders':['Bulk Requests','Build exact product quantities and submit a bulk quote inquiry.'],
 '/memberships':['Memberships','Review account access and membership enrollment availability.'],
 '/rewards':['Rewards and Credit','Find the account workspaces for issued rewards and store credit.'],
 '/offers':['Current Offers','Review explicitly published AltaPure offers and their terms.'],
 '/coas':['Certificates of Analysis','Search published verified laboratory reports by product and lot.'],
 '/about':['About AltaPure Labs','Learn about the connected AltaPure laboratory research workspace.'],
 '/contact':['Contact AltaPure Labs','Submit a documented inquiry for support, product documentation or an existing order.'],
 '/partner-program':['Partner Program','Submit an organizational partnership inquiry.'],
 '/track-order':['Track Your Order','Sign in to see your order and assigned carrier tracking.']
};
fs.writeFileSync(path.join(out,'index.html'),page(shell,'/','AltaPure Labs | Your research. All connected.','Research compounds, exact product sizes, planning lists and documentation in one workspace.'));
for(const [url,[title,description]] of Object.entries(routes)){const body='<section class="ap-container ap-page-intro"><h1>'+esc(title)+'</h1><p>'+esc(description)+'</p><a href="/shop">Explore the catalog</a></section>';fs.writeFileSync(path.join(out,url.slice(1)+'.html'),page(shell,url,title+' | AltaPure Labs',description,body));}
fs.mkdirSync(path.join(out,'product'),{recursive:true});
for(const p of catalog){const sizes=p.variants.map(v=>esc(v.size)).join(', '),url='/product/'+p.id;const main='<section class="ap-container ap-page-intro"><p>'+esc(p.group)+'</p><h1>'+esc(p.name)+'</h1><p>'+esc(p.blurb)+'</p><p>Listed sizes: '+sizes+'.</p><p>For controlled laboratory research only. Online checkout is paused.</p><a href="/coas?product='+encodeURIComponent(p.id)+'">Product documentation</a></section>';fs.writeFileSync(path.join(out,'product',p.id+'.html'),page(shell,url,p.name+' | AltaPure Labs',p.blurb+' Sizes: '+p.variants.map(v=>v.size).join(', ')+'.',main,{'@context':'https://schema.org','@type':'Product',name:p.name,description:p.blurb,sku:p.id,brand:{'@type':'Brand',name:'AltaPure Labs'},url:base+url}));}
const urls=['/',...Object.keys(routes),...catalog.map(p=>'/product/'+p.id)];
fs.writeFileSync(path.join(out,'sitemap.xml'),'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+urls.map(url=>'<url><loc>'+base+url+'</loc></url>').join('')+'</urlset>');
fs.writeFileSync(path.join(out,'robots.txt'),'User-agent: *\nDisallow: /admin-\nDisallow: /account\nDisallow: /my-account\nDisallow: /api/\nSitemap: '+base+'/sitemap.xml\n');
fs.writeFileSync(path.join(out,'404.html'),'<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="robots" content="noindex"><title>Page not found | AltaPure Labs</title><link rel="stylesheet" href="/storefront-v2.css"><body class="ap-site"><main class="ap-container ap-page-intro"><h1>That page is not here.</h1><p>Browse the current catalog or contact our team.</p><a class="ap-button" href="/shop">Open the catalog</a> <a href="/contact">Contact support</a></main></body></html>');
for(const file of fs.readdirSync(out).filter(f=>f.startsWith('admin-')&&f.endsWith('.html'))){const p=path.join(out,file);let h=fs.readFileSync(p,'utf8');if(!h.includes('name="robots"'))h=h.replace('</head>','<meta name="robots" content="noindex,nofollow"></head>');fs.writeFileSync(p,h);}
console.log('Public-only build ready: '+urls.length+' canonical URLs; backend, migrations, tests and private operational requirements excluded.');
