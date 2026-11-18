'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const checkout=require('../lib/direct-checkout'),config=require('../config/checkout.json'),delivery=require('../lib/delivery-options');
const read=name=>fs.readFileSync(path.join(__dirname,'../supabase/migrations',name),'utf8');
const fixture=require('./fixtures/commerce-sql-fixture.cjs');

test('isolated PostgreSQL creates accepted CAD Interac orders, preserves USD ledgers, and requires verified receipt before fulfillment',{timeout:60000},async t=>{
 const db=new PGlite(),methodId=randomUUID(),cardId=randomUUID(),partner=randomUUID();
 const rpc=async(name,args)=>(await db.query('select '+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') result',args)).rows[0].result;
 const load=async id=>(await db.query('select * from commerce_invoices where id=$1',[id])).rows[0];
 const count=async(table,id)=>(await db.query('select count(*)::int n from '+table+(id?' where invoice_id=$1':''),id?[id]:[])).rows[0].n;
 const makeFx=(rate=1375000)=>{const now=Date.now();return{fx_ppm:rate,source:'Bank of Canada',series:'FXUSDCAD',
  rate_date:new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now)),
  quoted_at:new Date(now).toISOString(),expires_at:new Date(now+1800000).toISOString(),token:'isolated-signed-rate-fixture'};};
 const catalog=[{id:'a',name:'Fixture A',variants:[{size:'5mg',price:19.99}]},{id:'b',name:'Fixture B',variants:[{size:'10mg',price:30.01}]}];
 let method;
 async function make({customer=randomUUID(),coupon='BLACKFRIDAY15',rate=1375000,qty=2,shipping='standard',extras=['protection'],referral=null,cat=catalog}={}){
  const record=await checkout.normalize({}, {id:customer,email:'fixture@example.test'}, {id:randomUUID(),kind:'goods',name:'Fixture researcher',method_id:methodId,checkout_version:config.version,consent:true,research_use:true,
   coupon,items:[{id:'a',size:'5mg',qty},{id:'b',size:'10mg',qty:1}],bulk_order:qty>=10,
   address:{line1:'123 Fixture Street',city:'Fixture City',region:'ON',postal_code:'N2L 1A1',country:'CA'},delivery:{shipping,extras}},cat);
  record.request.checkout.input_digest=record.digest;record.request.preferred_payment={method_id:method.id,provider_key:'interac',label:method.label,currency:'CAD'};
  record.request.checkout.payment_kind='interac';record.request.checkout.payment_method_version=method.version;
  delete record.digest;record.digest=createHash('sha256').update(JSON.stringify(record)).digest('hex');
  return{...record,...checkout.price(record,method,null,{points:0,credit_cents:0},referral,delivery.defaults,makeFx(rate)),checkout_version:checkout.INTERAC_VERSION};
 }
 const place=p=>rpc('commerce_place_interac_checkout',[JSON.stringify(p)]);
 const payment=(p,extra={})=>({method_id:methodId,expected_version:1,receipt_id:randomUUID(),external_reference:'FIXTURE-BANK-'+randomUUID(),confirm_funds_received:true,...extra});
 const pay=(p,receipt)=>rpc('commerce_admin_record_bank_payment',[p.id,JSON.stringify(receipt)]);
 try{
  await fixture.base(db);
  await db.exec(read('20261117084413_pure_storefront_regular_pricing.sql'));
  await db.exec(read('20261118020145_pure_generic_manual_fulfillment.sql'));
  for(const option of delivery.defaults)await db.query('update commerce_delivery_options set label=$2,price_cents=$3,enabled=$4,description=$5 where id=$1',[option.id,option.label,option.price_cents,option.enabled,option.description]);
  await db.exec(read('20261117192240_pure_canada_next_day_delivery.sql'));
  await db.exec(read('20261117221328_pure_stack_crypto_discount.sql'));
  await db.query("insert into commerce_payment_methods(id,kind,provider_key,label,currency,payee,instructions,acceptance_reference,active,sale_scope) values($1,'interac','interac','Fixture Interac','CAD','Fixture business','Fixture only: receiving@example.test','Isolated bank approval fixture',true,'goods')",[methodId]);
  await db.query("insert into commerce_payment_methods(id,kind,provider_key,label,currency,payee,instructions,acceptance_reference,active,sale_scope,native_provider) values($1,'hosted_link','custom','Card','USD','Fixture business','Fixture native instructions','Isolated native route fixture',true,'goods','rampex')",[cardId]);
  await db.query("insert into commerce_gateway_accounts(method_id,provider,mode,account_tag,countries,rampex_provider) values($1,'rampex','live',$2,array['US','CA'],'hosted')",[cardId,'a'.repeat(64)]);
  await db.query("insert into commerce_partners(customer_id,code,terms_version) values($1,'FIXTUREPARTNER','partner-2026-11-v1')",[partner]);
  await db.query("insert into commerce_partner_codes(code,partner_id) values('FIXTUREPARTNER',$1)",[partner]);
  method=(await db.query('select * from commerce_payment_methods where id=$1',[methodId])).rows[0];

  const historical=randomUUID(),legacyCustomer=randomUUID();
  await rpc('commerce_request_invoice',[JSON.stringify({id:historical,customer_id:legacyCustomer,customer_email:'historical@example.test',customer_name:'Historical fixture',kind:'goods',terms_version:'launch-2026-11-v1',consent:true,digest:'a'.repeat(64),request:{items:[],preferred_payment:{method_id:methodId,provider_key:'interac',currency:'CAD'}}})]);
  const before=await load(historical),routesBefore=(await db.query('select to_jsonb(m) row from commerce_payment_methods m order by id')).rows;
  const nativeFunctionBefore=(await db.query("select pg_get_functiondef('public.commerce_place_checkout(jsonb)'::regprocedure) fn")).rows[0].fn;
  await db.exec(read('20261118070801_pure_interac_cad_checkout.sql'));

  await t.test('migration preserves all historical requests and payment methods and leaves native USD placement untouched',async()=>{
   assert.deepEqual(await load(historical),before);assert.deepEqual((await db.query('select to_jsonb(m) row from commerce_payment_methods m order by id')).rows,routesBefore);
   assert.equal((await db.query("select pg_get_functiondef('public.commerce_place_checkout(jsonb)'::regprocedure) fn")).rows[0].fn,nativeFunctionBefore);
   const grants=(await db.query("select has_function_privilege('anon','public.commerce_place_interac_checkout(jsonb)','EXECUTE') anon,has_function_privilege('authenticated','public.commerce_place_interac_checkout(jsonb)','EXECUTE') customer,has_function_privilege('service_role','public.commerce_place_interac_checkout(jsonb)','EXECUTE') backend,has_function_privilege('service_role','commerce_internal.validate_interac_checkout(jsonb)','EXECUTE') validator")).rows[0];
   assert.deepEqual(grants,{anon:false,customer:false,backend:true,validator:false});
  });

  await fixture.polygon(db);
  await db.exec(read('20261118180549_pure_membership_checkout.sql'));
  method=(await db.query('select * from commerce_payment_methods where id=$1',[methodId])).rows[0];

  await t.test('SQL independently matches per-unit CAD conversion, coupon allocation and each selected delivery component',async()=>{
   for(const rate of [1000000,1375000,1429100])for(const cents of [1,9,19,21,1999])for(const coupon of ['','BLACKFRIDAY15']){
    const cat=[{...catalog[0],variants:[{size:'5mg',price:cents/100}]},{...catalog[1],variants:[{size:'10mg',price:cents/100}]}];
    const p=await make({rate,coupon,qty:3,shipping:'next_day',extras:['priority','protection'],cat});
    await db.query('select commerce_internal.validate_interac_checkout($1::jsonb)',[JSON.stringify(p)]);
    assert.equal(p.discount_cents,p.pricing.lines.reduce((sum,line)=>sum+line.discount_cents,0));
    assert.equal(p.total_cents,p.subtotal_cents-p.discount_cents+p.shipping_cents);assert.equal(p.tax_cents,0);
   }
  });

  await t.test('tampered prices, credits, FX expiry, reference metadata, coupon, delivery and USD commission basis fail atomically',async()=>{
   const changes=[p=>p.currency='USD',p=>p.request.address.country='US',p=>p.points_redeemed=100,p=>p.credit_redeemed_cents=1,p=>p.earned_points=1,p=>p.tax_cents=1,
    p=>p.total_cents--,p=>p.subtotal_cents++,p=>p.discount_cents++,p=>p.shipping_cents--,p=>p.request.checkout.points=100,
    p=>p.request.checkout.credit_cents=1,p=>p.pricing.redeemed_points=1,p=>p.pricing.credit_cents=1,p=>p.pricing.usd_basis.merchandise_cents++,p=>delete p.pricing.usd_basis,
    p=>p.pricing.lines[0].qty++,p=>p.pricing.lines[0].unit_price_cents++,p=>p.pricing.lines[0].coupon_discount_cents++,p=>p.pricing.lines[0].crypto_discount_cents=1,
    p=>p.request.checkout.coupon='RETIRED',p=>p.pricing.coupon_code='',p=>p.request.preferred_payment.method_id=randomUUID(),p=>p.request.preferred_payment.label='Forged receiver',
    p=>p.request.checkout.request_only=true,p=>p.pricing.delivery.extras[0].amount_cents++,p=>p.pricing.fx.fx_ppm++,p=>p.pricing.fx.source='Caller supplied',
    p=>p.pricing.fx.rate_date='2000-01-01',p=>p.pricing.fx.expires_at=new Date(Date.now()-1).toISOString(),p=>p.pricing.fx.expires_at=new Date(Date.now()+3600000).toISOString()];
   const initial=await count('commerce_invoices');
   for(const change of changes){const p=await make();change(p);await assert.rejects(place(p));assert.equal(await load(p.id),undefined);}
   assert.equal(await count('commerce_invoices'),initial);assert.equal(await count('commerce_receipts'),0);assert.equal(await count('commerce_balance_events'),0);assert.equal(await count('commerce_fulfillment_items'),0);
   const p=await make({referral:{customer_id:partner,code:'FORGED',first_order:true}});await assert.rejects(place(p),/Referral unavailable/);
  });

  await t.test('inactive, changed or native receiving routes and disabled delivery are rejected inside the transaction',async()=>{
   for(const update of ["active=false","version=version+1","native_provider='rampex'","currency='USD'","provider_key='bank_transfer'","sale_scope='membership'"]){
    const p=await make();await db.query('update commerce_payment_methods set '+update+' where id=$1',[methodId]);
    await assert.rejects(place(p),/Payment method changed|Interac receiving method changed/);
    await db.query("update commerce_payment_methods set active=true,version=$2,native_provider=null,currency='CAD',provider_key='interac',sale_scope='both' where id=$1",[methodId,method.version]);
   }
   const p=await make();await db.exec("update commerce_delivery_options set enabled=false where id='protection'");await assert.rejects(place(p),/Delivery extra unavailable/);await db.exec("update commerce_delivery_options set enabled=true where id='protection'");
  });

  const customer=randomUUID(),referral={customer_id:partner,code:'FIXTUREPARTNER',first_order:true};
  await db.query('insert into commerce_balance_accounts(customer_id,points,credit_cents) values($1,1500,5000)',[customer]);
  const balanceBefore=(await db.query('select * from commerce_balance_accounts where customer_id=$1',[customer])).rows[0];
  const order=await make({customer,referral}),receipt=payment(order);
  await t.test('placement accepts one fixed CAD order without charging, moving balances, creating fulfillment or exposing a native link',async()=>{
   const result=await place(order);assert.equal(result.status,'accepted');assert.equal(result.currency,'CAD');assert.equal(result.manual_transfer,true);assert.equal(result.total_cents,14361);
   const saved=await load(order.id);assert.equal(saved.status,'accepted');assert.equal(saved.currency,'CAD');assert.equal(saved.total_cents,14361);assert.ok(saved.accepted_at);assert.equal(saved.paid_at,null);
   assert.equal(saved.checkout_version,checkout.INTERAC_VERSION);assert.equal(saved.payment_snapshot.currency,'CAD');assert.equal(saved.payment_snapshot.kind,'interac');assert.equal(saved.payment_snapshot.payment_url,null);
   assert.equal(saved.payment_snapshot.instructions,method.instructions);assert.equal(saved.payment_snapshot.payment_reference,'AP'+order.id.replaceAll('-','').slice(0,10).toUpperCase());
   assert.deepEqual(saved.pricing,order.pricing);assert.deepEqual(saved.request_data.items,order.request.items);assert.equal(await count('commerce_receipts',order.id),0);assert.equal(await count('commerce_fulfillment_items',order.id),0);assert.equal(await count('commerce_supplier_jobs',order.id),0);assert.equal(await count('commerce_gateway_attempts',order.id),0);
   assert.equal(await count('commerce_balance_events',order.id),0);assert.equal(await count('commerce_partner_commissions',order.id),0);
   assert.equal((await place(order)).replayed,true);
   const expired=structuredClone(order);expired.pricing.fx.expires_at='2000-01-01T00:00:00.000Z';assert.equal((await place(expired)).total_cents,14361,'A retry reads the fixed saved order even after quote expiry');
   await assert.rejects(place({...order,customer_id:randomUUID()}),/reference conflict/);await assert.rejects(place({...order,digest:'b'.repeat(64)}),/reference conflict/);
   await assert.rejects(rpc('commerce_admin_fulfill_order',[order.id,JSON.stringify({action:'update_order',version:1,status:'processing',note:'Fixture processing request'})]),/Paid physical order required/);
  });

  await t.test('only exact confirmed CAD receipt pays the order, then seeds purchased quantities and USD partner commission once',async()=>{
   await assert.rejects(pay(order,{...receipt,confirm_funds_received:false}),/Received funds/);await assert.rejects(pay(order,{...receipt,method_id:cardId}),/Manual bank/);await assert.rejects(pay(order,{...receipt,expected_version:2}),/Order changed/);
   for(const extra of [{currency:'USD',amount_cents:order.total_cents},{currency:'CAD',amount_cents:order.total_cents-1}])await assert.rejects(rpc('commerce_admin_command',['record_payment',JSON.stringify({id:order.id,version:1,receipt_id:randomUUID(),external_reference:'FIXTURE-BAD-RECEIPT',funds_confirmed:true,...extra}),'isolated-test']),/matching the accepted invoice/);
   assert.equal((await pay(order,receipt)).status,'paid');assert.equal((await pay(order,receipt)).replayed,true);assert.equal(await count('commerce_receipts',order.id),1);
   const savedReceipt=(await db.query('select amount_cents,currency from commerce_receipts where invoice_id=$1',[order.id])).rows[0];assert.deepEqual(savedReceipt,{amount_cents:14361,currency:'CAD'});
   const allocations=(await db.query('select item,route,status from commerce_fulfillment_items where invoice_id=$1 order by variant_key',[order.id])).rows;
   assert.deepEqual(allocations.map(a=>a.item),order.request.items);assert.ok(allocations.every(a=>a.route==='manual'&&a.status==='pending'));assert.equal(await count('commerce_supplier_jobs',order.id),0);
   assert.deepEqual((await db.query('select basis_cents,rate_bps,amount_cents from commerce_partner_commissions where invoice_id=$1',[order.id])).rows[0],{basis_cents:5949,rate_bps:2000,amount_cents:1189});
   assert.deepEqual((await db.query('select * from commerce_balance_accounts where customer_id=$1',[customer])).rows[0],balanceBefore);assert.equal(await count('commerce_balance_events',order.id),0);
   await assert.rejects(pay(order,{...receipt,external_reference:'DIFFERENT-TRANSFER'}),/Receipt replay conflict/);
  });

  await t.test('repeat commissions, verified CAD refund and unpaid cancellation preserve USD balances',async()=>{
   const repeat=await make({customer,referral:{...referral,first_order:false}});await place(repeat);
   await assert.rejects(pay(repeat,{...payment(repeat),external_reference:receipt.external_reference}),/unique constraint/);assert.equal((await load(repeat.id)).status,'accepted');
   await pay(repeat,payment(repeat));assert.deepEqual((await db.query('select basis_cents,rate_bps,amount_cents from commerce_partner_commissions where invoice_id=$1',[repeat.id])).rows[0],{basis_cents:5949,rate_bps:1000,amount_cents:594});
   const refund={id:order.id,version:2,receipt_id:randomUUID(),external_reference:'FIXTURE-REFUND-'+randomUUID(),amount_cents:order.total_cents,currency:'CAD',funds_confirmed:true};
   await rpc('commerce_admin_command',['record_refund',JSON.stringify(refund),'isolated-refund']);assert.equal((await load(order.id)).status,'refunded');assert.equal((await db.query('select status from commerce_partner_commissions where invoice_id=$1',[order.id])).rows[0].status,'reversed');
   const canceled=await make({customer});await place(canceled);await assert.rejects(rpc('commerce_cancel_checkout',[canceled.id,randomUUID()]),/Order not found/);assert.equal((await rpc('commerce_cancel_checkout',[canceled.id,customer])).status,'void');await assert.rejects(pay(canceled,payment(canceled)),/Order changed/);
   assert.deepEqual((await db.query('select * from commerce_balance_accounts where customer_id=$1',[customer])).rows[0],balanceBefore);assert.equal(await count('commerce_balance_events'),0);
  });

  await t.test('v6/v7 USD commissions retain their saved USD amount and never use the new CAD basis',async()=>{
   for(const version of ['checkout-2026-11-v6','checkout-2026-11-v7']){
    const id=randomUUID(),uid=randomUUID();
    await db.query("insert into commerce_invoices(id,customer_id,customer_email,customer_name,kind,request_digest,request_data,status,method_id,payment_snapshot,currency,subtotal_cents,discount_cents,shipping_cents,tax_cents,total_cents,pricing,checkout_version,points_redeemed,credit_redeemed_cents,earned_points) values($1,$2,'legacy@example.test','Legacy USD fixture','goods',$3,'{\"items\":[]}', 'accepted',$4,'{\"kind\":\"hosted_link\"}','USD',10000,1500,1000,0,8900,'{}',$5,100,500,0)",[id,uid,'c'.repeat(64),cardId,version]);
    await db.query('insert into commerce_referrals(customer_id,partner_id,first_invoice_id) values($1,$2,$3)',[uid,partner,id]);
    await rpc('commerce_admin_command',['record_payment',JSON.stringify({id,version:1,receipt_id:randomUUID(),external_reference:'USD-FIXTURE-'+id,amount_cents:8900,currency:'USD',funds_confirmed:true}),'isolated-usd']);
    assert.deepEqual((await db.query('select basis_cents,rate_bps,amount_cents from commerce_partner_commissions where invoice_id=$1',[id])).rows[0],{basis_cents:7900,rate_bps:2000,amount_cents:1580});
   }
  });
 }finally{await db.close();}
});
