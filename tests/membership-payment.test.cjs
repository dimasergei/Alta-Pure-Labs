'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const membership=require('../lib/membership-payment'),checkout=require('../lib/direct-checkout');
const conversion=require('../lib/conversion-pricing'),gateway=require('../lib/native-gateway');
const polygon=require('../lib/polygon-usdc'),rampex=require('../lib/rampex'),rampexPayments=require('../lib/rampex-payments');
const notifications=require('../lib/invoice-notifications');
const adminActions=require('../lib/unified-admin-actions');
const manual=require('../lib/manual-commerce');
const id='a1000000-0000-4000-8000-000000000001',mid='a1000000-0000-4000-8000-000000000002',aid='a1000000-0000-4000-8000-000000000003';
const user={id:'a1000000-0000-4000-8000-000000000004',email:'fixture@example.test'};
const recipient='0x1111111111111111111111111111111111111111',payer='0x2222222222222222222222222222222222222222';
const env={SITE_URL:'https://getpurelabs.com',RAMPEX_API_KEY:'offline-fixture-only',RAMPEX_WEBHOOK_SECRET:'offline-fixture-webhook-only',RAMPEX_ENABLED:'true',
 POLYGON_USDC_RECIPIENT:recipient,POLYGON_USDC_RPC_URL:'https://polygon.test',POLYGON_USDC_SECONDARY_RPC_URL:'https://independent-polygon.test',POLYGON_USDC_ENABLED:'true',
 ADMIN_ORDERS_PASSWORD:'offline-admin-fixture-not-a-real-secret-123',RESEND_API_KEY:'offline-mail-fixture',ORDER_CONFIRMATION_FROM:'PURE <orders@example.test>',ADMIN_ORDER_EMAIL:'admin@example.test'};
const fx={fx_ppm:1375000,source:'Bank of Canada',series:'FXUSDCAD',rate_date:'2026-11-18',quoted_at:'2026-11-18T12:00:00Z',expires_at:'2026-11-18T12:30:00Z',token:'offline-rate-token'};
function method(currency='USD',provider='rampex'){
 return{id:mid,active:true,version:2,currency,sale_scope:'both',kind:currency==='CAD'?'interac':'hosted_link',provider_key:currency==='CAD'?'interac':'custom',
  native_provider:currency==='CAD'?null:provider,rampex_provider:provider==='rampex'?'hosted':undefined,countries:['US','CA']};
}
function account(provider='rampex',currency='USD'){
 const config=provider==='polygon_usdc'?polygon.configuration(env):rampex.configuration(env);
 return{method_id:mid,provider,mode:'live',account_tag:config.account_tag,rampex_provider:provider==='rampex'?'hosted':undefined,countries:['US','CA'],method:method(currency,provider)};
}
function invoice(plan='vip',period='monthly',currency='USD',provider='rampex'){
 const record={id,customer_id:user.id,customer_name:'Fixture Researcher',customer_email:user.email,kind:'membership',plan,
  request:{billing_period:period,items:[conversion.membershipItem(plan,period)],address:{line1:'123 Fixture Street',city:'Toronto',region:'ON',postal_code:'M5V 1A1',country:'CA'},
   checkout:{version:membership.USD_VERSION,method_id:mid,points:0,credit_cents:0,coupon:'',delivery:{shipping:'standard',extras:[]}}}};
 const quote=checkout.price(record,method(currency,provider),null,{points:0,credit_cents:0},null,undefined,currency==='CAD'?fx:null);
 return{...record,...quote,request_data:record.request,checkout_version:currency==='CAD'?membership.CAD_VERSION:membership.USD_VERSION,
  status:'accepted',expires_at:'2099-01-01T00:00:00Z'};
}
function paymentBody(i){return{action:'pay',invoice_id:i.id,attempt_id:aid,wallet_address:payer,confirm_amount_cents:i.total_cents,confirm_currency:i.currency,consent:true,crypto_conversion_consent:true};}
function response(){return{setHeader(){},status(value){this.code=value;return this;},json(value){this.body=value;return this;}};}
function notice(i,event='checkout_placed',audience='customer'){
 const {id,kind,plan,checkout_version,status,currency,total_cents,customer_name,customer_email,expires_at}=i;
 return{id:aid,invoice_id:id,audience,event_action:event,snapshot:{id,kind,plan,checkout_version,status,currency,total_cents,customer_name,customer_email,expires_at},
  detail:{request_data:i.request_data,pricing:i.pricing,subtotal_cents:i.subtotal_cents,discount_cents:i.discount_cents,shipping_cents:i.shipping_cents,
   tax_cents:i.tax_cents,points_redeemed:i.points_redeemed,credit_redeemed_cents:i.credit_redeemed_cents,earned_points:i.earned_points}};
}
function entitlement(i){return{invoice_id:i.id,plan:i.plan,starts_at:new Date(Date.now()-3600000).toISOString(),expires_at:new Date(Date.now()+29*86400000).toISOString(),revoked_at:null};}

