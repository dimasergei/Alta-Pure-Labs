'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const checkout=require('../lib/direct-checkout'),policy=require('../lib/pure-payment-policy'),gateway=require('../lib/gateway-config');
const config=require('../config/checkout.json');
const id='a0000000-0000-4000-8000-000000000001',uid='a0000000-0000-4000-8000-000000000002',mid='a0000000-0000-4000-8000-000000000003';
const user={id:uid,email:'Customer@example.test',email_confirmed_at:'2026-11-01'};
const interac={id:mid,kind:'interac',provider_key:'interac',native_provider:null,currency:'CAD',label:'Interac business receiving',version:3,active:true,sale_scope:'goods',display_order:30,
 payee:'Private fixture recipient',instructions:'Private fixture instructions: receiving@example.test',acceptance_reference:'Private fixture confirmation'};
const env={SITE_URL:'https://getpurelabs.com',CHECKOUT_RATE_LIMIT_SECRET:'isolated-interac-fixture-secret',
 RAMPEX_ENABLED:'true',RAMPEX_MODE:'live',RAMPEX_API_KEY:'isolated-rampex-key',RAMPEX_WEBHOOK_SECRET:'isolated-rampex-webhook-secret',
 POLYGON_USDC_ENABLED:'true',POLYGON_USDC_RECIPIENT:'0x1111111111111111111111111111111111111111',POLYGON_USDC_RPC_URL:'https://polygon-rpc.test',POLYGON_USDC_SECONDARY_RPC_URL:'https://polygon-second.test'};
const catalog=[{id:'fixture-product',name:'Fixture product',variants:[{size:'5mg',price:100}]}];
const body={id,kind:'goods',method_id:mid,consent:true,research_use:true,checkout_version:config.version,name:'Fixture Researcher',organization:'Fixture Lab',
 items:[{id:'fixture-product',size:'5mg',qty:1}],address:{line1:'123 Fixture Street',city:'Fixture City',region:'ON',postal_code:'N2L 1A1',country:'CA'},
 delivery:{shipping:'standard',extras:['protection']},coupon:'BLACKFRIDAY15',points:0,credit_cents:0};
function database({methods=[interac],balance={points:1000,credit_cents:5000},invoices=[],onMethodsRead=null}={}){
 const state={methods:structuredClone(methods),balance:structuredClone(balance),invoices:structuredClone(invoices),delivery:structuredClone(require('../config/delivery-options.json')),methodReads:0};
 const calls=[],reads=[];
 return {state,calls,reads,auth:{getUser:async()=>({data:{user}})},from(table){
  reads.push(table);const filters={};let one=false;
  const q={select(){return q;},eq(key,value){filters[key]=value;return q;},in(){return q;},order(){return q;},limit(){return q;},maybeSingle(){one=true;return q;},then(resolve,reject){
   let value;
   if(table==='commerce_payment_methods'){state.methodReads++;if(onMethodsRead)onMethodsRead(state);value=state.methods;}
   else if(table==='commerce_gateway_accounts')value=state.methods.filter(m=>m.native_provider).map(m=>({method_id:m.id,provider:m.native_provider,mode:'live',account_tag:gateway.configuration(m.native_provider,env).account_tag,countries:m.countries||['US','CA'],rampex_provider:m.rampex_provider}));
   else if(table==='commerce_delivery_options')value=state.delivery;
   else if(table==='commerce_balance_accounts')value=state.balance;
   else if(table==='commerce_balance_events')value=[];
   else if(table==='commerce_referrals')value=null;
   else if(table==='commerce_invoices'){const matching=state.invoices.filter(r=>Object.entries(filters).every(([k,v])=>r[k]===v));value=one?matching[0]||null:matching;}
   else throw Error('Unexpected table: '+table);
   return Promise.resolve({data:structuredClone(value)}).then(resolve,reject);
  }};return q;
 },rpc:async(name,args)=>{
  calls.push({name,args:structuredClone(args)});
  assert.equal(name,'commerce_request_invoice','Interac must only request a reviewed invoice');
  const r=args.p_data,existing=state.invoices.find(row=>row.id===r.id);
  if(existing){if(existing.customer_id!==r.customer_id||existing.request_digest!==r.digest)return{error:{code:'23505'}};return{data:{id:r.id,status:existing.status,created:false}};}
  state.invoices.push({id:r.id,customer_id:r.customer_id,status:'requested',request_digest:r.digest,request_data:structuredClone(r.request),checkout_version:null});
  return{data:{id:r.id,status:'requested',created:true}};
 }};
}
async function call(input,{db=database(),cat=catalog,params='',headers={},method=input?'POST':'GET'}={}){
 let networkCalls=0;
 const res={code:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(value){this.body=value;return this;}};
 await checkout.handle({method,headers:{origin:env.SITE_URL,'content-type':'application/json',authorization:'Bearer isolated-fixture-token-long-enough',...headers},body:input},res,new URLSearchParams(params),
  {db,env,catalog:cat,rateLimit:async()=>{},fetchImpl:async()=>{networkCalls++;throw Error('No network call is allowed in this request-only fixture.');}});
 assert.equal(networkCalls,0);return{res,db};
}

