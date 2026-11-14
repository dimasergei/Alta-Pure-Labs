'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHmac}=require('node:crypto');
const r=require('../lib/rampex'),p=require('../lib/rampex-payments'),connection=require('../lib/rampex-connection');
const env={RAMPEX_API_KEY:'fixture-api-key-only',RAMPEX_WEBHOOK_SECRET:'fixture-secret-not-a-real-credential',RAMPEX_ENABLED:'true'};
const cfg=r.configuration(env),id='10000000-0000-4000-8000-000000000001',iid='20000000-0000-4000-8000-000000000001';
const attempt={id,invoice_id:iid,provider:'rampex',mode:'live',operation:'sale',rampex_provider:'rampnetwork',rampex_link_id:'fixture-123',account_tag:cfg.account_tag,amount_cents:4900,currency:'USD',state:'redirected'};
const data={link_id:'fixture-123',status:'completed',amount:49,received_amount:49,currency:'USD',paid_at:'2026-11-12T12:00:00Z',transaction_hash:'0x'+'8'.repeat(64),payout_amount:47.5,payout_currency:'USDC'};
const event={...data,event:'payment.completed',metadata:{order_id:id},payout_network:'polygon',txid_out:'0x'+'9'.repeat(64)};
const active={id:'rampnetwork',status:'active',minimum_amount:8,minimum_currency:'USD'};
const response=x=>new Response(JSON.stringify({success:true,data:x}),{status:200});
const invoice={id:iid,total_cents:4900,currency:'USD',kind:'goods'};
const body={attempt_id:id,crypto_conversion_consent:true},user={id:'customer-fixture',email:'buyer@example.test'};
const account={rampex_provider:'rampnetwork'};
function dbMock({claimed=true,present=true}={}){
 const calls=[];let paid=false;
 return{calls,
 from(){return{select(){return this},eq(){return this},async maybeSingle(){return{data:present?attempt:null,error:null}}}},
 async rpc(name,args){calls.push({name,args});
  if(name==='commerce_begin_rampex_attempt')return{data:{...attempt,claimed}};
  if(name==='commerce_bind_rampex_link')return{data:{id,state:'redirected'}};
  if(name==='commerce_finish_rampex_payment'){const newly_paid=!paid;paid=true;return{data:{id,invoice_id:iid,state:'paid',newly_paid,replayed:!newly_paid}};}
  if(name==='commerce_finish_gateway_attempt')return{data:{id,state:args.p_outcome}};
  throw Error('Unexpected RPC '+name);
 }};
}
function res(){return{headers:{},setHeader(k,v){this.headers[k]=v},status(v){this.code=v;return this},json(v){this.data=v;return this}};}

