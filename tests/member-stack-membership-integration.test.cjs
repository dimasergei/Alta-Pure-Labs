'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom');
const config=require('../config/conversion.json');
const read=path=>fs.readFileSync(path,'utf8');

test('both desktop account tabs and hover menu have Membership only, with no separate Member Stack destination',()=>{
 const homepage=new JSDOM(read('public-build/index.html'));
 const accountPage=new JSDOM(read('public-build/account.html'));
 for(const page of [homepage,accountPage]){
  const menu=page.window.document.querySelector('#ap-account-menu');
  assert.ok(menu);
  const links=Array.from(menu.querySelectorAll('a')).map(x=>[x.textContent.trim(),x.getAttribute('href')]);
  assert.ok(links.some(([name,url])=>name==='Membership'&&url==='/account/membership'));
  assert.ok(!links.some(([name,url])=>/Member Stack/i.test(name)||/\/account\/stack/.test(url)));
  page.window.close();
 }
 const source=read('public-build/account.js');
 const nav=source.slice(source.indexOf('function accountNav'),source.indexOf('async function overview'));
 assert.ok(nav.includes("['Membership','/account/membership']"));
 assert.doesNotMatch(nav,/Member Stack|\/account\/stack/);
 const workspace=read('public-build/workspace-v2.js');
 assert.match(workspace,/if\(path==='\/account\/membership'\)return window\.ConversionUI\.mountMembership/);
 assert.doesNotMatch(workspace,/if\(path==='\/account\/stack'\)/);
 assert.match(read('public-build/direct-checkout-client.js'),/\/account\/membership#member-stack/);
 const redirects=JSON.parse(read('vercel.json')).redirects;
 for(const url of ['/account/stack','/my-account/stack','/account/subscriptions','/my-account/subscriptions']){
  assert.equal(redirects.find(x=>x.source===url)?.destination,'/account/membership',url);
 }
});

function account({plan=null,hash=''}={}){
 const dom=new JSDOM('<main id="membership"></main>',{url:'https://getpurelabs.com/account/membership'+hash,runScripts:'outside-only'});
 const w=dom.window,root=w.document.getElementById('membership'),calls=[],mounts=[];
 const session={auth:{getSession:async()=>({data:{session:{access_token:'test-member-session-token'}}})}};
 w.fetch=async(url,options={})=>{
  calls.push(String(url));
  return {ok:true,json:async()=>({
   membership:plan?{plan,invoice_id:'11111111-1111-4111-8111-111111111111',expires_at:'2099-12-31T00:00:00Z'}:null,
   membership_pending:null,terms:{conversion:config}
  })};
 };
 w.PureResearchBuilder={mount:async(element,options)=>{
  mounts.push({element,options});
  element.innerHTML='<p data-stack-mounted>Member Stack builder is within Membership</p>';
 }};
 w.eval(read('membership-experience.js'));
 w.eval(read('conversion-ui.js'));
 return{dom,w,root,calls,mounts,session};
}
for(const [plan,percent,shipping] of [['vip','20%','standard'],['elite','40%','express']]){
 test('paid '+plan+' tier displays Member Stack as an expandable Membership benefit and not an account section',async()=>{
  const env=account({plan});
  try{
   await env.w.ConversionUI.mountMembership(env.root,env.session);
   const feature=env.root.querySelector('details#member-stack[data-cv-member-stack-details]');
   assert.ok(feature,'member feature appears inside Membership');
   assert.match(feature.querySelector('summary').textContent,new RegExp(percent));
   assert.match(feature.querySelector('summary').textContent,new RegExp(shipping));
   assert.ok(env.root.querySelector('.cv-member-status'),'original Membership panel remains');
   assert.equal(env.root.querySelector('a[href="/account/stack"]'),null);
   assert.equal(env.mounts.length,0,'builder is lazy-loaded instead of a separate page');
   const button=env.root.querySelector('button[data-cv-open-member-stack]');
   assert.ok(button);
   button.click();
   assert.equal(feature.open,true);
   assert.equal(env.mounts.length,1);
   assert.equal(env.mounts[0].element,feature.querySelector('[data-cv-member-stack-root]'));
   assert.equal(env.mounts[0].options.auth,env.session);
   assert.match(feature.textContent,/Member Stack builder is within Membership/);
   button.click();
   feature.dispatchEvent(new env.w.Event('toggle'));
   assert.equal(env.mounts.length,1,'opening again does not mount a duplicate builder');
   assert.deepEqual(env.calls,['/api/customer-config?checkout=account']);
  }finally{env.dom.window.close();}
 });
}
test('unpaid members have only the membership comparison and no member stack builder',async()=>{
 const env=account();
 try{
  await env.w.ConversionUI.mountMembership(env.root,env.session);
  assert.equal(env.root.querySelector('[data-cv-member-stack-details]'),null);
  assert.equal(env.root.querySelector('[data-cv-open-member-stack]'),null);
  assert.equal(env.mounts.length,0);
  assert.ok(env.root.querySelector('[data-cv-memberships]'));
 }finally{env.dom.window.close();}
});
test('deep link to the Membership section expands the integrated feature rather than navigating to a separate tab',async()=>{
 const env=account({plan:'vip',hash:'#member-stack'});
 try{
  await env.w.ConversionUI.mountMembership(env.root,env.session);
  assert.equal(env.root.querySelector('#member-stack').open,true);
  assert.equal(env.mounts.length,1);
 }finally{env.dom.window.close();}
});
