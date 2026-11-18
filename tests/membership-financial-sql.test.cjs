'use strict';
// Disposable PostgreSQL only. Set NODE_PATH to the pinned PGlite installation.
// No production credentials, provider calls, real transfers or remote DDL.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {randomUUID,randomBytes,createHash}=require('node:crypto');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const checkout=require('../lib/direct-checkout'),config=require('../config/checkout.json');
const delivery=require('../lib/delivery-options'),polygon=require('../lib/polygon-usdc');
const read=name=>fs.readFileSync(path.join(__dirname,'../supabase/migrations',name),'utf8');
const migration='20261118180549_pure_membership_checkout.sql';
const recipient='0x'+'a'.repeat(40),payer='0x'+'b'.repeat(40);
const polygonTag=polygon.configuration({POLYGON_USDC_RECIPIENT:recipient}).account_tag;
const hash=()=> '0x'+randomBytes(32).toString('hex');
const catalog=[
 {id:'fixture-a',name:'Fixture A',category:'injectables',variants:[{size:'5mg',price:99.99}]},
 {id:'fixture-b',name:'Fixture B',category:'injectables',variants:[{size:'10mg',price:100.01}]},
 {id:'fixture-c',name:'Fixture C',category:'injectables',variants:[{size:'5mg',price:50}]},
 {id:'fixture-d',name:'Fixture D',category:'injectables',variants:[{size:'10mg',price:60}]}
];
const fxQuote=(rate=1375000)=>{const now=Date.now();return {fx_ppm:rate,source:'Bank of Canada',series:'FXUSDCAD',
 rate_date:new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now)),
 quoted_at:new Date(now).toISOString(),expires_at:new Date(now+1800000).toISOString(),token:'isolated-signed-fx-fixture'};};

