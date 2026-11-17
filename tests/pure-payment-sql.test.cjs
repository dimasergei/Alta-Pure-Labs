'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{randomUUID}=require('node:crypto');
const checkout=require('../lib/direct-checkout'),config=require('../config/checkout.json'),delivery=require('../lib/delivery-options');
let PGlite;try{({PGlite}=require('@electric-sql/pglite'));}catch{}
const read=name=>fs.readFileSync('supabase/migrations/'+name,'utf8');
const hosted='1efcda11-7310-4c45-b6bb-3cfdd8873784',payer=randomUUID(),stripe=randomUUID(),bank=randomUUID();

test('isolated PostgreSQL enforces v6 discounts, destination and method retirement while preserving history',{skip:!PGlite,timeout:60000},async()=>{
 const db=new PGlite();
 try{
  await db.exec('create role anon;create role authenticated;create role service_role;create schema commerce_internal;');
  await db.exec(read('20261110040926_manual_invoice_commerce.sql'));
  await db.exec("alter table commerce_payment_methods add column native_provider text,add column sale_scope text default 'goods',add column display_order integer default 1;create table commerce_gateway_accounts(method_id uuid primary key,provider text,mode text,account_tag text,countries text[],rampex_provider text);create table commerce_delivery_options(id text primary key,kind text,label text,price_cents integer,enabled boolean,description text);");
  await db.exec(read('20261111025932_direct_checkout_balances.sql'));
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
  const make=async({method=hosted,country='US',coupon='',cents=1999,points=0,credit=0,shipping='standard'}={})=>{
   const id=randomUUID(),user={id:randomUUID(),email:'fixture@example.test',email_confirmed_at:'2026-11-17'};
   const catalog=[{id:'a',name:'Compound A',variants:[{size:'5mg',price:cents/100}]},{id:'b',name:'Compound B',variants:[{size:'10mg',price:30.01}]}];
   const body={id,kind:'goods',method_id:method,consent:true,research_use:true,checkout_version:config.version,coupon,points,credit_cents:credit,name:'Fixture Researcher',items:[{id:'a',size:'5mg',qty:2},{id:'b',size:'10mg',qty:1}],address:{line1:'123 Test Street',city:'Test City',region:'ON',postal_code:'N2L 1A1',country},delivery:{shipping,extras:['protection']}};
   const record=await checkout.normalize({},user,body,catalog),m={id:method,kind:method===bank?'bank_transfer':'hosted_link',native_provider:method===payer?'polygon_usdc':method===bank?null:'rampex',rampex_provider:method===stripe?'stripe':'hosted',sale_scope:'goods',version:method===hosted?2:1};
   const quote=checkout.price(record,m,null,{points:Math.max(1000,points),credit_cents:Math.max(1000,credit)});
   return {...record,...quote,checkout_version:config.version};
  };
  const validate=payload=>db.query('select commerce_internal.validate_regular_checkout($1::jsonb)',[JSON.stringify(payload)]);
  for(const method of [hosted,payer])for(const country of ['US','CA'])for(const coupon of ['','BLACKFRIDAY15'])for(const cents of [1,9,19,21,1999,3001,9999]){
   const payload=await make({method,country,coupon,cents,shipping:country==='CA'?'next_day':'standard'});
   await validate(payload);
   assert.equal(payload.discount_cents,payload.pricing.lines.reduce((sum,line)=>sum+line.discount_cents,0));
  }
  const original=await make({method:payer});
  for(const change of [p=>p.discount_cents++,p=>p.pricing.crypto_discount_cents++,p=>p.pricing.coupon_discount_cents=1,
   p=>p.pricing.crypto_discount_eligible=false,p=>p.pricing.discount_source='coupon',p=>p.pricing.lines[0].crypto_discount_cents++,
   p=>p.pricing.lines[0].qty++,p=>p.shipping_cents--,p=>p.pricing.delivery.extras_cents=0,p=>p.checkout_version='checkout-2026-11-v5']){
   const altered=structuredClone(original);change(altered);await assert.rejects(validate(altered));
  }
  const stacked=await make({method:payer,coupon:'BLACKFRIDAY15'});stacked.discount_cents+=Math.round(stacked.subtotal_cents*.05);
  await assert.rejects(validate(stacked));
  for(const [credit,discount,total,suppressed] of [[500,350,8144,false],[8644,0,350,true],[8994,0,0,true]]){
   const balanceOrder=await make({method:payer,credit});await validate(balanceOrder);
   assert.equal(balanceOrder.discount_cents,discount);assert.equal(balanceOrder.total_cents,total);
   assert.equal(balanceOrder.pricing.crypto_discount_suppressed_for_balance,suppressed);
   if(suppressed){const altered=structuredClone(balanceOrder);altered.pricing.crypto_discount_suppressed_for_balance=false;await assert.rejects(validate(altered));}
  }
  for(const method of [bank,stripe])await assert.rejects(validate(await make({method})),/Choose Card or Crypto|historical card route/);
  const placed=await make({method:payer,country:'CA',coupon:'BLACKFRIDAY15',points:100,credit:500});
  await db.query('insert into commerce_balance_accounts(customer_id,points,credit_cents) values($1,1000,1000)',[placed.customer_id]);
  const place=payload=>db.query('select commerce_place_checkout($1::jsonb) result',[JSON.stringify(payload)]);
  assert.equal((await place(placed)).rows[0].result.status,'accepted');
  assert.equal((await place(placed)).rows[0].result.replayed,true);
  assert.deepEqual((await db.query('select points,credit_cents from commerce_balance_accounts where customer_id=$1',[placed.customer_id])).rows[0],{points:900,credit_cents:500});
  assert.equal((await db.query('select count(*)::int n from commerce_balance_events where invoice_id=$1',[placed.id])).rows[0].n,2);
  const wrongCountry=await make({country:'GB'});await assert.rejects(place(wrongCountry),/Live gateway scope unavailable/);
  const receipt={id:oldOrder,version:1,receipt_id:randomUUID(),external_reference:'HISTORICAL-FIXTURE-RECEIPT',amount_cents:10000,currency:'USD',funds_confirmed:true};
  await db.query("select commerce_admin_command('record_payment',$1::jsonb,'isolated-fixture-admin')",[JSON.stringify(receipt)]);
  assert.equal((await db.query('select status from commerce_invoices where id=$1',[oldOrder])).rows[0].status,'paid');
  assert.deepEqual((await db.query("select has_function_privilege('anon','public.commerce_place_checkout(jsonb)','EXECUTE') anon,has_function_privilege('authenticated','public.commerce_place_checkout(jsonb)','EXECUTE') customer,has_function_privilege('service_role','public.commerce_place_checkout(jsonb)','EXECUTE') backend")).rows[0],{anon:false,customer:false,backend:true});
 }finally{await db.close();}
});