test('Interac is an active manual CAD route for Canada without a gateway account or public receiving details',async()=>{
 const db=database();
 const available=await checkout.methods(db,env,'CA');
 assert.equal(available.length,1);assert.deepEqual(available[0].countries,['CA']);
 assert.equal(db.reads.includes('commerce_gateway_accounts'),false);
 for(const country of ['US','GB'])assert.deepEqual(await checkout.methods(db,env,country),[]);
 const {res}=await call(null,{db,params:'checkout=public',headers:{authorization:''}});
 assert.equal(res.code,200);assert.equal(res.body.methods.length,1);
 assert.deepEqual(res.body.methods[0],{id:mid,label:'Interac e-Transfer',kind:'interac',currency:'CAD',native_provider:null,provider_key:'interac',sale_scope:'goods',payment_kind:'interac',countries:['CA'],display_order:3,request_only:true,payment_currency:'CAD',mode:'reviewed_invoice'});
 assert.deepEqual(res.body.payment_options.map(x=>[x.key,x.status]),[['card','setup_pending'],['crypto','setup_pending'],['interac','available']]);
 assert.doesNotMatch(JSON.stringify(res.body),/Private fixture|instructions|acceptance_reference|payee|receiving@example/);
 assert.equal(res.body.capabilities.card,false);assert.equal(db.calls.length,0);
 const description=require('../lib/gateway-public').describe(available);
 const choice=description.payment_options.find(x=>x.key==='interac');
 assert.equal(choice.mode,'reviewed_invoice');assert.equal(choice.request_only,true);assert.equal(choice.payment_currency,'CAD');assert.deepEqual(choice.currencies,['CAD']);
 assert.equal(description.card_to_crypto_connected,false);
});

test('inactive, wrong currency, wrong provider, native hybrids and membership-only Interac cannot enter new checkout',async()=>{
 for(const change of [{active:false},{currency:'USD'},{provider_key:'bank_transfer'},{kind:'bank_transfer'},
  {native_provider:'rampex',rampex_provider:'hosted'},{currency:'USD',native_provider:'rampex',rampex_provider:'hosted'},
  {native_provider:'polygon_usdc'},{currency:'USD',native_provider:'polygon_usdc'},{sale_scope:'membership'}]){
  const db=database({methods:[{...interac,...change}]});
  assert.deepEqual(await checkout.methods(db,env,'CA'),[],JSON.stringify(change));
  const {res}=await call({...body,action:'quote'},{db});assert.equal(res.code,409);assert.equal(db.calls.length,0);
 }
 assert.equal(policy.kind({...interac,currency:'USD',native_provider:'polygon_usdc'}),null);
});

