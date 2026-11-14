'use strict';
// Local-only static fixture server for visual acceptance. NEVER proxies production.
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.resolve(__dirname,'../..');
const PORT=Number(process.env.CHECKOUT_PARITY_PORT||43183);
const ALLOWED=new Set([
 '/tests/checkout-parity/fixture.html',
 '/styles.css','/reference-ui.css','/checkout-reference.css',
 '/account-experience.css','/cart-reference.css',
 '/checkout-reference.js','/cart-reference.js'
]);
const BRAND_LOGOS=new Set(['visa','mastercard','amex','discover','apple','google'].map(name=>'/assets/payment-brands/'+name+'.svg'));
const MIME={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml'};
const server=http.createServer((request,response)=>{
 if(request.method!=='GET'){response.writeHead(405);return response.end('Method not allowed')}
 let pathname;
 try{pathname=new URL(request.url,'http://127.0.0.1').pathname}catch{response.writeHead(400);return response.end('Bad URL')}
 if(!ALLOWED.has(pathname)&&!BRAND_LOGOS.has(pathname)){response.writeHead(404);return response.end('Not part of the isolated fixture')}
 const target=path.resolve(ROOT,'.'+pathname);
 if(!target.startsWith(ROOT+path.sep)){response.writeHead(403);return response.end('Invalid path')}
 fs.readFile(target,(err,contents)=>{
  if(err){response.writeHead(err.code==='ENOENT'?404:500);return response.end('Fixture asset unavailable')}
  response.writeHead(200,{'Content-Type':MIME[path.extname(target)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  response.end(contents);
 });
});
server.listen(PORT,'127.0.0.1',()=>process.stdout.write('Isolated checkout parity fixture ready on http://127.0.0.1:'+PORT+'\n'));
