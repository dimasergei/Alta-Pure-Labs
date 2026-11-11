'use strict';
const fs=require('node:fs');
const path=require('node:path');
const out=path.join(process.cwd(),'public-build');
const theme='brand-theme.css';
if(!fs.existsSync(out))throw new Error('public-build output is missing.');
fs.copyFileSync(theme,path.join(out,theme));
for(const [source,target] of [['altapure-favicon.svg','favicon.svg'],['altapure-favicon-48.png','favicon-48.png'],['altapure-favicon.ico','favicon.ico'],['altapure-touch-icon.png','apple-touch-icon.png'],['altapure-logo-mark.png','brand-logo.png']])fs.copyFileSync(path.join(process.cwd(),'assets',source),path.join(out,target));
const iconLinks='<link rel="icon" type="image/svg+xml" href="/favicon.svg"><link rel="icon" type="image/png" sizes="48x48" href="/favicon-48.png"><link rel="shortcut icon" href="/favicon.ico"><link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png"><meta name="theme-color" content="#0f1117">';
const organization='<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"AltaPure Labs","url":"https://altapurelabs.com/","logo":"https://altapurelabs.com/brand-logo.png"}</script>';
let count=0;
for(const file of fs.readdirSync(out).filter(f=>f.endsWith('.html'))){
  if(file.startsWith('admin-'))continue;
  const target=path.join(out,file);
  let html=fs.readFileSync(target,'utf8');
  html=html.replace(/<link\b[^>]*\brel=["'](?:shortcut )?icon["'][^>]*>/gi,'');
  html=html.replace(/<meta\b[^>]*\bname=["']theme-color["'][^>]*>/gi,'');
  if(!html.includes('href="/brand-theme.css"'))html=html.replace('</head>',`<link rel="stylesheet" href="/brand-theme.css">${iconLinks}</head>`);
  const body=html.match(/<body\b([^>]*)>/i);
  if(body){
    let attrs=body[1];
    const classMatch=attrs.match(/\bclass="([^"]*)"/i);
    if(classMatch){if(!classMatch[1].split(/\s+/).includes('ap-site'))attrs=attrs.replace(classMatch[0],`class="${classMatch[1]} ap-site"`);}
    else attrs+=' class="ap-site"';
    html=html.replace(body[0],`<body${attrs}>`);
  }
  if(file==='index.html'&&!html.includes('"@type":"Organization"'))html=html.replace('</head>',`${organization}</head>`);
  fs.writeFileSync(target,html);
  count++;
}
console.log(`Applied AltaPure favicon metadata and graphite theme to ${count} public HTML pages.`);