test('Interac quote is a non-payable USD cart estimate with current coupon and selected delivery, never a CAD charge',async()=>{
 const {res,db}=await call({...body,action:'quote',coupon:' blackFriday15 '});
 assert.equal(res.code,200);assert.equal(res.body.currency,'USD');assert.equal(res.body.payment_currency,'CAD');assert.equal(res.body.request_only,true);
 assert.equal(res.body.subtotal_cents,10000);assert.equal(res.body.discount_cents,1500);assert.equal(res.body.shipping_cents,4495);assert.equal(res.body.tax_cents,0);assert.equal(res.body.total_cents,12995);
 assert.equal(res.body.pricing.coupon_code,'BLACKFRIDAY15');assert.equal(res.body.pricing.crypto_discount_cents,0);assert.equal(res.body.pricing.payment_discount,undefined);
 assert.equal(res.body.points_redeemed,0);assert.equal(res.body.credit_redeemed_cents,0);assert.equal(res.body.earned_points,0);
 assert.match(res.body.quote,/^[a-f0-9]{64}$/);assert.equal(db.calls.length,0);
 const {res:regular}=await call({...body,action:'quote',coupon:''},{db});assert.equal(regular.body.discount_cents,0);assert.equal(regular.body.total_cents,14495);
 assert.deepEqual(db.state.balance,{points:1000,credit_cents:5000});
});

test('USD points or credit, non-Canadian destinations and disabled delivery are rejected before any request or debit',async()=>{
 for(const change of [{points:100},{credit_cents:1},{points:100,credit_cents:100},{address:{...body.address,country:'US'}},{address:{...body.address,country:'GB'}}]){
  const {res,db}=await call({...body,action:'quote',...change});assert.equal(res.code,409);assert.equal(db.calls.length,0);assert.deepEqual(db.state.balance,{points:1000,credit_cents:5000});
 }
 const db=database();db.state.delivery.find(x=>x.id==='protection').enabled=false;
 const {res}=await call({...body,action:'quote'},{db});assert.equal(res.code,400);assert.equal(db.calls.length,0);
});

test('placement persists a reviewed request with server identity, product prices, coupon, delivery and bulk intent only',async t=>{
 let notifications=0;t.mock.method(require('../lib/invoice-notifications'),'dispatch',async()=>{notifications++;throw Error('Request-only checkout must not dispatch messages.');});
 const db=database(),input={...body,bulk_order:true,coupon:' blackfriday15 ',items:[{...body.items[0],qty:10,price:.01,unit_price_usd_cents:1}],
  customer_id:'forged',customer_email:'forged@example.test',currency:'CAD',total_cents:1,checkout_version:config.version,
  preferred_payment:{method_id:'forged',provider_key:'rampex',currency:'USD'},request:{checkout:{coupon:'FAKE',payment_kind:'crypto'}},payment_kind:'crypto',pricing:{discount_cents:999999},status:'paid'};
 const {res:q}=await call({...input,action:'quote'},{db});assert.equal(q.code,200);
 const {res}=await call({...input,action:'place',quote:q.body.quote},{db});assert.equal(res.code,201);assert.equal(res.body.status,'requested');assert.equal(res.body.request_only,true);
 assert.equal(db.calls.length,1);const saved=db.calls[0].args.p_data;
 assert.equal(saved.customer_id,uid);assert.equal(saved.customer_email,'customer@example.test');assert.equal(saved.consent,true);
 for(const field of ['checkout_version','currency','total_cents','pricing','method_id','payment_snapshot','paid_at','status'])assert.equal(saved[field],undefined,field);
 assert.equal(saved.request.items[0].unit_price_usd_cents,10000);assert.equal(saved.request.items[0].qty,10);assert.equal(saved.request.bulk_order,true);
 assert.deepEqual(saved.request.preferred_payment,{method_id:mid,provider_key:'interac',label:interac.label,currency:'CAD'});
 assert.equal(saved.request.checkout.payment_kind,'interac');assert.equal(saved.request.checkout.request_only,true);assert.equal(saved.request.checkout.payment_method_version,3);
 assert.equal(saved.request.checkout.coupon,'BLACKFRIDAY15');assert.equal(saved.request.checkout.points,0);assert.equal(saved.request.checkout.credit_cents,0);assert.deepEqual(saved.request.checkout.delivery,body.delivery);
 assert.deepEqual(saved.request.checkout.usd_estimate,{currency:'USD',subtotal_cents:100000,discount_cents:15000,coupon_discount_cents:15000,shipping_cents:4495,tax_cents:0,total_cents:89495,delivery:q.body.pricing.delivery});
 const unhashed={...saved};delete unhashed.digest;assert.equal(saved.digest,createHash('sha256').update(JSON.stringify(unhashed)).digest('hex'));
 assert.equal(db.state.invoices[0].checkout_version,null);assert.deepEqual(db.state.balance,{points:1000,credit_cents:5000});assert.equal(notifications,0);
 const {res:again}=await call({...input,action:'place',quote:q.body.quote},{db});assert.equal(again.code,200);assert.equal(again.body.replayed,true);assert.equal(again.body.request_only,true);assert.equal(db.calls.length,1);
 const {res:conflict}=await call({...input,action:'place',quote:q.body.quote,note:'Changed after submitting'},{db});assert.equal(conflict.code,409);assert.equal(db.calls.length,1);
});