test('canonical PURE plan, term and currency prices pass the shared payment contract',()=>{
 const prices={vip:{monthly:1999,annual:19190},elite:{monthly:9999,annual:95990}};
 for(const plan of ['vip','elite'])for(const term of ['monthly','annual'])for(const currency of ['USD','CAD']){
  const i=invoice(plan,term,currency),out=membership.membershipDetails(i);
  assert.ok(out,`${plan}/${term}/${currency} must match the actual checkout quote`);
  assert.equal(out.amount_cents,Math.round(prices[plan][term]*(currency==='CAD'?1.375:1)));
  assert.equal(out.automatic_renewal,false);assert.equal(out.name,plan==='vip'?'PURE WHITE':'PURE BLACK');
  assert.equal(membership.supportsMembershipPayment(i,currency==='CAD'?method('CAD'):account()),true);
 }
});

test('legacy, future, discounted, tampered and automatic membership requests cannot become payable',async()=>{
 const changes=[i=>i.checkout_version='checkout-2026-11-v7',i=>i.checkout_version='checkout-2026-11-v9',i=>i.plan='member',i=>i.plan='__proto__',
  i=>i.request_data.billing_period='weekly',i=>i.request_data.checkout.version='checkout-2026-11-v7',i=>i.pricing.conversion_version='conversion-2026-11-v2',
  i=>i.total_cents--,i=>i.subtotal_cents++,i=>i.currency='CAD',i=>i.points_redeemed=100,i=>i.credit_redeemed_cents=1,i=>i.earned_points=1,
  i=>i.discount_cents=1,i=>i.shipping_cents=1,i=>i.tax_cents=1,i=>i.request_data.checkout.points=1,i=>i.request_data.checkout.credit_cents=1,
  i=>i.request_data.checkout.coupon='BLACKFRIDAY15',i=>i.pricing.coupon_code='BLACKFRIDAY15',i=>i.pricing.crypto_discount_cents=1,
  i=>i.pricing.membership_discount_cents=1,i=>i.pricing.redeemed_points=1,i=>i.pricing.credit_cents=1,i=>i.pricing.billing_mode='subscription',
  i=>i.pricing.automatic_renewal=true,i=>i.request_data.subscription=true,i=>i.request_data.research_builder=true,i=>i.request_data.bulk_order=true,
  i=>i.request_data.subscription='true',i=>i.request_data.subscription='false',i=>i.request_data.research_builder={},
  i=>i.request_data.bulk_order='true',i=>i.request_data.automatic_renewal=1,i=>i.request_data.automatic_renewal=null,
  i=>i.request_data.research_builder_mode='monthly',i=>i.request_data.research_builder_mode='one_time',
  i=>i.request_data.items[0].qty=2,i=>i.request_data.items[0].unit_price_usd_cents=1,i=>i.pricing.lines[0].gross_cents=1,
  i=>i.pricing.lines[0].line_total_cents=1,i=>i.pricing.lines[0].discount_bps=500,i=>i.pricing.lines[0].name='Injected gift',
  i=>i.membership_invoice_id='different-membership',i=>i.pricing.membership_gift={id:'gift'},i=>i.pricing.referral={partner_id:'forged'}];
 for(const change of changes){const i=invoice();change(i);assert.equal(membership.isMembershipInvoice(i),false,change.toString());
  let calls=0;await assert.rejects(gateway.startPayment({rpc:async()=>{calls++;}},i,account(),rampex.configuration(env),paymentBody(i),user,env,async()=>{calls++;},async()=>{calls++;}),e=>e.status===409);
  assert.equal(calls,0,'An invalid membership cannot reach a processor or payment RPC');}
 for(const change of [i=>i.request_data.address.country='US',i=>i.pricing.fx.source='Client supplied',i=>i.pricing.fx.fx_ppm++,i=>i.pricing.fx_ppm=0]){
  const i=invoice('elite','annual','CAD');change(i);assert.equal(membership.isMembershipInvoice(i),false);
 }
});