test('PURE memberships execute verified fees and goods benefits atomically in disposable PostgreSQL',{timeout:120000},async t=>{
 const db=new PGlite();
 const ids={card:randomUUID(),crypto:randomUUID(),interac:randomUUID(),stripe:randomUUID(),inactive:randomUUID()};
 const expiredCustomer=randomUUID(),expiredInvoice=randomUUID(),historicalOrder=randomUUID(),historicalSubscription=randomUUID();
 const expiringCustomer=randomUUID(),expiringInvoice=randomUUID();
 const rpc=async(name,args)=>(await db.query('select '+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') result',args.map(v=>v!==null&&typeof v==='object'?JSON.stringify(v):v))).rows[0].result;
 const load=async id=>(await db.query('select * from public.commerce_invoices where id=$1',[id])).rows[0];
 const member=async customer=>(await db.query('select * from commerce_internal.active_paid_membership($1,now())',[customer])).rows[0];
 const count=async(table,id)=>(await db.query('select count(*)::int n from '+table+(id?' where invoice_id=$1':''),id?[id]:[])).rows[0].n;
 let methods={};
 async function make({kind='goods',plan='vip',period='monthly',customer=randomUUID(),route='card',coupon='',points=0,credit=0,shipping='standard',extras=[],country=route==='interac'?'CA':'US',items,cat=catalog,rate=1375000,builder=false}={}){
  const method=methods[route],user={id:customer,email:'membership-fixture@example.test'};
  const body={id:randomUUID(),kind,plan:kind==='membership'?plan:undefined,billing_period:kind==='membership'?period:undefined,
   method_id:method.id,checkout_version:config.version,consent:true,research_use:true,name:'Isolated researcher',
   coupon,points,credit_cents:credit,items:items||cat.slice(0,builder?4:2).map(x=>({id:x.id,size:x.variants[0].size,qty:1})),
   address:{line1:'123 Fixture Street',city:'Fixture City',region:country==='CA'?'ON':'NY',postal_code:country==='CA'?'N2L 1A1':'10001',country},
   delivery:{shipping,extras},...(builder?{research_builder_mode:'one_time'}:{})};
  const record=await checkout.normalize({},user,body,cat);
  if(route==='interac'){
   record.request.checkout.input_digest=record.digest;
   record.request.preferred_payment={method_id:method.id,provider_key:'interac',label:method.label,currency:'CAD'};
   record.request.checkout.payment_kind='interac';record.request.checkout.payment_method_version=method.version;
   delete record.digest;record.digest=createHash('sha256').update(JSON.stringify(record)).digest('hex');
  }
  const membership=await member(customer);
  const balance=(await db.query('select points,credit_cents from commerce_balance_accounts where customer_id=$1',[customer])).rows[0]||{points:0,credit_cents:0};
  const result=checkout.price(record,method,membership?.invoice_id?membership:null,balance,null,delivery.defaults,route==='interac'?fxQuote(rate):null);
  return {...record,...result,checkout_version:route==='interac'?checkout.INTERAC_VERSION:config.version};
 }
 const place=p=>rpc(p.currency==='CAD'?'commerce_place_interac_checkout':'commerce_place_checkout',[p]);
 async function pay(p,{external,receipt=randomUUID(),version}={}){
  const saved=await load(p.id);
  if(saved.currency==='CAD')return rpc('commerce_admin_record_bank_payment',[p.id,{method_id:p.method_id,expected_version:version||saved.version,receipt_id:receipt,
   external_reference:external||'ISOLATED-INTERAC-'+receipt,confirm_funds_received:true}]);
  return rpc('commerce_admin_command',['record_payment',{id:p.id,version:version||saved.version,receipt_id:receipt,
   external_reference:external||'ISOLATED-PAYMENT-'+receipt,amount_cents:p.total_cents,currency:p.currency,funds_confirmed:true},'isolated-verified-payment']);
 }
 async function refund(p){const saved=await load(p.id);return rpc('commerce_admin_command',['record_refund',{id:p.id,version:saved.version,receipt_id:randomUUID(),
  external_reference:'ISOLATED-REFUND-'+randomUUID(),amount_cents:p.total_cents,currency:p.currency,funds_confirmed:true},'isolated-verified-refund']);}
 async function enroll({customer=randomUUID(),plan='vip',period='monthly',route='card'}={}){const p=await make({customer,kind:'membership',plan,period,route});await place(p);await pay(p);return p;}
 try{
  await db.exec('create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create schema commerce_internal;');
  for(const file of [
   '20261110040926_manual_invoice_commerce.sql','20261110074742_payment_provider_options.sql','20261110164316_native_gateway_checkout.sql',
   '20261111013606_peptidepay_invoice_sessions.sql','20261111025932_direct_checkout_balances.sql','20261111163930_conversion_memberships_partners.sql',
   '20261111174353_partner_settings_supplier_queue.sql','20261111195957_unified_supplier_fulfillment.sql','20261111210000_single_supplier_per_order.sql',
   '20261112211215_rampex_order_payment_mapping.sql','20261112221052_rampex_multi_hosted.sql','20261113003946_rampex_stripe_only.sql','20261113030240_safe_checkout_cancellation.sql',
   '20261114211235_platinum_membership_benefits.sql','20261115090000_research_subscriptions.sql','20261116140000_unified_order_management.sql',
   '20261116150000_purity_manual_fulfillment.sql'
  ]){try{await db.exec(read(file));}catch(error){error.message=file+': '+error.message;throw error;}}
  // Real historical rows exist before the retirement and restoration migrations.
  await db.query("insert into commerce_invoices(id,customer_id,customer_email,customer_name,kind,plan,request_digest,request_data,status,currency,subtotal_cents,discount_cents,shipping_cents,tax_cents,total_cents,checkout_version,paid_at) values($1,$2,'history@example.test','Expired member','membership','vip',repeat('a',64),'{\"items\":[],\"billing_period\":\"monthly\"}','paid','USD',1999,0,0,0,1999,'checkout-2026-11-v4','2020-01-01')",[expiredInvoice,expiredCustomer]);
  await db.query("insert into commerce_memberships(invoice_id,customer_id,plan,starts_at,expires_at) values($1,$2,'vip','2020-01-01','2020-02-01')",[expiredInvoice,expiredCustomer]);
  await db.query("insert into commerce_invoices(id,customer_id,customer_email,customer_name,kind,plan,request_digest,request_data,status,currency,subtotal_cents,discount_cents,shipping_cents,tax_cents,total_cents,checkout_version,paid_at) values($1,$2,'history@example.test','Expiring member','membership','elite',repeat('d',64),'{\"items\":[],\"billing_period\":\"monthly\"}','paid','USD',9999,0,0,0,9999,'checkout-2026-11-v4',now()-interval '1 month'+interval '30 minutes')",[expiringInvoice,expiringCustomer]);
  await db.query("insert into commerce_memberships(invoice_id,customer_id,plan,starts_at,expires_at) values($1,$2,'elite',now()-interval '1 month'+interval '30 minutes',now()+interval '30 minutes')",[expiringInvoice,expiringCustomer]);
  await db.query("insert into commerce_invoices(id,customer_id,customer_email,customer_name,kind,request_digest,request_data,status) values($1,$2,'history@example.test','Historical order','goods',repeat('b',64),'{\"items\":[]}','requested')",[historicalOrder,expiredCustomer]);
  await db.query('insert into auth.users values($1)',[expiredCustomer]);
  await db.query("insert into research_subscriptions(id,customer_id,customer_email,status,lines,shipping_address,retail_cents,discount_cents,monthly_cents) values($1,$2,'history@example.test','canceled','[]','{}',10000,4000,6000)",[historicalSubscription,expiredCustomer]);
  const historyBefore=(await db.query('select to_jsonb(m) row from commerce_memberships m where invoice_id=$1',[expiredInvoice])).rows[0].row;
  await db.query("insert into commerce_payment_methods(id,kind,provider_key,label,currency,payee,instructions,allowed_host,acceptance_reference,active,sale_scope,native_provider) values($1,'hosted_link','custom','Fixture Card','USD','Isolated business','Disposable verified payment fixture','getpurelabs.com','Isolated provider acceptance fixture',true,'goods','rampex')",[ids.card]);
  await db.query("insert into commerce_gateway_accounts(method_id,provider,mode,account_tag,countries,rampex_provider) values($1,'rampex','live',$2,array['US','CA'],'hosted')",[ids.card,'a'.repeat(64)]);
  for(const file of ['20261117084413_pure_storefront_regular_pricing.sql','20261117192240_pure_canada_next_day_delivery.sql',
   '20261117194109_pure_card_crypto_checkout.sql','20261117221328_pure_stack_crypto_discount.sql','20261118020145_pure_generic_manual_fulfillment.sql',
   '20261118070801_pure_interac_cad_checkout.sql']){try{await db.exec(read(file));}catch(error){error.message=file+': '+error.message;throw error;}}
  // Network/scheduler stand-ins are never called by the financial test flow.
  await db.exec("create schema cron;create table cron.job(jobname text primary key,schedule text,command text);create function cron.schedule(text,text,text) returns bigint language plpgsql as $$begin insert into cron.job values($1,$2,$3) on conflict(jobname) do update set schedule=$2,command=$3;return 1;end$$;create schema vault;create table vault.decrypted_secrets(name text,decrypted_secret text);create schema extensions;create function extensions.hmac(bytea,bytea,text) returns bytea language sql as $$select decode(repeat('a',64),'hex')$$;create schema net;create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language sql as $$select 1::bigint$$;");
  for(const file of ['20261117193534_pure_direct_polygon_usdc.sql','20261117221400_pure_crypto_cancellation_requests.sql']){try{await db.exec(read(file));}catch(error){error.message=file+': '+error.message;throw error;}}
  for(const option of delivery.defaults)await db.query('update commerce_delivery_options set label=$2,price_cents=$3,enabled=$4,description=$5 where id=$1',[option.id,option.label,option.price_cents,option.enabled,option.description]);
  for(const [route,provider,rail,active] of [['crypto','polygon_usdc',null,true],['stripe','rampex','stripe',true],['inactive','rampex','hosted',false]]){
   await db.query("insert into commerce_payment_methods(id,kind,provider_key,label,currency,payee,instructions,allowed_host,acceptance_reference,active,sale_scope,native_provider) values($1,'hosted_link','custom',$2,'USD','Isolated business','Disposable verified payment fixture','getpurelabs.com','Isolated provider acceptance fixture',$3,'goods',$4)",[ids[route],'Fixture '+route,active,provider]);
   await db.query("insert into commerce_gateway_accounts(method_id,provider,mode,account_tag,countries,rampex_provider,polygon_recipient) values($1,$2,'live',$3,array['US','CA'],$4,$5)",[ids[route],provider,route==='crypto'?polygonTag:'a'.repeat(64),rail,route==='crypto'?recipient:null]);
  }
  await db.query("insert into commerce_payment_methods(id,kind,provider_key,label,currency,payee,instructions,acceptance_reference,active,sale_scope) values($1,'interac','interac','Fixture Interac','CAD','Fixture business','Disposable fixture: receiving@example.test','Isolated receiver approval',true,'goods')",[ids.interac]);
  const historicalBefore=await load(historicalOrder);
  await db.exec(read(migration));
  await db.exec(read('20261118231100_pure_quantity_tiers.sql'));
  await db.exec(read('20261118235500_pure_canadian_free_standard_shipping.sql'));
  for(const route of Object.keys(ids))methods[route]=(await db.query('select * from commerce_payment_methods where id=$1',[ids[route]])).rows[0];

  await t.test('migration preserves history, retired recurring guards, and inactive/old Stripe receiving routes',async()=>{
   assert.deepEqual((await db.query('select to_jsonb(m) row from commerce_memberships m where invoice_id=$1',[expiredInvoice])).rows[0].row,historyBefore);
   const after=await load(historicalOrder);delete after.membership_invoice_id;delete after.priority_fulfillment;assert.deepEqual(after,historicalBefore);
   for(const route of ['card','crypto','interac'])assert.equal(methods[route].sale_scope,'both');
   assert.equal(methods.inactive.active,false);assert.equal(methods.inactive.sale_scope,'goods');assert.equal(methods.inactive.version,1);
   assert.equal(methods.stripe.sale_scope,'goods');assert.equal(methods.stripe.version,1);
   await assert.rejects(db.query("insert into research_subscriptions(customer_id,customer_email,lines,shipping_address,retail_cents,discount_cents,monthly_cents) values($1,'fixture@example.test','[]','{}',10000,4000,6000)",[expiredCustomer]),/Subscription creation/);
   await assert.rejects(db.query("insert into research_subscription_cycles(subscription_id,cycle_number,provider_transaction_id,amount_cents,status,paid_at) values($1,1,'FORGED-RECURRING',6000,'paid',now())",[historicalSubscription]),/Subscription creation/);
  });

  await t.test('deployed v7 USD and v1 CAD goods still place and settle after migration without opening legacy programs',async()=>{
   const legacy=async route=>{
    const p=await make({route,coupon:'BLACKFRIDAY15'}),cad=p.currency==='CAD';
    p.checkout_version=p.pricing.checkout_version=cad?'checkout-interac-cad-2026-11-v1':'checkout-2026-11-v7';
    p.request.checkout.version='checkout-2026-11-v7';p.pricing.conversion_version='conversion-2026-11-v2';
    for(const key of ['membership_plan','membership_name','membership_discount_bps','membership_discount_cents','membership_benefits','usd_earned_points_basis_cents'])delete p.pricing[key];
    for(const line of p.pricing.lines)delete line.membership_discount_cents;
    delete p.pricing.delivery.membership_shipping;
    if(cad)delete p.pricing.usd_basis.membership_discount_cents;
    p.digest=createHash('sha256').update(JSON.stringify(p.request)).digest('hex');return p;
   };
   for(const route of ['card','crypto','interac']){
    const p=await legacy(route),placed=await place(p);assert.equal(placed.status,'accepted');assert.equal((await place(p)).replayed,true);
    await pay(p);const saved=await load(p.id);assert.equal(saved.status,'paid');assert.equal(saved.checkout_version,p.checkout_version);
    assert.equal(saved.priority_fulfillment,false);assert.equal(saved.membership_invoice_id,null);assert.equal(saved.earned_points,0);
    assert.equal(await count('commerce_fulfillment_items',p.id),2);
    for(const change of [x=>x.kind='membership',x=>x.plan='elite',x=>x.membership_invoice_id=expiredInvoice,
     x=>x.request.subscription=true,x=>x.request.research_builder=true,x=>x.request.billing_period='monthly',x=>x.request.research_builder_mode='subscription']){
     const altered=await legacy(route);change(altered);await assert.rejects(place(altered));assert.equal(await load(altered.id),undefined);
    }
   }
   for(const name of ['legacy_pure_validate_checkout_v7','legacy_pure_place_checkout_v7','legacy_pure_validate_interac_v1','legacy_pure_place_interac_v1']){
    const grants=(await db.query("select has_function_privilege('anon',$1,'EXECUTE') anon,has_function_privilege('authenticated',$1,'EXECUTE') customer,has_function_privilege('service_role',$1,'EXECUTE') backend",['commerce_internal.'+name+'(jsonb)'])).rows[0];
    assert.deepEqual(grants,{anon:false,customer:false,backend:false});
   }
  });

  await t.test('admin saves preserve an explicit goods/both scope without reviving Stripe or changing receiving accounts',async()=>{
   for(const route of ['card','crypto']){
    const provider=route==='card'?'rampex':'polygon_usdc',name=route==='card'?'commerce_configure_rampex_gateway':'commerce_configure_polygon_usdc_gateway';
    const data={id:ids[route],version:methods[route].version,provider,mode:'live',currency:'USD',sale_scope:'both',confirmed:true,active:true,
     account_tag:route==='crypto'?polygonTag:'a'.repeat(64),countries:['US','CA'],label:'Fixture '+route,payee:'Isolated business',approval_reference:'Isolated approved scope fixture',
     ...(route==='card'?{rampex_provider:'hosted'}:{polygon_recipient:recipient})};
    const before=(await db.query('select to_jsonb(a) row from commerce_gateway_accounts a where method_id=$1',[ids[route]])).rows[0].row;
    await rpc(name,[data,'isolated-admin-save']);methods[route]=(await db.query('select * from commerce_payment_methods where id=$1',[ids[route]])).rows[0];
    assert.equal(methods[route].sale_scope,'both');assert.equal(methods[route].version,data.version+1);
    assert.deepEqual((await db.query('select to_jsonb(a) row from commerce_gateway_accounts a where method_id=$1',[ids[route]])).rows[0].row,before);
    for(const scope of ['goods','both']){
     await rpc(name,[{...data,version:methods[route].version,sale_scope:scope},'isolated-admin-save']);methods[route]=(await db.query('select * from commerce_payment_methods where id=$1',[ids[route]])).rows[0];assert.equal(methods[route].sale_scope,scope);
    }
    await assert.rejects(rpc(name,[{...data,version:methods[route].version,sale_scope:'membership'},'isolated-admin-save']),/Invalid/);
    const changed={...data,version:methods[route].version,...(route==='card'?{account_tag:'b'.repeat(64)}:{polygon_recipient:'0x'+'c'.repeat(40)})};
    await assert.rejects(rpc(name,[changed,'isolated-admin-save']),/different Rampex|Invalid Polygon/);
    if(route==='card')for(const rail of ['stripe','rampnetwork'])await assert.rejects(rpc(name,[{...data,version:methods[route].version,rampex_provider:rail},'isolated-admin-save']),/Invalid Rampex/);
   }
   assert.equal((await db.query('select sale_scope from commerce_payment_methods where id=$1',[ids.stripe])).rows[0].sale_scope,'goods');
  });

  await t.test('monthly and annual fees activate only after exact verified USD/CAD payment with calendar expiry and no shipping jobs',async()=>{
   for(const route of ['card','interac'])for(const plan of ['vip','elite'])for(const period of ['monthly','annual']){
    const p=await make({kind:'membership',route,plan,period});await place(p);
    assert.equal(await count('commerce_memberships',p.id),0);assert.equal(await count('commerce_fulfillment_items',p.id),0);
    await assert.rejects(rpc('commerce_admin_command',['record_payment',{id:p.id,version:1,receipt_id:randomUUID(),external_reference:'WRONG-ISOLATED-AMOUNT',amount_cents:p.total_cents-1,currency:p.currency,funds_confirmed:true},'isolated-payment']),/matching the accepted invoice/);
    await assert.rejects(db.query("insert into commerce_memberships(invoice_id,customer_id,plan,starts_at,expires_at) values($1,$2,$3,now(),now()+interval '1 year')",[p.id,p.customer_id,plan]),/Verified paid/);
    const receipt=randomUUID(),external='EXACT-ISOLATED-'+receipt;await pay(p,{receipt,external});await pay(p,{receipt,external,version:1});
    const membership=await member(p.customer_id);assert.equal(membership.plan,plan);assert.equal(membership.invoice_id,p.id);
    const duration=(await db.query("select expires_at=starts_at+case when $2='monthly' then interval '1 month' else interval '1 year' end correct from commerce_memberships where invoice_id=$1",[p.id,period])).rows[0];assert.equal(duration.correct,true);
    assert.equal(await count('commerce_memberships',p.id),1);assert.equal(await count('commerce_receipts',p.id),1);
    assert.equal(await count('commerce_fulfillment_items',p.id),0);assert.equal(await count('commerce_supplier_jobs',p.id),0);assert.equal(await count('commerce_balance_events',p.id),0);
   }
  });

  await t.test('membership source ownership, tier and receipt method must match before benefits activate or are revoked',async()=>{
   const p=await make({kind:'membership'});await place(p);
   // Simulate an incorrectly reconciled receipt in this disposable database.
   // Neither service_role nor customer roles have these direct write privileges.
   await db.exec('begin');
   try{
    await db.query("insert into commerce_receipts(id,invoice_id,kind,method_id,external_reference,amount_cents,currency,actor) values($1,$2,'payment',$3,'WRONG-PAYMENT-RAIL',$4,'USD','fixture')",[randomUUID(),p.id,ids.crypto,p.total_cents]);
    await db.query("update commerce_invoices set status='paid',paid_at=now() where id=$1",[p.id]);
    await assert.rejects(db.query("insert into commerce_memberships(invoice_id,customer_id,plan,starts_at,expires_at) values($1,$2,'vip',now(),now()+interval '1 month')",[p.id,p.customer_id]),/Verified paid membership/);
   }finally{await db.exec('rollback');}
   assert.equal(await count('commerce_memberships',p.id),0);await pay(p);
   const accepted=await make({customer:p.customer_id});await place(accepted);
   for(const [column,value] of [['customer_id',randomUUID()],['plan','elite'],['status','refunded']]){
    await db.exec('begin');
    try{
     await db.query('update commerce_invoices set '+column+'=$2 where id=$1',[p.id,value]);
     assert.equal((await member(p.customer_id)).invoice_id,null);
     await assert.rejects(pay(accepted),/Membership revoked|reconcile/);
    }finally{await db.exec('rollback');}
   }
   await db.exec('begin');
   try{
    await db.query("insert into commerce_receipts(id,invoice_id,kind,method_id,external_reference,amount_cents,currency,actor) values($1,$2,'refund',$3,'WRONG-REFUND-RAIL',$4,'USD','fixture')",[randomUUID(),p.id,ids.crypto,p.total_cents]);
    await db.query("update commerce_invoices set status='refunded' where id=$1",[p.id]);
    await assert.rejects(db.query('update commerce_memberships set revoked_at=now() where invoice_id=$1',[p.id]),/verified refund reconciliation/);
   }finally{await db.exec('rollback');}
   assert.equal((await member(p.customer_id)).invoice_id,p.id);await refund(p);assert.equal((await member(p.customer_id)).invoice_id,null);
  });

  await t.test('forged fees, tiers, billing modes, stale versions and method scopes cannot create an order',async()=>{
   const changes=[p=>p.plan='admin',p=>p.plan='elite',p=>p.request.billing_period='weekly',p=>p.request.items[0].unit_price_usd_cents=1,
    p=>p.pricing.automatic_renewal=true,p=>p.pricing.billing_mode='recurring',p=>p.request.automatic_renewal=true,
    p=>p.total_cents--,p=>p.pricing.lines[0].line_total_cents--,p=>p.discount_cents=1,p=>p.points_redeemed=100,p=>p.earned_points=1,
    p=>p.request.checkout.coupon='BLACKFRIDAY15',p=>p.pricing.crypto_discount_cents=1,p=>p.membership_invoice_id=expiredInvoice,
    p=>p.checkout_version='checkout-2026-11-v7',p=>p.method_version--,p=>p.request.subscription=true];
   for(const change of changes){const p=await make({kind:'membership'});change(p);await assert.rejects(place(p));assert.equal(await load(p.id),undefined);}
   const cad=await make({kind:'membership',route:'interac'});cad.pricing.fx.expires_at='2020-01-01T00:00:00Z';await assert.rejects(place(cad),/expired/);
   const p=await make({kind:'membership'});await db.query("update commerce_payment_methods set sale_scope='goods' where id=$1",[ids.card]);await assert.rejects(place(p),/method changed/);await db.query("update commerce_payment_methods set sale_scope='both' where id=$1",[ids.card]);
  });

  await t.test('duplicate pending/active purchases are blocked; expired memberships permit a new paid term',async()=>{
   const p=await make({kind:'membership'}),duplicate=await make({kind:'membership',customer:p.customer_id});await place(p);await assert.rejects(place(duplicate),/unpaid membership/);
   await pay(p);await assert.rejects(place(duplicate),/Membership changed/);
   await assert.rejects(make({kind:'membership',customer:p.customer_id}),/already active/);
   const renewed=await enroll({customer:expiredCustomer});assert.notEqual(renewed.id,expiredInvoice);
   assert.equal((await member(expiredCustomer)).invoice_id,renewed.id);
   assert.deepEqual((await db.query('select to_jsonb(m) row from commerce_memberships m where invoice_id=$1',[expiredInvoice])).rows[0].row,historyBefore);
  });

  await t.test('best member/coupon savings, additional Crypto savings and delivery match server prices across rounding boundaries',async()=>{
   const white=await enroll({plan:'vip'}),black=await enroll({plan:'elite'});
   for(const customer of [randomUUID(),white.customer_id,black.customer_id])for(const route of ['card','crypto','interac'])for(const coupon of ['','BLACKFRIDAY15'])for(const cents of [1,9,19,21,1999]){
    const cat=catalog.slice(0,2).map(x=>({...x,variants:[{...x.variants[0],price:cents/100}]}));
    const p=await make({customer,route,coupon,cat,shipping:'express',extras:['protection']});
    await db.query('select commerce_internal.validate_membership_checkout($1::jsonb)',[JSON.stringify(p)]);
    assert.equal(p.discount_cents,p.pricing.lines.reduce((sum,line)=>sum+line.discount_cents,0));
    if(coupon)assert.equal(p.pricing.membership_discount_cents,0);
    if(customer!==white.customer_id&&customer!==black.customer_id)assert.equal(p.earned_points,0);
   }
   for(const [country,shipping,expected] of [['US','standard',0],['US','express',0],['US','next_day',6995],['CA','express',5995],['CA','next_day',6995]]){
    const p=await make({customer:white.customer_id,country,shipping});await db.query('select commerce_internal.validate_regular_checkout($1::jsonb)',[JSON.stringify(p)]);assert.equal(p.shipping_cents,expected);
   }
   const p=await make({customer:white.customer_id,shipping:'express',extras:['priority','protection']});assert.equal(p.shipping_cents,delivery.defaults.filter(x=>['priority','protection'].includes(x.id)).reduce((sum,x)=>sum+x.price_cents,0));
   for(const route of ['card','interac']){
    const included=await make({customer:black.customer_id,route,shipping:'express',extras:['priority','protection']});
    await db.query('select commerce_internal.validate_membership_checkout($1::jsonb)',[JSON.stringify(included)]);
    assert.deepEqual(included.pricing.delivery.extras.find(x=>x.id==='priority'),{id:'priority',label:delivery.defaults.find(x=>x.id==='priority').label,amount_cents:0,included_by_membership:true});
   }
  });

  await t.test('account value redemptions, Crypto suppression and balance-only refunds preserve the USD ledger',async()=>{
   const white=await enroll(),earnedOrder=await make({customer:white.customer_id});await place(earnedOrder);await pay(earnedOrder);
   await rpc('commerce_issue_credit',[randomUUID(),white.customer_id,20000,'Isolated account credit fixture','isolated-admin']);
   const paid=await make({customer:white.customer_id,route:'crypto',points:100,credit:500});
   assert.equal(paid.pricing.usd_earned_points_basis_cents,17450);assert.equal(paid.earned_points,872);
   await db.query('select commerce_internal.validate_regular_checkout($1::jsonb)',[JSON.stringify(paid)]);
   const p=await make({customer:white.customer_id,route:'crypto',points:100,credit:18900});
   assert.equal(p.total_cents,0);assert.equal(p.pricing.crypto_discount_suppressed_for_balance,true);assert.equal(p.pricing.crypto_discount_cents,0);assert.equal(p.earned_points,0);
   await place(p);assert.equal((await load(p.id)).status,'paid');assert.equal(await count('commerce_receipts',p.id),0);assert.equal(await count('commerce_gateway_attempts',p.id),0);
   assert.deepEqual((await db.query('select points,credit_cents from commerce_balance_accounts where customer_id=$1',[white.customer_id])).rows[0],{points:850,credit_cents:1100});
   const saved=await load(p.id);await rpc('commerce_refund_balance_order',[p.id,saved.version,'isolated-balance-refund']);
   assert.deepEqual((await db.query('select points,credit_cents from commerce_balance_accounts where customer_id=$1',[white.customer_id])).rows[0],{points:950,credit_cents:20000});
  });

  await t.test('tampered member snapshots, discounts, benefits and earnings fail before any order or balance mutation',async()=>{
   const black=await enroll({plan:'elite'});
   const changes=[p=>p.membership_invoice_id=randomUUID(),p=>p.pricing.membership_plan='vip',p=>p.pricing.membership_discount_bps=500,
    p=>p.pricing.membership_benefits.free_bac_water_3ml=false,p=>p.pricing.membership_discount_cents++,p=>p.pricing.lines[0].membership_discount_cents++,
    p=>p.pricing.lines[0].crypto_discount_cents++,p=>p.pricing.lines[0].discount_reason='coupon_blackfriday15',p=>p.pricing.usd_earned_points_basis_cents++,
    p=>p.earned_points++,p=>p.pricing.delivery.membership_shipping=false,p=>p.pricing.delivery.extras[0].amount_cents=100];
   for(const change of changes){const p=await make({customer:black.customer_id,route:'crypto',shipping:'express',extras:['priority']});change(p);await assert.rejects(place(p));assert.equal(await load(p.id),undefined);}
   assert.deepEqual((await db.query('select points,credit_cents from commerce_balance_accounts where customer_id=$1',[black.customer_id])).rows[0],{points:0,credit_cents:0});
  });

  await t.test('Black paid goods receive one BAC gift, priority, points and one USD monthly credit; refunds reverse earned value',async()=>{
   const black=await enroll({plan:'elite'}),p=await make({customer:black.customer_id});await place(p);
   assert.equal((await load(p.id)).priority_fulfillment,false);assert.equal(await count('commerce_fulfillment_items',p.id),0);
   await pay(p);const saved=await load(p.id);assert.equal(saved.priority_fulfillment,true);assert.equal(saved.membership_invoice_id,black.id);
   const allocations=(await db.query('select item,route,supplier_name from commerce_fulfillment_items where invoice_id=$1',[p.id])).rows;
   assert.equal(allocations.length,3);assert.equal(allocations.filter(x=>x.item.membership_gift===true).length,1);assert.ok(allocations.every(x=>x.route==='manual'&&x.supplier_name===''));
   await db.query('select commerce_internal.fulfillment_seed($1)',[p.id]);assert.equal(await count('commerce_fulfillment_items',p.id),3);assert.equal(await count('commerce_supplier_jobs',p.id),0);
   assert.deepEqual((await db.query('select points,credit_cents from commerce_balance_accounts where customer_id=$1',[p.customer_id])).rows[0],{points:1800,credit_cents:5000});
   const second=await make({customer:p.customer_id});await place(second);await pay(second);
   assert.equal((await db.query("select count(*)::int n from commerce_balance_events where customer_id=$1 and reference like 'platinum-monthly-credit:%'",[p.customer_id])).rows[0].n,1);
   assert.equal((await db.query('select credit_cents from commerce_balance_accounts where customer_id=$1',[p.customer_id])).rows[0].credit_cents,5000);
   await refund(p);assert.deepEqual((await db.query('select points,credit_cents from commerce_balance_accounts where customer_id=$1',[p.customer_id])).rows[0],{points:1800,credit_cents:0});
   const third=await make({customer:p.customer_id});await place(third);await pay(third);assert.equal((await db.query('select credit_cents from commerce_balance_accounts where customer_id=$1',[p.customer_id])).rows[0].credit_cents,0,'Refund does not allow another monthly reward');
   await refund(black);assert.equal((await member(p.customer_id)).invoice_id,null);assert.ok((await db.query('select revoked_at from commerce_memberships where invoice_id=$1',[black.id])).rows[0].revoked_at);
  });

  await t.test('CAD goods earn on canonical USD merchandise, never CAD cents, and cannot redeem USD balances',async()=>{
   const black=await enroll({plan:'elite',route:'interac'}),p=await make({customer:black.customer_id,route:'interac',rate:1429100});
   assert.equal(p.pricing.usd_basis.merchandise_cents,18000);assert.equal(p.pricing.usd_earned_points_basis_cents,18000);assert.equal(p.earned_points,1800);
   const bad=structuredClone(p);bad.pricing.usd_earned_points_basis_cents=bad.subtotal_cents-bad.discount_cents;await assert.rejects(place(bad),/earning basis/);
   const badCredit=structuredClone(p);badCredit.credit_redeemed_cents=100;await assert.rejects(place(badCredit));
   await place(p);await pay(p);assert.deepEqual((await db.query('select points,credit_cents from commerce_balance_accounts where customer_id=$1',[p.customer_id])).rows[0],{points:1800,credit_cents:5000});
   const under=await enroll({plan:'elite'}),small=await make({customer:under.customer_id,route:'interac',items:[{id:catalog[0].id,size:'5mg',qty:1}]});await place(small);await pay(small);
   assert.equal((await db.query('select credit_cents from commerce_balance_accounts where customer_id=$1',[small.customer_id])).rows[0].credit_cents,0,'CAD converted amount cannot make a sub-US$150 order qualify');
   assert.equal((await db.query("select count(*)::int n from commerce_fulfillment_items where invoice_id=$1 and item->>'membership_gift'='true'",[small.id])).rows[0].n,1,'BAC has no US$150 minimum');
  });

  await t.test('an accepted membership snapshot survives natural term expiry within its payment deadline',async()=>{
   const p=await make({customer:expiringCustomer});await place(p);
   const receipt=randomUUID();
   await db.exec('begin');
   await db.query("insert into commerce_receipts(id,invoice_id,kind,method_id,external_reference,amount_cents,currency,actor) values($1,$2,'payment',$3,$4,$5,'USD','isolated-time-boundary')",[receipt,p.id,p.method_id,'ISOLATED-LATE-TERM-'+receipt,p.total_cents]);
   await db.query("update commerce_invoices set status='paid',paid_at=(select expires_at+interval '1 minute' from commerce_memberships where invoice_id=$2),version=version+1 where id=$1",[p.id,expiringInvoice]);
   await db.exec('commit');
   const result=(await db.query('select i.priority_fulfillment,i.paid_at>m.expires_at term_expired,i.paid_at<i.expires_at within_deadline from commerce_invoices i join commerce_memberships m on m.invoice_id=i.membership_invoice_id where i.id=$1',[p.id])).rows[0];
   assert.deepEqual(result,{priority_fulfillment:true,term_expired:true,within_deadline:true});
   assert.equal((await db.query("select count(*)::int n from commerce_fulfillment_items where invoice_id=$1 and item->>'membership_gift'='true'",[p.id])).rows[0].n,1);
   assert.equal((await db.query('select credit_cents from commerce_balance_accounts where customer_id=$1',[expiringCustomer])).rows[0].credit_cents,5000);
  });

  await t.test('already-spent monthly reward enters refund reconciliation without creating negative credit or another reward',async()=>{
   const black=await enroll({plan:'elite'}),original=await make({customer:black.customer_id});await place(original);await pay(original);
   const spending=await make({customer:black.customer_id,credit:5000});await place(spending);await pay(spending);await refund(original);
   assert.equal((await db.query('select credit_cents from commerce_balance_accounts where customer_id=$1',[black.customer_id])).rows[0].credit_cents,0);
   assert.equal((await db.query("select count(*)::int n from commerce_events where invoice_id=$1 and action='platinum_credit_reconciliation_required'",[original.id])).rows[0].n,1);
   assert.equal((await db.query("select count(*)::int n from commerce_balance_events where customer_id=$1 and delta=5000 and reference like 'platinum-monthly-credit:%'",[black.customer_id])).rows[0].n,1);
  });

  await t.test('refund of a member fee invalidates an outstanding discounted order and stale entitlement quote',async()=>{
   const white=await enroll(),pending=await make({customer:white.customer_id}),quoted=await make({customer:white.customer_id});await place(pending);await refund(white);
   await assert.rejects(place(quoted),/Membership changed/);await assert.rejects(pay(pending),/Membership revoked/);
   assert.equal((await load(pending.id)).status,'accepted');assert.equal(await count('commerce_receipts',pending.id),0);assert.equal(await count('commerce_fulfillment_items',pending.id),0);
   const fake=await make();fake.membership_invoice_id=white.id;fake.pricing.membership_plan='elite';await assert.rejects(place(fake),/Membership changed/);
  });

  await t.test('one-time Research Builder uses four normal-price products and cannot activate a subscription',async()=>{
   const p=await make({builder:true});assert.equal(p.request.research_builder_mode,'one_time');await place(p);assert.equal(p.discount_cents,0);assert.equal(p.pricing.bundled_items,undefined);
   const bad=await make({builder:true});bad.request.items[1].id=bad.request.items[0].id;await assert.rejects(place(bad),/four different/);
   const subscription=await make({builder:true});subscription.request.subscription=true;await assert.rejects(place(subscription));
   await pay(p);assert.equal(await count('commerce_fulfillment_items',p.id),4);assert.equal((await db.query('select count(*)::int n from research_subscriptions')).rows[0].n,1);
  });

  await t.test('current prepaid fees may use existing Rampex and Polygon payment attempt/receipt paths exactly once',async()=>{
   const card=await make({kind:'membership'});await place(card);const attempt=randomUUID();
   await rpc('commerce_begin_gateway_attempt',[attempt,card.id,card.customer_id,'sale','a'.repeat(64)]);
   await rpc('commerce_finish_gateway_attempt',[attempt,'ISOLATED-CARD-EVENT','approved','ISOLATED-CARD-TX',card.total_cents,'USD',null,null]);
   assert.equal((await member(card.customer_id)).invoice_id,card.id);assert.equal(await count('commerce_fulfillment_items',card.id),0);
   const crypto=await make({kind:'membership',plan:'elite',route:'crypto'});await place(crypto);assert.equal(crypto.total_cents,9999,'Crypto never discounts a membership fee');
   const now=Math.floor(Date.now()/1000),intent=await rpc('commerce_create_polygon_usdc_intent',[randomUUID(),crypto.id,crypto.customer_id,polygonTag,{chain_id:137,token:polygon.TOKEN,recipient,payer,amount_units:String(crypto.total_cents*10000),nonce:hash(),valid_after:now-60,valid_before:now+1800,start_block:'42'}]);
   const proof={chain_id:137,token:polygon.TOKEN,recipient,payer,nonce:intent.nonce,amount_units:intent.amount_units,tx_hash:hash(),log_index:1,block_number:'43',block_hash:hash(),block_timestamp:now+1,finalized_number:'44'};
   await rpc('commerce_finish_polygon_usdc_payment',[intent.attempt_id,polygonTag,proof]);await rpc('commerce_finish_polygon_usdc_payment',[intent.attempt_id,polygonTag,proof]);
   assert.equal((await member(crypto.customer_id)).invoice_id,crypto.id);assert.equal(await count('commerce_receipts',crypto.id),1);assert.equal(await count('commerce_fulfillment_items',crypto.id),0);
  });

  await t.test('browser roles cannot mutate fees, benefits, priority or call financial validators directly',async()=>{
   const grants=(await db.query("select has_function_privilege('anon','public.commerce_place_checkout(jsonb)','EXECUTE') anon_place,has_function_privilege('authenticated','public.commerce_place_interac_checkout(jsonb)','EXECUTE') customer_place,has_function_privilege('service_role','public.commerce_place_checkout(jsonb)','EXECUTE') backend_place,has_function_privilege('service_role','commerce_internal.validate_membership_checkout(jsonb)','EXECUTE') backend_validator,has_table_privilege('authenticated','commerce_memberships','INSERT') customer_membership,has_table_privilege('service_role','commerce_invoices','UPDATE') direct_write")).rows[0];
   assert.deepEqual(grants,{anon_place:false,customer_place:false,backend_place:true,backend_validator:false,customer_membership:false,direct_write:false});
  });
 }finally{await db.close();}
});
