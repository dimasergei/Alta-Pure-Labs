'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const orders=fs.readFileSync(path.join(root,'admin-orders.html'),'utf8');
const marketing=fs.readFileSync(path.join(root,'admin-marketing.html'),'utf8');
const shell=fs.readFileSync(path.join(root,'admin-experience.js'),'utf8');
const consoleJs=fs.readFileSync(path.join(root,'admin-fulfillment.js'),'utf8');
const marketingJs=fs.readFileSync(path.join(root,'admin-marketing.js'),'utf8');
const css=fs.readFileSync(path.join(root,'admin-experience.css'),'utf8');
const icon='/favicon.svg?v=20261114-neon-admin-v3';

test('same exact SVG favicon is used on both admin routes and old AP favicon is absent',()=>{
 for(const [name,html] of [['orders',orders],['marketing',marketing]]){
   assert.ok(html.includes('rel="icon" type="image/svg+xml" href="'+icon+'"'),name+' primary favicon');
   assert.ok(html.includes('rel="shortcut icon" type="image/svg+xml" href="'+icon+'"'),name+' shortcut');
   assert.doesNotMatch(html,/data:image\/svg\+xml/);
 }
 const svg=fs.readFileSync(path.join(root,'assets/altapure-favicon.svg'),'utf8');
 assert.match(svg,/fill="#00BFFF"/i,'neon blue must come from one shared source asset');
});
test('all four in-page admin brand lockups use the identical three-bar icon instead of CSS approximations',()=>{
 for(const [name,html] of [['orders',orders],['marketing',marketing]]){
   assert.equal((html.match(/class="ap-brand-symbol"/g)||[]).length,2,name+' login and sidebar logos');
   assert.equal((html.match(/src="\/favicon\.svg\?v=20261114-neon-admin-v3"/g)||[]).length,2);
   assert.doesNotMatch(html,/class="admin-brand-mark"/);
 }
 assert.match(shell,/img\.src='\/favicon\.svg\?v=20261114-neon-admin-v3'/);
 assert.doesNotMatch(shell,/brand-logo\.png/);
 assert.match(css,/body \.admin-login-brand img\.ap-brand-symbol/);
});
test('exact circled helper text is removed while sync feedback and controls stay available',()=>{
 for(const value of [
   'Store operations','Creator acquisition','PARTNER DEVELOPMENT',
   'Actions are performed against live order data.',
   'One organized workspace for creator relationships and Instagram conversations.'
 ])assert.ok(!shell.includes(value),'removed dynamic label: '+value);
 for(const value of [
   'CREATOR ACQUISITION WORKSPACE',
   'Prospects, conversations, outreach drafts and follow-ups in one place.',
   'Cloud CRM: prospects'
 ])assert.ok(!marketing.includes(value),'removed static marketing copy: '+value);
 assert.ok(!consoleJs.includes('Manage all new checkout orders in one place.'));
 assert.ok(!marketingJs.includes('Shared Marketing CRM loaded.'));
 assert.match(marketing,/id="mk-sync-status"/,'CRM status still accessible in Settings');
 assert.match(marketing,/id="mk-alert"/,'real error and save feedback still present');
 assert.match(consoleJs,/button\('Refresh',load\)/,'refresh button retained');
});