test('request normalization rejects ambiguous automatic billing before creating any purchase',async()=>{
 const i=invoice(),body={id,kind:'membership',plan:'vip',billing_period:'monthly',consent:true,
  terms_version:require('../config/launch-commercial-terms.json').version,name:'Fixture Researcher',address:i.request_data.address};
 let calls=0;
 const db={rpc:async(_name,args)=>{calls++;return{data:args.p_data};}};
 for(const patch of [{subscription:true},{subscription:'false'},{subscription:{}},{research_builder:'true'},
  {research_builder:null},{automatic_renewal:1},{automatic_renewal:[]},{research_builder_mode:'monthly'},
  {research_builder_mode:'one_time'}]){
  await assert.rejects(manual.requestInvoice(db,user,{...body,...patch},[],{direct:true}),error=>error.status===409);
 }
 assert.equal(calls,0,'Ambiguous billing intent must not create a request');
 const canonical=await manual.requestInvoice(db,user,{...body,subscription:false,research_builder:false,automatic_renewal:false},[],{direct:true});
 assert.equal(calls,1);assert.deepEqual(canonical.request.items,[conversion.membershipItem('vip','monthly')]);
 assert.equal(canonical.request.subscription,undefined);assert.equal(canonical.request.automatic_renewal,undefined);
});

test('only active approved membership routes match a paid-term invoice',()=>{
 const i=invoice();
 for(const change of [a=>a.method.sale_scope='goods',a=>a.method.active=false,a=>a.method.active='true',a=>a.method.id='other',a=>a.method_id='other',
  a=>a.method.currency='CAD',a=>a.method.kind='interac',a=>a.method.provider_key='stripe',a=>a.mode='sandbox',a=>a.provider='nmi',
  a=>a.method.native_provider='stripe',a=>a.rampex_provider='stripe',a=>a.countries=['US']]){
  const a=account();change(a);assert.equal(membership.supportsMembershipPayment(i,a),false,change.toString());
 }
 const exclusive=account();exclusive.method.sale_scope='membership';assert.equal(membership.supportsMembershipPayment(i,exclusive),true);
 assert.equal(membership.supportsMembershipPayment(invoice('vip','monthly','USD','polygon_usdc'),account('polygon_usdc')),true);
 const cad=invoice('vip','monthly','CAD');for(const patch of [{currency:'USD'},{native_provider:'polygon_usdc'},{provider_key:'custom'},{kind:'bank_transfer'},{sale_scope:'goods'}])
  assert.equal(membership.supportsMembershipPayment(cad,{...method('CAD'),...patch}),false);
 assert.equal(membership.allowsPayment({kind:'goods'},{}),true,'Existing goods route policy is unchanged');
});

test('native membership checkout reaches only the existing one-time adapter after exact consent',async t=>{
 let calls=0;t.mock.method(rampexPayments,'start',async(db,i,a,c,b)=>{calls++;assert.equal(b.consent,true);assert.equal(i.total_cents,19190);return{state:'redirected'};});
 const i=invoice('vip','annual'),a=account(),c=rampex.configuration(env),body=paymentBody(i);
 for(const patch of [{confirm_amount_cents:1},{confirm_currency:'CAD'},{consent:false}])await assert.rejects(gateway.startPayment({},i,a,c,{...body,...patch},user,env,async()=>{},async()=>{}));
 assert.equal(calls,0);assert.equal((await gateway.startPayment({},i,a,c,body,user,env,async()=>{},async()=>{})).state,'redirected');assert.equal(calls,1);
});

