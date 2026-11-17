'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{randomUUID}=require('node:crypto');
const checkout=require('../lib/direct-checkout'),config=require('../config/checkout.json'),delivery=require('../lib/delivery-options');
let PGlite;try{({PGlite}=require('@electric-sql/pglite'));}catch{}
const read=name=>fs.readFileSync('supabase/migrations/'+name,'utf8');
const hosted='1efcda11-7310-4c45-b6bb-3cfdd8873784',payer=randomUUID(),stripe=randomUUID(),bank=randomUUID();

test('isolated PostgreSQL enforces v7 stacked discounts and cents while preserving saved v6 payment and commission terms',{skip:!PGlite,timeout:60000},async()=>{
 const db=new PGlite();
 try{
  await db.exec('create role anon;create role authenticated;create role service_role;create schema commerce_internal;');
  await db.exec(read('20261110040926_manual_invoice_commerce.sql'));
  await db.exec("alter table commerce_payment_methods add column native_provider text,add column sale_scope text default 'goods',add column display_order integer default 1;create table commerce_gateway_accounts(method_id uuid primary key,provider text,mode text,account_tag text,countries text[],rampex_provider text);create table commerce_delivery_options(id text primary key,kind text,label text,price_cents integer,enabled boolean,description text);");
  await db.exec(read('20261111025932_direct_checkout_balances.sql'));
  await db.exec('create table commerce_gateway_attempts(invoice_id uuid,state text);');
  for(const [id,provider,rail,active] of [[hosted,'rampex','hosted',false],[payer,'polygon_usdc',null,true],[stripe,'rampex','stripe',true],[bank,null,null,true]]){
   await db.query("insert into commerce_payment_methods(id,kind,label,currency,payee,instructions,acceptance_reference,active,native_provider) values($1,$2,'Fixture route','USD','Fixture business','Isolated fixture instructions','Isolated fixture account approval',$3,$4)",[id,provider?'hosted_link':'bank_transfer',active,provider]);
   if(provider)await db.query("insert into commerce_gateway_accounts values($1,$2,'live',$3,array['US'],$4)",[id,provider,'a'.repeat(64),rail]);
  }
  for(const option of delivery.defaults)await db.query('insert into commerce_delivery_options values($1,$2,$3,$4,$5,$6)',[option.id,option.kind,option.label,option.price_cents,option.enabled,option.description]);
  const oldOrder=randomUUID(),oldCustomer=randomUUID();
  await db.query("insert into commerce_invoices(id,customer_id,customer_email,customer_name,kind,request_digest,request_data,status,method_id,payment_snapshot,currency,subtotal_cents,discount_cents,shipping_cents,tax_cents,total_cents) values($1,$2,'historical@example.test','Historical fixture','goods',$3,'{}','accepted',$4,'{\"kind\":\"bank_transfer\",\"label\":\"Original receiving method\"}','USD',10000,0,0,0,10000)",[oldOrder,oldCustomer,'b'.repeat(64),bank]);
  const before=(await db.query('select to_jsonb(i) row from commerce_invoices i where id=$1',[oldOrder])).rows[0].row;
  await db.exec(read('20261117192240_pure_canada_next_day_delivery.sql'));
  await db.exec(read('20261117194109_pure_card_crypto_checkout.sql'));
  const after=(await db.query('select to_jsonb(i) row from commerce_invoices i where id=$1',[oldOrder])).rows[0].row;
  assert.deepEqual(after,before,'Migration must not rewrite an existing invoice');
  const historical=(await db.query('select id,active,version from commerce_payment_methods where id in ($1,$2) order by id',[bank,stripe])).rows;
  assert.ok(historical.every(method=>method.active&&method.version===1),'Retired public methods remain usable for historical reconciliation');
  assert.deepEqual((await db.query('select countries from commerce_gateway_accounts where method_id=$1',[hosted])).rows[0].countries,['US','CA']);
  assert.equal((await db.query('select active from commerce_payment_methods where id=$1',[hosted])).rows[0].active,true);
  // The test-only Crypto route is explicitly enabled here; the production migration never creates one.
  await db.query("update commerce_gateway_accounts set countries=array['US','CA'] where method_id=$1",[payer]);
  const make=async({method=hosted,country='US',coupon='',cents=1999,secondCents=3001,points=0,credit=0,shipping='standard',qty=2,bulk=false}={})=>{
   const id=randomUUID(),user={id:randomUUID(),email:'fixture@example.test',email_confirmed_at:'2026-11-17'};
   const catalog=[{id:'a',name:'Compound A',variants:[{size:'5mg',price:cents/100}]},{id:'b',name:'Compound B',variants:[{size:'10mg',price:secondCents/100}]}];
   const body={id,kind:'goods',method_id:method,consent:true,research_use:true,checkout_version:config.version,coupon,points,credit_cents:credit,bulk_order:bulk,name:'Fixture Researcher',items:[{id:'a',size:'5mg',qty},{id:'b',size:'10mg',qty:1}],address:{line1:'123 Test Street',city:'Test City',region:'ON',postal_code:'N2L 1A1',country},delivery:{shipping,extras:['protection']}};
   const record=await checkout.normalize({},user,body,catalog),m={id:method,kind:method===bank?'bank_transfer':'hosted_link',native_provider:method===payer?'polygon_usdc':method===bank?null:'rampex',rampex_provider:method===stripe?'stripe':'hosted',sale_scope:'goods',version:method===hosted?2:1};
   const quote=checkout.price(record,m,null,{points:Math.max(1000,points),credit_cents:Math.max(1000,credit)});
   return {...record,...quote,checkout_version:config.version};
  };
  const place=payload=>db.query('select commerce_place_checkout($1::jsonb) result',[JSON.stringify(payload)]);
  // A coupon-only v6 Crypto order is created with the previous SQL contract.
  // Card's coupon amounts match that historical policy; only the route and
  // version metadata change to construct this known historical fixture.
  const savedV6=await make({coupon:'BLACKFRIDAY15'});
  savedV6.method_id=payer;savedV6.request.checkout.method_id=payer;savedV6.method_version=1;
  savedV6.checkout_version=savedV6.request.checkout.version=savedV6.pricing.checkout_version='checkout-2026-11-v6';
  savedV6.pricing.payment_discount_version='pure-payments-2026-11-v1';savedV6.pricing.crypto_discount_eligible=true;
  assert.equal((await place(savedV6)).rows[0].result.status,'accepted');
  const savedBefore=(await db.query('select to_jsonb(i) row from commerce_invoices i where id=$1',[savedV6.id])).rows[0].row;
  const routesBefore=(await db.query('select to_jsonb(m) row from commerce_payment_methods m order by id')).rows;
  await db.exec(read('20261117221328_pure_stack_crypto_discount.sql'));
  assert.deepEqual((await db.query('select to_jsonb(i) row from commerce_invoices i where id=$1',[savedV6.id])).rows[0].row,savedBefore,'Stacking never reprices an existing order');
  assert.deepEqual((await db.query('select to_jsonb(m) row from commerce_payment_methods m order by id')).rows,routesBefore,'Pricing migration does not change financial routes');
  const validate=payload=>db.query('select commerce_internal.validate_regular_checkout($1::jsonb)',[JSON.stringify(payload)]);
  await assert.rejects(validate(savedV6),/current regular product checkout/);
  for(const method of [hosted,payer])for(const country of ['US','CA'])for(const coupon of ['','BLACKFRIDAY15'])for(const cents of [1,9,19,21,1999,3001,9999]){
   const payload=await make({method,country,coupon,cents,shipping:country==='CA'?'next_day':'standard'});
   await validate(payload);
   assert.equal(payload.discount_cents,payload.pricing.lines.reduce((sum,line)=>sum+line.discount_cents,0));
   assert.equal(payload.pricing.coupon_discount_cents,coupon?Math.round(payload.subtotal_cents*.15):0);
   assert.equal(payload.pricing.crypto_discount_cents,method===payer?Math.round((payload.subtotal_cents-payload.pricing.coupon_discount_cents)*.05):0);
   assert.equal(payload.discount_cents,payload.pricing.coupon_discount_cents+payload.pricing.crypto_discount_cents);
  }
  for(const qty of [1,10,25,50])await validate(await make({method:payer,coupon:'BLACKFRIDAY15',qty,bulk:true}));
  for(const [cents,coupons,crypto] of [[10,[2,1],[0,1]],[100,[15,15],[5,4]]]){
   const rounded=await make({method:payer,coupon:'BLACKFRIDAY15',qty:1,cents,secondCents:cents});await validate(rounded);
   assert.deepEqual(rounded.pricing.lines.map(line=>line.coupon_discount_cents),coupons,'Coupon ties follow original line order');
   assert.deepEqual(rounded.pricing.lines.map(line=>line.crypto_discount_cents),crypto,'Crypto allocation uses post-coupon cents and original line order for ties');
  }
  const original=await make({method:payer});
  for(const change of [p=>p.discount_cents++,p=>p.pricing.crypto_discount_cents++,p=>p.pricing.coupon_discount_cents=1,
   p=>p.pricing.crypto_discount_eligible=false,p=>p.pricing.discount_source='coupon',p=>p.pricing.lines[0].crypto_discount_cents++,
   p=>p.pricing.lines[0].qty++,p=>p.shipping_cents--,p=>p.pricing.delivery.extras_cents=0,p=>p.checkout_version='checkout-2026-11-v6',
   p=>p.pricing.payment_discount_version='pure-payments-2026-11-v1']){
   const altered=structuredClone(original);change(altered);await assert.rejects(validate(altered));
  }
  const stacked=await make({method:payer,coupon:'BLACKFRIDAY15'});
  assert.equal(stacked.pricing.coupon_discount_cents,1050);assert.equal(stacked.pricing.crypto_discount_cents,297);
  for(const change of [p=>p.discount_cents=1400,p=>p.pricing.crypto_discount_cents=350,p=>p.pricing.discount_source='coupon',p=>p.pricing.lines[0].discount_bps=2000,p=>{p.pricing.lines[0].coupon_discount_cents--;p.pricing.lines[1].coupon_discount_cents++;},p=>{p.pricing.lines[0].crypto_discount_cents--;p.pricing.lines[1].crypto_discount_cents++;}]){
   const altered=structuredClone(stacked);change(altered);await assert.rejects(validate(altered));
  }
  for(const [credit,discount,total,suppressed] of [[500,350,8144,false],[8644,0,350,true],[8994,0,0,true]]){
   const balanceOrder=await make({method:payer,credit});await validate(balanceOrder);
   assert.equal(balanceOrder.discount_cents,discount);assert.equal(balanceOrder.total_cents,total);
   assert.equal(balanceOrder.pricing.crypto_discount_suppressed_for_balance,suppressed);
   if(suppressed){const altered=structuredClone(balanceOrder);altered.pricing.crypto_discount_suppressed_for_balance=false;await assert.rejects(validate(altered));}
  }
  for(const [credit,discount,total,suppressed] of [[500,1347,7147,false],[7647,1050,297,true],[7944,1050,0,true]]){
   const balanceOrder=await make({method:payer,coupon:'BLACKFRIDAY15',credit});await validate(balanceOrder);
   assert.equal(balanceOrder.discount_cents,discount);assert.equal(balanceOrder.total_cents,total);
   assert.equal(balanceOrder.pricing.coupon_discount_cents,1050);assert.equal(balanceOrder.pricing.crypto_discount_suppressed_for_balance,suppressed);
  }
  const pointsOrder=await make({method:payer,coupon:'BLACKFRIDAY15',cents:10000,points:18573,credit:500});
  await validate(pointsOrder);assert.equal(pointsOrder.pricing.crypto_discount_suppressed_for_balance,true);
  assert.equal(pointsOrder.pricing.coupon_discount_cents,3450);assert.equal(pointsOrder.total_cents,978);
  for(const method of [bank,stripe])await assert.rejects(validate(await make({method})),/Choose Card or Crypto|historical card route/);
  const placed=await make({method:payer,country:'CA',coupon:'BLACKFRIDAY15',points:100,credit:500});
  await db.query('insert into commerce_balance_accounts(customer_id,points,credit_cents) values($1,1000,1000)',[placed.customer_id]);
  assert.equal((await place(placed)).rows[0].result.status,'accepted');
  assert.equal((await place(placed)).rows[0].result.replayed,true);
  assert.deepEqual((await db.query('select points,credit_cents from commerce_balance_accounts where customer_id=$1',[placed.customer_id])).rows[0],{points:900,credit_cents:500});
  assert.equal((await db.query('select count(*)::int n from commerce_balance_events where invoice_id=$1',[placed.id])).rows[0].n,2);
  const wrongCountry=await make({country:'GB'});await assert.rejects(place(wrongCountry),/Live gateway scope unavailable/);
  // Exercise the saved-order transition for both pricing versions with actual
  // referral fixtures, preserving v6 commission basis and including v7 savings.
  await db.exec("create table commerce_partners(customer_id uuid primary key,status text);create table commerce_referrals(customer_id uuid primary key,partner_id uuid,first_invoice_id uuid);create table commerce_partner_commissions(invoice_id uuid primary key,partner_id uuid,basis_cents integer,rate_bps integer,amount_cents integer,status text default 'pending',eligible_at timestamptz);create trigger fixture_partner_transition after update of status on commerce_invoices for each row execute function commerce_internal.partner_order_transition();");
  const partner=randomUUID();await db.query("insert into commerce_partners values($1,'active')",[partner]);
  for(const order of [savedV6,placed]){
   await db.query('insert into commerce_referrals values($1,$2,$3)',[order.customer_id,partner,order.id]);
   const paid={id:order.id,version:1,receipt_id:randomUUID(),external_reference:'FIXTURE-'+order.id,amount_cents:order.total_cents,currency:'USD',funds_confirmed:true};
   await db.query("select commerce_admin_command('record_payment',$1::jsonb,'isolated-fixture-admin')",[JSON.stringify(paid)]);
   const basis=order.subtotal_cents-order.discount_cents-order.points_redeemed-order.credit_redeemed_cents;
   assert.deepEqual((await db.query('select basis_cents,rate_bps,amount_cents from commerce_partner_commissions where invoice_id=$1',[order.id])).rows[0],{basis_cents:basis,rate_bps:2000,amount_cents:Math.floor(basis*.2)});
   assert.deepEqual((await db.query('select pricing,total_cents from commerce_invoices where id=$1',[order.id])).rows[0],{pricing:order.pricing,total_cents:order.total_cents});
  }
  const receipt={id:oldOrder,version:1,receipt_id:randomUUID(),external_reference:'HISTORICAL-FIXTURE-RECEIPT',amount_cents:10000,currency:'USD',funds_confirmed:true};
  await db.query("select commerce_admin_command('record_payment',$1::jsonb,'isolated-fixture-admin')",[JSON.stringify(receipt)]);
  assert.equal((await db.query('select status from commerce_invoices where id=$1',[oldOrder])).rows[0].status,'paid');
  assert.deepEqual((await db.query("select has_function_privilege('anon','public.commerce_place_checkout(jsonb)','EXECUTE') anon,has_function_privilege('authenticated','public.commerce_place_checkout(jsonb)','EXECUTE') customer,has_function_privilege('service_role','public.commerce_place_checkout(jsonb)','EXECUTE') backend")).rows[0],{anon:false,customer:false,backend:true});
 }finally{await db.close();}
});
