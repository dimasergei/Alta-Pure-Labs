'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {JSDOM}=require('jsdom');
const pricing=require('../lib/research-builder-pricing');
const checkout=require('../lib/direct-checkout');
const catalog=Array.from({length:5},(_,i)=>({id:'fixture-compound-'+i,name:'Compound '+i,category:'injectables',group:'Fixture',variants:[{size:'5mg',price:100+i*10},{size:'10mg',price:160+i*10}]}));
const selections=catalog.slice(0,4).map(p=>({id:p.id,size:'5mg',qty:1}));
const member={plan:'vip',invoice_id:'11111111-1111-4111-8111-111111111111'};
const card={id:'11111111-1111-4111-8111-111111111112',kind:'hosted_link',currency:'USD',native_provider:'rampex',rampex_provider:'hosted',version:1};
const crypto={...card,id:'11111111-1111-4111-8111-111111111113',native_provider:'polygon_usdc'};
const record=()=>({kind:'goods',request:{
  research_builder_mode:'member_stack',bulk_order:false,address:{country:'US'},
  items:pricing.validateItems(selections,catalog),
  checkout:{coupon:'',points:0,credit_cents:0,delivery:{shipping:'express',extras:[]}}
}});
test('PURE paid membership is required to obtain the 40% four-compound benefit',()=>{
 assert.throws(()=>pricing.quote(selections,catalog),/active PURE/);
 assert.throws(()=>pricing.quote(selections,catalog,{membership:{plan:'member'}}),/active PURE/);
 for(const plan of ['vip','elite']){
  const q=pricing.quote(selections,catalog,{membership:{...member,plan}});
  assert.equal(q.mode,'member_stack');assert.equal(q.terms.subscription_available,false);
  assert.equal(q.terms.automatic_renewal,false);assert.equal(q.lines.length,4);
  assert.ok(q.lines.every(x=>x.discount_bps===4000&&x.discount_reason==='member_stack'));
  assert.equal(q.total_cents,q.subtotal_cents-q.lines.reduce((n,x)=>n+x.discount_cents,0));
  assert.equal(q.bundled_item.size,'3 mL');
 }
 assert.throws(()=>pricing.quote(selections.slice(0,3),catalog,{membership:member}),/four different/);
 assert.throws(()=>pricing.quote([selections[0],selections[0],selections[2],selections[3]],catalog,{membership:member}),/four different/);
});
test('Member Stack payment is one-time goods checkout for paid members; never off-session renewal',()=>{
 for(const method of [card,crypto]){
  const quote=checkout.price(record(),method,member,{points:0,credit_cents:0});
  assert.equal(quote.currency,'USD');assert.equal(quote.shipping_cents,0);
  assert.equal(quote.earned_points,0);
  assert.equal(quote.pricing.billing_mode,'member_purchase');
  assert.equal(quote.pricing.automatic_renewal,false);
  assert.equal(quote.pricing.research_builder_pricing_version,'pure-member-stack-2026-11-v1');
  assert.equal(quote.pricing.discount_source,'member_stack');
  assert.equal(quote.membership_invoice_id,member.invoice_id);
  assert.ok(quote.pricing.lines.every(x=>x.discount_reason==='member_stack'));
  assert.equal(quote.pricing.bundled_items[0].id,'gift-bac-3');
 }
 assert.throws(()=>checkout.price(record(),card,null,{points:0,credit_cents:0}),/active PURE/);
 assert.throws(()=>checkout.price(record(),card,{plan:'member'}, {points:0,credit_cents:0}),/active PURE/);
});
test('public standalone checkout and separate subscription links are removed',()=>{
 const vercel=JSON.parse(fs.readFileSync('vercel.json','utf8'));
 for(const pathname of ['/research-builder','/research-builder.html','/research-checkout','/research-checkout.html']){
  assert.equal(vercel.redirects.find(row=>row.source===pathname)?.destination,'/memberships');
 }
 assert.equal(vercel.redirects.find(x=>x.source==='/account/subscriptions')?.destination,'/account/stack');
 const shell=fs.readFileSync('public-build/index.html','utf8');
 assert.doesNotMatch(shell,/<a href="\/research-builder">/);
 assert.match(shell,/href="\/memberships"/);
 const account=fs.readFileSync('public-build/account.js','utf8');
 assert.match(account,/Member Stack/);
 assert.doesNotMatch(account,/Auto-Stack™/);
 const client=fs.readFileSync('public-build/direct-checkout-client.js','utf8');
 assert.match(client,/member_stack/);
 assert.doesNotMatch(client,/name="method_id" disabled data-unavailable="true"/);
});
test('member-only builder shows one paid purchase with no standalone billing or renewal',async()=>{
 const dom=new JSDOM('<section id="test"></section>',{url:'https://getpurelabs.com/account/stack',runScripts:'outside-only'});
 const w=dom.window;w.AltaStore={product:id=>catalog.find(p=>p.id===id),image:()=>'/assets/fixture.webp'};
 const auth={auth:{getSession:async()=>({data:{session:{access_token:'fixture_secure_access_token_123456'}}})}};
 const navigated=[],calls=[];
 w.fetch=async(url,opts={})=>{
  const body=opts.body?JSON.parse(opts.body):null;calls.push({url,body,headers:opts.headers});
  return {ok:true,json:async()=>body?pricing.quote(body.items,catalog,{membership:member}):{catalog,member_plan:'vip',terms:pricing.terms}};
 };
 w.eval(fs.readFileSync('research-builder-client.js','utf8'));
 const root=w.document.querySelector('#test');
 try{
  await w.PureResearchBuilder.mount(root,{auth,navigate:x=>navigated.push(x)});
  assert.match(root.querySelector('.nl-builder-hero').textContent,/MEMBER STACK/);
  assert.doesNotMatch(root.textContent,/Subscribe|Monthly plan|Recurring billing|AUTO-STACK|Preview/i);
  for(const p of catalog.slice(0,4)){
   root.querySelector('[data-add="'+p.id+'"]').click();
  }
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.ok(!root.querySelector('[data-checkout]').disabled);
  root.querySelector('[data-checkout]').click();
  assert.deepEqual(navigated,['/checkout?member_stack=1']);
  assert.ok(calls.every(call=>call.headers.Authorization?.startsWith('Bearer ')));
  assert.ok(calls.some(call=>call.body?.mode==='member_stack'));
 }finally{w.close();}
});
test('database migration rejects old standalone invoice mode and requires paid member',()=>{
 const sql=fs.readFileSync('supabase/migrations/20261119213000_pure_membership_only_stack.sql','utf8');
 assert.match(sql,/not in \('one_time','member_stack'\)/);
 assert.match(sql,/membership_invoice_id/);
 assert.match(sql,/drop trigger if exists pure_stack_paid_cycle_verified/);
 assert.doesNotMatch(sql,/not in \('one_time','monthly_invoice'\)/);
});