test('hosted membership link creation does not create a subscription or activate benefits',async()=>{
 const i=invoice(),a=account(),c=rampex.configuration(env),calls=[],requests=[];
 const db={rpc:async(name,args)=>{calls.push(name);if(name==='commerce_begin_rampex_attempt')return{data:{id:aid,invoice_id:id,claimed:true,state:'started',provider:'rampex',mode:'live',rampex_provider:'hosted',amount_cents:i.total_cents,currency:'USD'}};
  if(name==='commerce_bind_rampex_link')return{data:{state:'redirected'}};throw Error('Unexpected financial operation '+name);}};
 const fetchMock=async(url,options)=>{requests.push({url,options});return new Response(JSON.stringify({success:true,data:url.endsWith('/provider-status')?{providers:[{id:'rampnetwork',status:'active',minimum_currency:'USD',minimum_amount:4}]}:
  {link_id:'membership-fixture',status:'active',amount:19.99,currency:'USD',customer_email:user.email,provider:'hosted',redirect_url:'https://checkout.rampex.io/pay/membership-fixture?provider=hosted'}}));};
 const result=await rampexPayments.start(db,i,a,c,paymentBody(i),user,env,fetchMock,async()=>{});
 assert.equal(result.state,'redirected');assert.deepEqual(calls,['commerce_begin_rampex_attempt','commerce_bind_rampex_link']);
 const request=JSON.parse(requests.find(r=>r.options.method==='POST').options.body);assert.equal(request.amount,19.99);assert.equal(request.provider,'hosted');
 assert.equal(request.subscription,undefined);assert.equal(request.automatic_renewal,undefined);
 for(const bad of [{...a,rampex_provider:'stripe'},{...a,method:{...a.method,sale_scope:'goods'}}])await assert.rejects(rampexPayments.start({},i,bad,c,paymentBody(i),user,env,()=>{throw Error('Must not fetch');},()=>{throw Error('Must not claim');}),e=>e.status===409);
});

test('Polygon membership payments reuse only their exact existing order authorization',async()=>{
 const i=invoice('elite','monthly','USD','polygon_usdc'),a=account('polygon_usdc'),c=polygon.configuration(env);
 const intent={attempt_id:aid,invoice_id:id,account_tag:c.account_tag,chain_id:137,token:polygon.TOKEN,recipient,payer,amount_units:String(i.total_cents*10000),
  nonce:'0x'+'1'.repeat(64),valid_after:1,valid_before:4070908800,status:'open'};
 const db={from(){return{select(){return this;},eq(){return this;},order(){return this;},limit(){return this;},maybeSingle:async()=>({data:intent})};},rpc(){throw Error('An existing authorization must not be recreated');}};
 const result=await polygon.start(db,i,a,c,paymentBody(i),user,env,()=>{throw Error('Existing intent requires no network');});
 assert.equal(result.state,'awaiting_wallet');assert.equal(result.authorization.message.value,'99990000');assert.equal(result.authorization.message.nonce,intent.nonce);
 await assert.rejects(polygon.start(db,{...i,checkout_version:'checkout-2026-11-v7'},a,c,paymentBody(i),user,env),e=>e.status===409);
 await assert.rejects(polygon.confirm({}, {...i,checkout_version:'checkout-2026-11-v7'},a,c,{attempt_id:aid},user,env),e=>e.status===409);
});

test('native admin permits both scope for hosted Card and Polygon but cannot configure legacy Stripe',async t=>{
 t.mock.method(polygon,'readiness',async()=>({ready:true}));
 for(const provider of ['rampex','polygon_usdc'])for(const scope of ['goods','both']){
  const calls=[],db={rpc:async(name,args)=>{calls.push({name,args});return{data:{saved:true}};}};
  const body={action:'configure',id:mid,provider,rampex_provider:'hosted',version:0,active:true,currency:'USD',sale_scope:scope,confirmed:true,
   label:'Fixture gateway',payee:'PURE',approval_reference:'Offline owner authorization fixture',countries:['US','CA']};
  const run=async value=>{const res=response();await gateway.handle({method:'POST',headers:{origin:env.SITE_URL,'content-type':'application/json','x-admin-password':env.ADMIN_ORDERS_PASSWORD},body:JSON.stringify(value)},res,new URLSearchParams({native:'admin'}),{env,db});return res;};
  assert.equal((await run(body)).code,200);assert.equal(calls.length,1);assert.equal(calls[0].args.p_data.sale_scope,scope);
  if(provider==='rampex'){assert.equal((await run({...body,rampex_provider:'stripe'})).code,400);assert.equal(calls.length,1);}
 }
});

test('membership emails describe the exact saved currency and term without shipping or automatic billing',()=>{
 for(const plan of ['vip','elite'])for(const period of ['monthly','annual'])for(const currency of ['USD','CAD'])for(const audience of ['customer','admin']){
  const i=invoice(plan,period,currency),n=notice(i,'checkout_placed',audience),before=JSON.stringify(n),out=notifications.envelope(n,env);
  assert.ok(out);assert.match(out.subject,/membership purchase/);assert.match(out.text,period==='monthly'?/1-month prepaid term/:/12-month prepaid term/);
  assert.match(out.text,new RegExp(currency));assert.ok(out.text.includes(new Intl.NumberFormat('en-US',{style:'currency',currency}).format(i.total_cents/100)));
  assert.match(out.text,/Payment is not yet confirmed/);assert.match(out.text,/benefits activate only after the payment is verified/);
  assert.match(out.text,/does not renew or charge you automatically/);assert.doesNotMatch(out.text,/shipment|invoice|Your membership benefits are active/i);
  assert.doesNotMatch(out.html,/shipping address|BANK-PRIVATE|<script>/i);assert.equal(JSON.stringify(n),before);
 }
});