test('changed cart, delivery, coupon, catalog, request reference or method version invalidates the quoted request',async()=>{
 for(const change of [{body:{items:[{...body.items[0],qty:2}]}},{body:{coupon:''}},{body:{bulk_order:true}},
  {body:{delivery:{shipping:'express',extras:[]}}},{body:{id:'a0000000-0000-4000-8000-000000000009'}},
  {body:{quote:'0'.repeat(64)}},{catalog:[{...catalog[0],variants:[{size:'5mg',price:101}]}]},{method:{version:4}},{method:{active:false}}]){
  const db=database(),{res:q}=await call({...body,action:'quote'},{db});
  if(change.method)Object.assign(db.state.methods[0],change.method);
  const {res}=await call({...body,action:'place',quote:q.body.quote,...change.body},{db,cat:change.catalog||catalog});
  assert.equal(res.code,409,JSON.stringify(change));assert.equal(db.calls.length,0);
 }
});

test('receiving method is revalidated just before request creation',async()=>{
 for(const change of [{active:false},{version:4},{label:'Changed receiving route'},{currency:'USD'},{native_provider:'rampex'}]){
  const db=database({onMethodsRead:state=>{if(state.methodReads===3)Object.assign(state.methods[0],change);}});
  const {res:q}=await call({...body,action:'quote'},{db});assert.equal(q.code,200);
  const {res}=await call({...body,action:'place',quote:q.body.quote},{db});assert.equal(res.code,409);assert.equal(db.calls.length,0);
 }
});

test('foreign or conflicting invoice references cannot replay another request',async()=>{
 const db=database({invoices:[{id,customer_id:'a0000000-0000-4000-8000-000000000099',status:'requested',request_digest:'unrelated',checkout_version:null}]});
 const {res:q}=await call({...body,action:'quote'},{db});
 const {res}=await call({...body,action:'place',quote:q.body.quote},{db});assert.equal(res.code,409);assert.equal(db.state.invoices.length,1);assert.deepEqual(db.state.balance,{points:1000,credit_cents:5000});
 for(const change of [{consent:false},{research_use:false},{checkout_version:'outdated'},{method_id:'forged'}]){
  const {res:invalid,db:untouched}=await call({...body,action:'quote',...change});assert.equal(invalid.code,400);assert.equal(untouched.calls.length,0);
 }
});
