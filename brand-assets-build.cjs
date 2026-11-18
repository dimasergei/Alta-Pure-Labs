'use strict';
const fs=require('node:fs');
const path=require('node:path');
const out=path.join(process.cwd(),'public-build');
const theme='brand-theme.css';
if(!fs.existsSync(out))throw new Error('public-build output is missing.');
fs.copyFileSync(theme,path.join(out,theme));
fs.copyFileSync('pure-brand.css',path.join(out,'pure-brand.css'));
fs.copyFileSync('mobile-parity.css',path.join(out,'mobile-parity.css'));
fs.copyFileSync('unified-palette.css',path.join(out,'unified-palette.css'));
for(const file of ['pure-layout.css','pure-bulk-layout.css'])fs.copyFileSync(file,path.join(out,file));
for(const [source,target] of [['pure-icon.svg','favicon.svg'],['pure-icon.svg','favicon-pure.svg'],['pure-icon-16.png','favicon-pure-16.png'],['pure-icon-32.png','favicon-pure-32.png'],['pure-icon-48.png','favicon-48.png'],['pure-icon-96.png','favicon-pure-96.png'],['pure-icon.ico','favicon.ico'],['pure-icon.ico','favicon-pure-20261117.ico'],['pure-icon.ico','favicon-pure-20261117b.ico'],['altapure-purple-20261116.ico','favicon-purple-20261116.ico'],['altapure-google-favicon-96.png','favicon-google-96.png'],['altapure-glossy-favicon-96.png','favicon-glossy-96.png'],['altapure-glossy-20261116.ico','favicon-glossy-20261116.ico'],['altapure-transparent-favicon-96.png','favicon-transparent-96.png'],['altapure-transparent-20261116.ico','favicon-transparent-20261116.ico'],['altapure-solid-purple-96.png','favicon-solid-purple-96.png'],['altapure-solid-purple-20261116.ico','favicon-solid-purple-20261116.ico'],['altapure-neon-favicon-96.png','favicon-neon-96.png'],['altapure-neon-20261116.ico','favicon-neon-20261116.ico'],['altapure-bright-favicon-96.png','favicon-bright-96.png'],['altapure-bright-20261116.ico','favicon-bright-20261116.ico'],['pure-icon-180.png','apple-touch-icon.png'],['pure-icon-96.png','brand-logo.png']])fs.copyFileSync(path.join(process.cwd(),'assets',source),path.join(out,target));
// Self-host authentic payment marks from the reviewed assets directory.
fs.mkdirSync(path.join(out,'assets','payment-brands'),{recursive:true});
fs.cpSync(path.join(process.cwd(),'assets','payment-brands'),path.join(out,'assets','payment-brands'),{recursive:true});
const iconLinks='<link rel="icon" type="image/svg+xml" sizes="any" href="/favicon-pure.svg?v=20261117b"><link rel="icon" type="image/png" sizes="16x16" href="/favicon-pure-16.png?v=20261117b"><link rel="icon" type="image/png" sizes="32x32" href="/favicon-pure-32.png?v=20261117b"><link rel="icon" type="image/png" sizes="96x96" href="/favicon-pure-96.png?v=20261117b"><link rel="shortcut icon" type="image/x-icon" href="/favicon-pure-20261117b.ico"><link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png?v=20261117b"><meta name="theme-color" content="#ffffff">';
const organization='<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"PURE","url":"https://getpurelabs.com/","logo":"https://getpurelabs.com/brand-logo.png"}</script>';
let count=0;
for(const file of fs.readdirSync(out,{recursive:true}).filter(f=>f.endsWith('.html'))){
  const target=path.join(out,file);
  let html=fs.readFileSync(target,'utf8');
  // Admin and public shells share the exact same reference-derived wordmark.
  html=html.replace(/<link\b[^>]*href=["']\/pure-brand\.css[^"']*["'][^>]*>/gi,'');
  html=html.replace(/<link\b[^>]*href=["']https:\/\/fonts\.(?:googleapis|gstatic)\.com[^"']*["'][^>]*>/gi,'');
  const fontPreload=html.includes('href="/assets/fonts/archivo-latin-variable.woff"')?'':'<link rel="preload" href="/assets/fonts/archivo-latin-variable.woff" as="font" type="font/woff" crossorigin>';
  html=html.replace('</head>',fontPreload+'<link rel="stylesheet" href="/pure-brand.css?v=20261118-photo-fit"></head>');
  html=html.replace(/<link\b[^>]*\brel=["'](?:(?:shortcut )?icon|apple-touch-icon)["'][^>]*>/gi,'');
  html=html.replace(/<meta\b[^>]*\bname=["'](?:theme-color|altapure-promo-end)["'][^>]*>/gi,'');
  if(path.basename(file).startsWith('admin-')){
    html=html.replace(/<link\b[^>]*href=["']\/admin-violet\.css[^"']*["'][^>]*>/gi,'');
    html=html.replace(/href="\/(admin-dashboard|operations)\.css(?:\?[^"]*)?"/g,'href="/$1.css?v=20261117b"');
    html=html.replace('</head>','<link rel="stylesheet" href="/admin-violet.css?v=20261117b">'+iconLinks+'</head>');
    fs.writeFileSync(target,html);continue;
  }
  const themeLink=html.includes('href="/brand-theme.css"')?'':'<link rel="stylesheet" href="/brand-theme.css?v=20261117-monochrome">';
  const mobileLink=html.includes('href="/mobile-parity.css')?'':'<link rel="stylesheet" media="(max-width: 767px)" href="/mobile-parity.css?v=20261117-monochrome">';
  html=html.replace('</head>',`${themeLink}${mobileLink}${iconLinks}</head>`);
  const body=html.match(/<body\b([^>]*)>/i);
  if(body){
    let attrs=body[1];
    const classMatch=attrs.match(/\bclass="([^"]*)"/i);
    if(classMatch){if(!classMatch[1].split(/\s+/).includes('ap-site'))attrs=attrs.replace(classMatch[0],`class="${classMatch[1]} ap-site"`);}
    else attrs+=' class="ap-site"';
    html=html.replace(body[0],`<body${attrs}>`);
  }
  if(file==='index.html'&&!html.includes('"@type":"Organization"'))html=html.replace('</head>',`${organization}</head>`);
  html=html.replace('</head>','<link rel="stylesheet" href="/unified-palette.css?v=20261117-monochrome"></head>');
  html=html.replace('</head>','<link rel="stylesheet" href="/pure-layout.css?v=20261118"><link rel="stylesheet" href="/pure-bulk-layout.css?v=20261118"></head>');
  fs.writeFileSync(target,html);
  count++;
}

console.log(`Applied PURE favicon metadata and shared theme to ${count} public HTML pages.`);
require('./pure-policy-build.cjs')(out);