test('membership activation emails require a verified payment and matching unrevoked entitlement',()=>{
 const i=invoice(),n=notice({...i,status:'paid'},'payment_recorded');
 assert.equal(notifications.envelope(n,env),null);
 for(const change of [e=>e.invoice_id=mid,e=>e.plan='elite',e=>e.revoked_at='2026-11-18',e=>e.expires_at='not-a-date']){
  const record=entitlement(i);change(record);assert.equal(notifications.envelope({...n,membership:record},env),null);
 }
 const record=entitlement(i),out=notifications.envelope({...n,membership:record},env);
 assert.match(out.text,/payment has been verified/);assert.match(out.text,/membership benefits are active/);assert.ok(out.text.includes(record.starts_at));assert.ok(out.text.includes(record.expires_at));
 assert.equal(notifications.envelope({...n,snapshot:{...n.snapshot,status:'accepted'},membership:record},env),null);
 const ended={...record,starts_at:'2020-01-01',expires_at:'2020-02-01'};
 assert.doesNotMatch(notifications.envelope({...n,membership:ended},env).text,/benefits are active/);
 const refund=notifications.envelope(notice({...i,status:'refunded'},'full_refund_recorded'),env);assert.match(refund.text,/benefits associated with this purchase have been revoked/);
 assert.equal(notifications.envelope({...notice(invoice('vip','monthly','CAD')),detail:undefined},env),null);
});

test('notification dispatch reads the saved membership entitlement before creating its immutable envelope',async()=>{
 const i=invoice('elite','annual','CAD'),n=notice({...i,status:'paid'},'payment_recorded'),record=entitlement(i),tables=[],calls=[];
 const db={from(table){tables.push(table);const q={select(){return q;},in(){return q;},lte(){return q;},eq(){return q;},order(){return q;},
  limit:async()=>({data:[n]}),maybeSingle:async()=>({data:table==='commerce_memberships'?record:n.detail})};return q;},
  rpc:async(name,args)=>{calls.push({name,args});return name==='commerce_claim_notification'?{data:{claimed:true,claim:mid,envelope:args.p_envelope}}:{data:true};}};
 const result=await notifications.dispatch(db,{env,delay:async()=>{},fetchImpl:async(url,options)=>{assert.equal(url,'https://api.resend.com/emails');
  assert.match(JSON.parse(options.body).text,/PURE BLACK/);assert.match(JSON.parse(options.body).text,/CAD/);return{ok:true,json:async()=>({id:'offline-message-id'})};}});
 assert.equal(result.accepted,1);assert.ok(tables.includes('commerce_memberships'));assert.equal(calls[0].name,'commerce_claim_notification');
});

test('manual CAD membership receipt is version-scoped and never invokes supplier fulfillment',async()=>{
 const i={...invoice('elite','annual','CAD'),version:1,payment_snapshot:{kind:'interac'}},m=method('CAD'),calls=[];
 let supplierCalls=0,mailCalls=0;
 const db={from(table){return{select(){return this;},eq(){return this;},maybeSingle:async()=>({data:table==='commerce_invoices'?i:m})};},
  rpc:async(name,args)=>{calls.push({name,args});return{data:{id,status:'paid'}};}};
 const body={action:'record_payment',id,method_id:mid,expected_version:1,receipt_id:aid,external_reference:'OFFLINE-BANK-RECEIPT',confirm_funds_received:true,amount_cents:1,currency:'USD'};
 const deps={env:{...env,LOTUS_FULFILLMENT_ENABLED:'true'},notificationsDispatch:async()=>{mailCalls++;return{accepted:1};},lotusRun:async()=>{supplierCalls++;throw Error('Memberships must never enter supplier fulfillment');}};
 assert.equal(adminActions.manualPaymentAllowed(i,m),true);
 const result=await adminActions.execute(db,body,deps);assert.equal(result.status,200);assert.equal(mailCalls,1);assert.equal(supplierCalls,0);
 assert.equal(calls.length,1);assert.equal(calls[0].name,'commerce_admin_record_bank_payment');assert.equal(calls[0].args.p_data.amount_cents,undefined);
 i.checkout_version='checkout-interac-cad-2026-11-v1';assert.equal((await adminActions.execute(db,body,deps)).status,409);assert.equal(calls.length,1);
});

