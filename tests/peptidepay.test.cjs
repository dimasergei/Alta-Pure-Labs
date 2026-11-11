'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const pp=require('../lib/peptidepay'),g=require('../lib/native-gateway'),cfg=require('../lib/gateway-config');
const env={PEPTIDEPAY_API_KEY:'sk_live_fixture_not_real',PEPTIDEPAY_WEBHOOK_SECRET:'whsec_fixture_not_real',PEPTIDEPAY_WALLET_ADDRESS:'0x'+'a'.repeat(40),PEPTIDEPAY_MODE:'live',PEPTIDEPAY_CURRENCIES:'USD',PEPTIDEPAY_VERIFIED:'true',PEPTIDEPAY_ENABLED:'true',SITE_URL:'https://altapurelabs.com'};
const attempt={id:'81000000-0000-4000-8000-000000000001',invoice_id:'81000000-0000-4000-8000-000000000002',provider:'peptidepay',operation:'sale',mode:'live',amount_cents:4900,currency:'USD',provider_session_id:'cs_fixture123456',settlement_address:'0x'+'b'.repeat(40),account_tag:pp.configuration(env).account_tag};
const paid={id:attempt.provider_session_id,status:'paid',amount:4900,currency:'USD',txid:'0x'+'c'.repeat(64),paid_at:'2026-11-11T01:00:00Z'};
const event={event:'order.paid',session_id:attempt.provider_session_id,order_id:attempt.id,status:'paid',address_in:attempt.settlement_address,amount:4900,currency:'USD',txid:paid.txid,paid_at:paid.paid_at};
function signed(body,stamp=Math.floor(Date.now()/1000)){const raw=Buffer.from(JSON.stringify(body));return{raw,header:'t='+stamp+',v1='+crypto.createHmac('sha256',env.PEPTIDEPAY_WEBHOOK_SECRET).update(stamp+'.').update(raw).digest('hex')};}
function dbMock(row=attempt){const writes=[];return{writes,from(){return{select(){return this;},eq(){return this;},async maybeSingle(){return{data:row};}};},async rpc(name,args){writes.push({name,args});return{data:{state:args.p_outcome==='approved'?'paid':'review'}};}};}
const apiData=data=>async()=>({ok:true,json:async()=>data});
test('PeptidePay credentials alone never activate payments or substitute test keys for live keys',()=>{
 assert.equal(pp.configuration({}).ready,false);assert.equal(pp.configuration(env).ready,true);
 for(const delta of [{PEPTIDEPAY_ENABLED:'false'},{PEPTIDEPAY_VERIFIED:'false'},{PEPTIDEPAY_MODE:'sandbox'},{PEPTIDEPAY_API_KEY:'sk_test_fixture'},{PEPTIDEPAY_WALLET_ADDRESS:'wrong'},{PEPTIDEPAY_CURRENCIES:'EUR'}])assert.equal(pp.configuration({...env,...delta}).ready,false);
 assert.equal(JSON.stringify(cfg.publicStatus(env)).includes('sk_live_fixture'),false);
});
test('session creation is server-priced, idempotent and does not send customer identity',async()=>{
 let sent;const created=await pp.create(attempt,env,async(url,opts)=>{sent={url,opts,body:JSON.parse(opts.body)};return{ok:true,json:async()=>({...paid,status:'pending',url:'https://peptide-pay.com/session/'+paid.id,tracking_number:attempt.settlement_address})};});
 assert.equal(created.id,paid.id);assert.equal(sent.opts.headers['Idempotency-Key'],attempt.id);assert.equal(sent.body.amount_cents,4900);assert.equal(sent.body.currency,'USD');assert.equal(sent.body.metadata.order_id,attempt.id);assert.equal(sent.body.customer_email,undefined);assert.equal(sent.body.wallet,undefined);assert.match(sent.body.webhook_url,/native=peptidepay-webhook$/);assert.equal(sent.opts.redirect,'error');
});
test('session mismatch or an untrusted redirect never escapes the server',async()=>{
 const good={...paid,status:'pending',url:'https://peptide-pay.com/session/'+paid.id,tracking_number:attempt.settlement_address};
 for(const delta of [{amount:1},{currency:'CAD'},{status:'paid'},{tracking_number:'invalid'},{test:true},{livemode:false},{id:'cs_test_example'},{url:'https://evil.example/session/'+paid.id},{url:good.url+'?redirect=evil'},{url:'https://peptide-pay.com.evil.example/session/'+paid.id}])await assert.rejects(pp.create(attempt,env,apiData({...good,...delta})));
});
test('signed callbacks require exact bytes, finite fresh timestamps and strict hex signatures',()=>{
 const {raw,header}=signed(event);assert.equal(pp.verify(raw,header,env).order_id,attempt.id);
 for(const bad of [header.replace('t=','t=NaN'),header+',t=1',header.replace(/v1=.*/, 'v1='+'g'.repeat(64)),signed(event,1).header,header.replace(/.$/,'é')])assert.throws(()=>pp.verify(raw,bad,env),e=>e.status===401);
 assert.throws(()=>pp.verify(Buffer.from(raw+' '),header,env));assert.throws(()=>pp.verify(raw,header,{}),e=>e.status===503);
});
test('paid result requires the original session, exact fiat amount/currency and a confirmed transaction',()=>{
 assert.equal(pp.result(paid,attempt,event).outcome,'approved');
 for(const delta of [{id:'cs_other123456'},{amount:4899},{currency:'CAD'},{txid:'fake'},{paid_at:null},{test:true},{livemode:false},{status:'expired'},{status:'failed'}])assert.equal(pp.result({...paid,...delta},attempt,event).outcome,'review');
 assert.equal(pp.result({...paid,status:'pending'},attempt,event).outcome,'unknown');
 for(const delta of [{order_id:'another'},{session_id:'cs_other123456'},{address_in:'0x'+'d'.repeat(40)},{amount:1},{currency:'CAD'},{txid:'0x'+'d'.repeat(64)}])assert.equal(pp.result(paid,attempt,{...event,...delta}).outcome,'review');
});
test('a valid simulator/unmatched callback acknowledges receipt without touching an invoice',async()=>{
 for(const evt of [{...event,test:true},{...event,session_id:'cs_test_fixture'},{...event,order_id:'simulator'},{...event}]){
  const db=dbMock(null),{raw,header}=signed(evt);let fetched=0;
  const result=await g.webhook(db,'peptidepay-webhook',raw,{headers:{'x-peptidepay-signature':header}},env,async()=>{fetched++;throw Error('must not fetch');});
  assert.equal(result.live_payment_applied,false);assert.equal(result.verified,true);assert.equal(db.writes.length,0);assert.equal(fetched,0);
 }
});
test('a callback cannot mark paid solely from its signed payload',async()=>{
 for(const [data,outcome]of [[{...paid,status:'pending'},null],[{...paid,amount:1},'review'],[paid,'approved']]){
  const db=dbMock(),{raw,header}=signed(event),run=()=>g.webhook(db,'peptidepay-webhook',raw,{headers:{'x-peptidepay-signature':header}},env,apiData(data));
  if(outcome===null){await assert.rejects(run,e=>e.status===503);assert.equal(db.writes.length,0);}else{await run();assert.equal(db.writes[0].args.p_outcome,outcome);assert.equal(db.writes[0].args.p_transaction,outcome==='approved'?paid.txid:null);}
 }
});
test('disabled verification, wrong account and callbacks preceding durable binding never mark paid',async()=>{
 const {raw,header}=signed(event);
 for(const [row,e]of [[attempt,{...env,PEPTIDEPAY_VERIFIED:'false'}],[{...attempt,account_tag:'other'},env],[{...attempt,provider_session_id:null},env],[{...attempt,mode:'sandbox'},env]]){
  const db=dbMock(row);await assert.rejects(g.webhook(db,'peptidepay-webhook',raw,{headers:{'x-peptidepay-signature':header}},e,apiData(paid)));assert.equal(db.writes.length,0);
 }
});
test('duplicate invoice submission never creates a second PeptidePay session',async()=>{
 let claimed=true,calls=0;const writes=[];
 const db={rpc:async(name,args)=>{writes.push({name,args});return{data:name==='commerce_begin_gateway_attempt'?{...attempt,claimed,state:'redirected',redirect_url:'https://peptide-pay.com/session/'+paid.id}:{state:'redirected'}};}};
 const invoice={id:attempt.invoice_id,status:'accepted',expires_at:new Date(Date.now()+60000).toISOString(),currency:'USD',total_cents:4900};
 const c=pp.configuration(env),account={provider:'peptidepay',mode:'live',account_tag:c.account_tag,countries:['US'],method:{active:true}};
 const body={attempt_id:attempt.id,confirm_amount_cents:4900,confirm_currency:'USD',consent:true,crypto_conversion_consent:true,billing:{country:'US'}};
 const fetchImpl=async()=>{calls++;return{ok:true,json:async()=>({...paid,status:'pending',url:'https://peptide-pay.com/session/'+paid.id,tracking_number:attempt.settlement_address})};};
 await g.startPayment(db,invoice,account,c,body,{id:'customer'},env,fetchImpl,async()=>{});claimed=false;
 const result=await g.startPayment(db,invoice,account,c,body,{id:'customer'},env,fetchImpl,async()=>{});
 assert.equal(result.already_started,true);assert.equal(calls,1);assert.equal(writes.filter(w=>w.name==='commerce_bind_peptidepay_session').length,1);
 await assert.rejects(g.startPayment(db,invoice,account,c,{...body,crypto_conversion_consent:false},{id:'customer'},env,fetchImpl,async()=>{}),e=>e.status===400);
});
test('transport uncertainty blocks a second session and reconciliation never creates one',async()=>{
 let outcome;const db={rpc:async(name,args)=>{if(name==='commerce_begin_gateway_attempt')return{data:{...attempt,claimed:true}};outcome=args.p_outcome;return{data:{state:'unknown'}};}};
 const c=pp.configuration(env);await g.startPayment(db,{id:attempt.invoice_id,status:'accepted',expires_at:new Date(Date.now()+60000).toISOString(),currency:'USD',total_cents:4900},{provider:'peptidepay',mode:'live',account_tag:c.account_tag,countries:['US'],method:{active:true}},c,{attempt_id:attempt.id,confirm_amount_cents:4900,confirm_currency:'USD',consent:true,crypto_conversion_consent:true,billing:{country:'US'}},{id:'customer'},env,async()=>{throw Error('timeout');},async()=>{});assert.equal(outcome,'unknown');
 await assert.rejects(pp.retrieve({...attempt,provider_session_id:null},env,async()=>{throw Error('must not request');}),e=>e.status===409);
});