test('Rampex is disabled by default and has no fake sandbox',()=>{
 assert.equal(r.configuration({...env,RAMPEX_ENABLED:undefined}).ready,false);
 assert.equal(r.configuration({...env,RAMPEX_MODE:'sandbox'}).ready,false);
 assert.equal(cfg.ready,true);assert.equal(cfg.currencies.join(','),'USD');assert.equal(cfg.wallets.apple,false);
 assert.notEqual(r.configuration({...env,RAMPEX_API_KEY:'other-fixture'}).account_tag,cfg.account_tag);
});
test('only supported explicit routes or hosted and safe checkout URLs are accepted',()=>{
 for(const rail of ['meld','creditcard','unknown'])assert.throws(()=>r.assertRail(rail));
 assert.equal(r.checkoutUrl('https://checkout.rampex.io/pay/test?provider=rampnetwork','rampnetwork'),'https://checkout.rampex.io/pay/test?provider=rampnetwork');
 for(const url of ['https://evil.invalid/pay','https://checkout.rampex.io@evil.invalid/pay','https://checkout.rampex.io/pay?provider=stripe','https://checkout.rampex.io/pay?provider=rampnetwork&provider=stripe','http://checkout.rampex.io/pay','https://checkout.rampex.io/pay#secret','https://checkout.rampex.io/','https://checkout.rampex.io:123/pay'])assert.throws(()=>r.checkoutUrl(url,'rampnetwork'));
});
test('live provider status is public and validates limits without leaking the key',async()=>{
 let calls=0;
 await r.providerStatus('rampnetwork',4900,async(url,options)=>{calls++;assert.equal(url,'https://api.rampex.io/provider-status');assert.equal(options.headers['X-API-Key'],undefined);return response({providers:[active]})});
 assert.equal(calls,1);
 for(const patch of [{status:'redirected'},{status:'inactive'},{minimum_currency:'EUR'},{minimum_amount:50},{minimum_amount:'unknown'}])await assert.rejects(()=>r.providerStatus('rampnetwork',4900,async()=>response({providers:[{...active,...patch}]})));
 await assert.rejects(()=>r.providerStatus('rampnetwork',4900,async()=>response({providers:[active,active]})));
});
test('creation sends the stored amount/reference once and never follows redirects',async()=>{
 let calls=0;
 const result=await r.create(attempt,user.email,env,async(url,opts)=>{calls++;assert.equal(url,'https://api.rampex.io/api-create-payment-link');assert.equal(opts.headers['X-API-Key'],env.RAMPEX_API_KEY);assert.equal(opts.redirect,'error');
 const sent=JSON.parse(opts.body);assert.equal(sent.amount,49);assert.equal(sent.provider,'rampnetwork');assert.equal(sent.woo_order_id,id);assert.equal(sent.payment_url,'https://altapurelabs.com/pay.html?invoice='+iid);
 return response({link_id:'fixture-123',status:'active',amount:49,currency:'USD',customer_email:user.email,redirect_url:'https://checkout.rampex.io/pay/fixture-123'});
 });assert.equal(calls,1);assert.equal(result.id,'fixture-123');
 await assert.rejects(()=>r.create(attempt,user.email,env,async()=>{calls++;throw Error('fixture network failure')}));assert.equal(calls,2);
});
test('creation rejects wrong server amounts and substituted payment providers',async()=>{
 for(const patch of [{amount:48},{currency:'CAD'},{status:'completed'},{customer_email:'other@example.test'},{provider:'stripe'},{test:true},{link_id:'bad&id=other'},{redirect_url:'https://evil.invalid/pay'}])await assert.rejects(()=>r.create(attempt,user.email,env,async()=>response({link_id:'fixture-123',status:'active',amount:49,currency:'USD',customer_email:user.email,redirect_url:'https://checkout.rampex.io/pay/fixture-123',...patch})));
});
test('status lookup uses the stored link and validates API envelopes',async()=>{
 await r.retrieve(attempt,env,async(url,options)=>{assert.equal(url,'https://api.rampex.io/api-get-payment-status?link_id=fixture-123');assert.equal(options.method,'GET');return response(data)});
 await assert.rejects(()=>r.retrieve({...attempt,rampex_link_id:null},env,()=>{throw Error('must not fetch')}));
 await assert.rejects(()=>r.retrieve(attempt,env,async()=>new Response('x'.repeat(65537))));
});
test('completion requires exact gross/received amounts, network, payout and account-bound reference',()=>{
 assert.equal(r.confirmation(data,attempt,event).confirmed,true);
 for(const patch of [{link_id:'other'},{amount:48},{received_amount:48},{received_amount:50},{currency:'CAD'},{payout_currency:'USDT'},{payout_amount:0},{transaction_hash:'bad'},{paid_at:'bad'},{test:true},{provider:'stripe'}])assert.throws(()=>r.confirmation({...data,...patch},attempt,event));
 for(const patch of [{metadata:{order_id:'other'}},{event:'payment.extra_deposit'},{test:true},{payout_network:'ethereum'},{txid_out:'bad'}])assert.throws(()=>r.confirmation(data,attempt,{...event,...patch}));
 assert.equal(r.confirmation({...data,status:'active'},attempt).confirmed,false);
});
test('disabled collection and missing conversion consent cannot create links',async()=>{
 for(const [config,request] of [[{...cfg,ready:false},body],[cfg,{}]])await assert.rejects(()=>p.start({},invoice,account,config,request,user,env,()=>{throw Error('must not fetch')},()=>{throw Error('must not rate limit')}));
});
test('a duplicate creation request uses the existing persisted attempt',async()=>{
 const db=dbMock({claimed:false});let calls=0;
 const result=await p.start(db,invoice,account,cfg,body,user,env,async(url)=>{calls++;assert.equal(url,'https://api.rampex.io/provider-status');return response({providers:[active]})},async()=>{});
 assert.equal(result.already_started,true);assert.equal(calls,1);assert.equal(db.calls.length,1);
});
test('unknown creation outcome never retries and keeps a non-payable review state',async()=>{
 const db=dbMock();let postCalls=0;
 const result=await p.start(db,invoice,account,cfg,body,user,env,async(url)=>{if(url.endsWith('/provider-status'))return response({providers:[active]});postCalls++;throw Error('timeout')},async()=>{});
 assert.equal(postCalls,1);assert.equal(result.state,'unknown');assert.equal(result.redirect_url,null);assert.equal(db.calls.at(-1).args.p_outcome,'unknown');
});
test('a link is durably bound before any redirect is exposed',async()=>{
 const db=dbMock();const result=await p.start(db,invoice,account,cfg,body,user,env,async(url)=>url.endsWith('/provider-status')?response({providers:[active]}):response({link_id:'fixture-123',status:'active',amount:49,currency:'USD',customer_email:user.email,redirect_url:'https://checkout.rampex.io/pay/fixture-123'}),async()=>{});
 assert.equal(db.calls.at(-1).name,'commerce_bind_rampex_link');assert.equal(result.state,'redirected');assert.ok(result.redirect_url);
});
test('duplicate signed completion records payment/dispatch only once',async()=>{
 const db=dbMock();let dispatched=0;const deps={dispatch:async()=>{dispatched++}};
 const first=await p.event(db,event,env,async()=>response(data),deps),second=await p.event(db,event,env,async()=>response(data),deps);
 assert.equal(first.live_payment_applied,true);assert.equal(second.live_payment_applied,false);assert.equal(second.already_recorded,true);assert.equal(dispatched,1);
});
test('unknown links and unavailable payment status cannot write a paid result',async()=>{
 const db=dbMock({present:false});await assert.rejects(()=>p.event(db,event,env,()=>{throw Error('must not fetch')}));assert.equal(db.calls.length,0);
 const known=dbMock();await assert.rejects(()=>p.event(known,event,env,async()=>{throw Error('timeout')}));assert.equal(known.calls.length,0);
 await assert.rejects(()=>p.event(known,event,env,async()=>response({...data,status:'active'})));assert.equal(known.calls.length,0);
});
test('extra deposits and expirations cannot grant another entitlement',async()=>{
 for(const type of ['payment.extra_deposit','payment.expired']){const db=dbMock();const result=await p.event(db,{...event,event:type},env,()=>{throw Error('no status lookup')});assert.equal(result.review,true);assert.equal(result.live_payment_applied,false);assert.equal(db.calls[0].args.p_outcome,'review');}
});
test('test callbacks and invalid signatures never touch the database',async()=>{
 for(const valid of [true,false]){const raw=Buffer.from(JSON.stringify({...event,test:true})),out=res();await connection.handle({method:'POST',body:raw,headers:{'x-rampex-signature':valid?createHmac('sha256',env.RAMPEX_WEBHOOK_SECRET).update(raw).digest('hex'):'0'.repeat(64)}},out,new URLSearchParams({native:'rampex-webhook'}),{env,db:{from(){throw Error('must not access db')},rpc(){throw Error('must not access db')}}});assert.equal(out.code,valid?200:401);assert.equal(out.data.live_payment_applied,false);}
});
test('cross-account reconciliation cannot fetch status or record payment',async()=>{
 await assert.rejects(()=>p.settle({}, {...attempt,account_tag:'wrong-account'},env,()=>{throw Error('must not fetch')}));
});