test('membership orders reject shipping and tracking mutations before any database write',async()=>{
 const i={...invoice(),version:2,status:'paid'};let calls=0;
 const db={from(){return{select(){return this;},eq(){return this;},maybeSingle:async()=>({data:i})};},rpc(){calls++;throw Error('Must not mutate shipping');}};
 for(const action of ['update_order','update_tracking']){
  const result=await adminActions.execute(db,{action,id,version:2,status:'shipped',note:'A forged shipment request',tracking_carrier:'UPS',tracking_number:'12345678'},{});
  assert.equal(result.status,409);
 }
 assert.equal(calls,0);
});

test('customer membership payment details require the current method scope and live receiving account',async()=>{
 async function get(i,m,a,overrideEnv={}){
  const reads=[];
  const data={commerce_invoices:[i],commerce_payment_methods:[m],commerce_gateway_accounts:a?[a]:[],commerce_fulfillment_items:[],commerce_memberships:[]};
  const db={auth:{getUser:async()=>({data:{user:{...user,email_confirmed_at:'2026-01-01'}}})},from(table){reads.push(table);const q={select(){return q;},eq(){return q;},in(){return q;},order(){return q;},limit(){return q;},is(){return q;},lte(){return q;},gt(){return q;},then(resolve){return Promise.resolve({data:data[table]}).then(resolve);}};return q;},rpc(){throw Error('Customer GET must not mutate');}};
  const res=response();await manual.handle({method:'GET',headers:{authorization:'Bearer offline-session-fixture-not-real'}},res,new URLSearchParams({commerce:'customer'}),{db,env:{...env,...overrideEnv}});
  assert.equal(res.code,200);assert.equal(res.body.invoices.length,1);return{row:res.body.invoices[0],reads,body:res.body};
 }
 for(const provider of ['rampex','polygon_usdc','interac']){
  const currency=provider==='interac'?'CAD':'USD',i=invoice('vip','monthly',currency,provider),m=method(currency,provider),a=provider==='interac'?null:account(provider);
  i.payment_snapshot={kind:m.kind,label:'Fixture receiving route',instructions:'Saved receiving instructions',payment_url:currency==='USD'?'https://getpurelabs.com/pay.html?invoice='+id:null};
  const good=await get(i,m,a);assert.equal(good.row.payable,true);assert.ok(good.row.payment_snapshot);
  assert.equal(JSON.stringify(good.body).includes(env.RAMPEX_API_KEY),false);assert.equal(JSON.stringify(good.body).includes(a?.account_tag||'NEVER-PRESENT'),false);
  for(const patch of [{sale_scope:'goods'},{active:false},{currency:currency==='USD'?'CAD':'USD'},
   {native_provider:provider==='interac'?'polygon_usdc':'nmi'},{kind:'bank_transfer'}]){
   const bad=await get(i,{...m,...patch},a);assert.equal(bad.row.payable,false);assert.equal(bad.row.payment_snapshot,null);
  }
  if(a){for(const changed of [{...a,account_tag:'different-receiving-account'},{...a,mode:'sandbox'},{...a,countries:['US']},null]){
   const bad=await get(i,m,changed);assert.equal(bad.row.payable,false);assert.equal(bad.row.payment_snapshot,null);
  }
   const disabled=await get(i,m,a,provider==='rampex'?{RAMPEX_ENABLED:'false'}:{POLYGON_USDC_ENABLED:'false'});assert.equal(disabled.row.payable,false);
  }
  const historical=await get({...i,checkout_version:'checkout-2026-11-v7'},m,a);assert.equal(historical.row.payable,false);assert.equal(historical.row.payment_snapshot,null);
  const injected=await get({...i,membership_invoice_id:aid},m,a);assert.equal(injected.row.payable,false);assert.equal(injected.row.payment_snapshot,null);
 }
 const goods={...invoice(),kind:'goods',payment_snapshot:{kind:'hosted_link',instructions:'Existing goods payment'}};
 const old=await get(goods,{id:mid,active:true},null);assert.equal(old.row.payable,true);assert.ok(old.row.payment_snapshot);assert.equal(old.reads.includes('commerce_gateway_accounts'),false);
});
