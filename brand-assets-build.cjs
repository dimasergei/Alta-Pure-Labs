'use strict';
const fs=require('node:fs');
const path=require('node:path');
const out=path.join(process.cwd(),'public-build');
const theme='brand-theme.css';
const {ends_at: promoEnd}=require('./config/checkout.json').promotions;
if(!fs.existsSync(out))throw new Error('public-build output is missing.');
fs.copyFileSync(theme,path.join(out,theme));
fs.copyFileSync('mobile-parity.css',path.join(out,'mobile-parity.css'));
fs.copyFileSync('research-builder-parity.css',path.join(out,'research-builder-parity.css'));
for(const f of ['membership-experience.js','membership-experience.css'])fs.copyFileSync(f,path.join(out,f));
for(const [source,target] of [['altapure-favicon.svg','favicon.svg'],['altapure-favicon-48.png','favicon-48.png'],['altapure-favicon.ico','favicon.ico'],['altapure-touch-icon.png','apple-touch-icon.png'],['altapure-logo-mark.png','brand-logo.png']])fs.copyFileSync(path.join(process.cwd(),'assets',source),path.join(out,target));
// Self-host authentic payment marks from the reviewed assets directory.
fs.mkdirSync(path.join(out,'assets','payment-brands'),{recursive:true});
fs.cpSync(path.join(process.cwd(),'assets','payment-brands'),path.join(out,'assets','payment-brands'),{recursive:true});
const iconLinks=`<meta name="altapure-promo-end" content="${promoEnd}">`+'<link rel="icon" type="image/svg+xml" href="/favicon.svg?v=20261114"><link rel="shortcut icon" type="image/svg+xml" href="/favicon.svg?v=20261114"><meta name="theme-color" content="#ffffff">';
const organization='<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"AltaPure Labs","url":"https://altapurelabs.com/","logo":"https://altapurelabs.com/brand-logo.png"}</script>';
let count=0;
for(const file of fs.readdirSync(out,{recursive:true}).filter(f=>f.endsWith('.html'))){
  if(path.basename(file).startsWith('admin-'))continue;
  const target=path.join(out,file);
  let html=fs.readFileSync(target,'utf8');
  html=html.replace(/<link\b[^>]*\brel=["'](?:(?:shortcut )?icon|apple-touch-icon)["'][^>]*>/gi,'');
  html=html.replace(/<meta\b[^>]*\bname=["'](?:theme-color|altapure-promo-end)["'][^>]*>/gi,'');
  const themeLink=html.includes('href="/brand-theme.css"')?'':'<link rel="stylesheet" href="/brand-theme.css">';
  const mobileLink=html.includes('href="/mobile-parity.css')?'':'<link rel="stylesheet" media="(max-width: 767px)" href="/mobile-parity.css?v=20261114">';
  html=html.replace('</head>',`${themeLink}${mobileLink}<link rel="stylesheet" href="/research-builder-parity.css?v=3">${iconLinks}</head>`);
  const body=html.match(/<body\b([^>]*)>/i);
  if(body){
    let attrs=body[1];
    const classMatch=attrs.match(/\bclass="([^"]*)"/i);
    if(classMatch){if(!classMatch[1].split(/\s+/).includes('ap-site'))attrs=attrs.replace(classMatch[0],`class="${classMatch[1]} ap-site"`);}
    else attrs+=' class="ap-site"';
    html=html.replace(body[0],`<body${attrs}>`);
  }
  if(file==='memberships.html'){
    html=html.replace('</head>','<link rel="stylesheet" href="/membership-experience.css?v=20261114"></head>');
    html=html.replace('</body>','<script src="/membership-experience.js?v=20261114"></script></body>');
  }
  if(file==='index.html'&&!html.includes('"@type":"Organization"'))html=html.replace('</head>',`${organization}</head>`);
  fs.writeFileSync(target,html);
  count++;
}

/* Allow both approved prepaid billing terms in the generated checkout client.
   The server remains the authority for quoted prices and membership activation. */
{
  const file=path.join(out,'direct-checkout-client.js');
  let js=fs.readFileSync(file,'utf8');
  const edits=[
    ["membershipPeriod=goods?null:(params.get('period')||'annual')","membershipPeriod=goods?null:(params.get('period')||'monthly')"],
    ["if(!goods&&membershipPeriod!=='annual'){","if(!goods&&!['monthly','annual'].includes(membershipPeriod)){"],
    ["Monthly membership checkout is not offered in this flow. Review the annual plan before paying.","Choose a valid monthly or annual membership term."],
    ["data.terms?.conversion?.plans?.[plan]?.annual_cents","data.terms?.conversion?.plans?.[plan]?.[membershipPeriod+'_cents']"],
    ["data.terms.conversion.plans[plan].annual_cents<=0","data.terms.conversion.plans[plan][membershipPeriod+'_cents']<=0"],
    ["size:'Annual membership · no automatic renewal'","size:(new URLSearchParams(location.search).get('period')==='annual'?'Annual':'Monthly')+' membership · no automatic renewal'"],
    ["price:data.terms.conversion.plans[plan].annual_cents/100","price:data.terms.conversion.plans[plan][(new URLSearchParams(location.search).get('period')||'monthly')+'_cents']/100"]
  ];
  for(const [before,after] of edits){
    if(!js.includes(before))throw Error('Membership checkout integration point missing: '+before);
    js=js.replace(before,after);
  }
  fs.writeFileSync(file,js);
}

console.log(`Applied AltaPure favicon metadata and shared theme to ${count} public HTML pages.`);
