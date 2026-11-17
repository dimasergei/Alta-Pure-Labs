'use strict';
// Local PostgreSQL verification. Supply PGLITE_MODULE if PGlite is outside node_modules.
// The companion SQL file is also runnable by psql after the migration and rolls back.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const checkout=require('../lib/direct-checkout'),config=require('../config/checkout.json');
const delivery=require('../lib/delivery-options');
const root=path.join(__dirname,'..'),sqlFile=name=>fs.readFileSync(path.join(root,'supabase/migrations',name),'utf8');
const migration='20261117084413_pure_storefront_regular_pricing.sql';
const uid='f5000000-0000-4000-8000-000000000001',mid='f5000000-0000-4000-8000-000000000002',historical='f5000000-0000-4000-8000-000000000003',subscription='f5000000-0000-4000-8000-000000000004';
const method={id:mid,kind:'bank_transfer',active:true,currency:'USD',sale_scope:'both',version:1,label:'Fixture bank'};
const user={id:uid,email:'fixture@example.test'};
const catalog=[{id:'a',name:'A',variants:[{size:'5mg',price:19.99},{size:'10mg',price:30.01}]},{id:'b',name:'B',variants:[{size:'5mg',price:100}]}];
async function payload(extra={},cat=catalog){
 const record=await checkout.normalize({},user,{id:randomUUID(),kind:'goods',method_id:mid,consent:true,checkout_version:config.version,items:[{id:'b',size:'5mg',qty:2}],name:'Fixture',address:{line1:'123 Test Street',city:'Test City',region:'NY',postal_code:'10001',country:'US'},research_use:true,...extra},cat);
 return {...record,...checkout.price(record,method,null,{points:5000,credit_cents:50000}),checkout_version:config.version};
}
async function main(){
 const db=new PGlite();let assertions=0;
 async function expectReject(p,label){await assert.rejects(db.query('select public.commerce_place_checkout($1::jsonb)',[JSON.stringify(p)]),e=>['22023','P0001','23514','40001'].includes(e.code),label);assertions++;}
 try{
  await db.exec('create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create schema commerce_internal;');
  for(const file of ['20261110040926_manual_invoice_commerce.sql','20261110074742_payment_provider_options.sql','20261110164316_native_gateway_checkout.sql','20261111025932_direct_checkout_balances.sql','20261113030240_safe_checkout_cancellation.sql','20261111163930_conversion_memberships_partners.sql','20261115090000_research_subscriptions.sql'])await db.exec(sqlFile(file));
  await db.exec(sqlFile('20261113030240_safe_checkout_cancellation.sql'));
  await db.exec(`create table public.commerce_delivery_options(id text primary key,kind text,label text,price_cents integer,enabled boolean,description text);
   create table public.commerce_fulfillment_items(invoice_id uuid,variant_key text,item jsonb,route text,supplier_name text,product text,vials text,note text,primary key(invoice_id,variant_key));
   create table public.commerce_supplier_jobs(invoice_id uuid primary key);`);
  await db.exec('create table public.commerce_partner_codes(code text primary key,partner_id uuid references public.commerce_partners(customer_id));');
  const partnerMigration=sqlFile('20261111174353_partner_settings_supplier_queue.sql');
  await db.exec(partnerMigration.slice(partnerMigration.indexOf('create or replace function commerce_internal.validate_referral'),partnerMigration.indexOf('-- Integration starts disabled')));
  for(const d of delivery.defaults)await db.query('insert into public.commerce_delivery_options values($1,$2,$3,$4,$5,$6)',[d.id,d.kind,d.label,d.price_cents,d.enabled,d.description]);
  await db.query("insert into public.commerce_payment_methods(id,kind,label,currency,payee,instructions,acceptance_reference,active,provider_key,sale_scope) values($1,'bank_transfer','Fixture bank','USD','Fixture','Disposable test instructions','Disposable fixture',true,'bank_transfer','both')",[mid]);
  await db.query('insert into public.commerce_balance_accounts values($1,5000,50000)',[uid]);
  await db.query("insert into public.commerce_invoices(id,customer_id,customer_email,customer_name,kind,plan,request_digest,request_data,status,currency,subtotal_cents,discount_cents,shipping_cents,tax_cents,total_cents,method_id) values($1,$2,'fixture@example.test','Historical fixture','membership','elite',repeat('a',64),'{\"items\":[]}', 'paid','USD',9999,0,0,0,9999,$3)",[historical,uid,mid]);
  await db.query("insert into public.commerce_memberships(invoice_id,customer_id,plan,starts_at,expires_at) values($1,$2,'elite','2020-01-01','2099-01-01')",[historical,uid]);
  await db.query('insert into auth.users values($1)',[uid]);
  await db.query("insert into public.research_subscriptions(id,customer_id,customer_email,status,lines,shipping_address,retail_cents,discount_cents,monthly_cents) values($1,$2,'fixture@example.test','active','[]','{}',10000,0,10000)",[subscription,uid]);
  await db.query("insert into public.research_subscription_cycles(subscription_id,cycle_number,provider_transaction_id,amount_cents,status,paid_at) values($1,1,'historical-test-tx',10000,'paid','2026-01-01')",[subscription]);
  const historyQuery="select jsonb_build_object('orders',(select jsonb_agg(to_jsonb(t)) from public.commerce_invoices t),'memberships',(select jsonb_agg(to_jsonb(t)) from public.commerce_memberships t),'subscriptions',(select jsonb_agg(to_jsonb(t)) from public.research_subscriptions t),'cycles',(select jsonb_agg(to_jsonb(t)) from public.research_subscription_cycles t),'balances',(select jsonb_agg(to_jsonb(t)) from public.commerce_balance_accounts t)) as snapshot";
  const before=(await db.query(historyQuery)).rows[0].snapshot;
  await db.exec(sqlFile(migration));
  assert.deepEqual((await db.query(historyQuery)).rows[0].snapshot,before,'Migration must not rewrite history or balances');assertions++;
  const manual=sqlFile('20261116150000_purity_manual_fulfillment.sql');
  await db.exec(manual.slice(manual.indexOf('create or replace function commerce_internal.lotus_enqueue()'),manual.indexOf('-- Defense in depth')));
  await db.exec('create trigger commerce_lotus_enqueue after update of status on public.commerce_invoices for each row execute function commerce_internal.lotus_enqueue();create trigger commerce_platinum_monthly_reward after update of status on public.commerce_invoices for each row execute function commerce_internal.platinum_monthly_reward();');
  const fixture=await db.exec(fs.readFileSync(path.join(__dirname,'fixtures/storefront-reset-checks.sql'),'utf8'));
  assert.ok(fixture.some(r=>r.rows?.some(x=>x.result==='storefront_reset_checks_passed')));assertions++;
  assert.deepEqual((await db.query(historyQuery)).rows[0].snapshot,before,'Rollback fixture must leave existing records untouched');assertions++;
  const variations=[{}, {coupon:'blackfriday15'}, {coupon:'BLACKFRIDAY15',items:[{id:'a',size:'5mg',qty:2},{id:'a',size:'10mg',qty:1}]},
   {coupon:'BLACKFRIDAY15',items:[{id:'a',size:'5mg',qty:1},{id:'a',size:'10mg',qty:1}]},
   {bulk_order:true,items:[{id:'b',size:'5mg',qty:1}]}, {bulk_order:true,items:[{id:'b',size:'5mg',qty:50}],coupon:'BLACKFRIDAY15'},
   {coupon:'BLACKFRIDAY15',points:500,credit_cents:1000},
   {coupon:'BLACKFRIDAY15',delivery:{shipping:'express',extras:['protection','priority']}},
   {address:{line1:'123 Test Street',city:'Test City',region:'ON',postal_code:'A1A1A1',country:'CA'},delivery:{shipping:'standard',extras:['protection']}},
   {address:{line1:'123 Test Street',city:'Test City',region:'London',postal_code:'SW1A1AA',country:'GB'},delivery:{shipping:'express',extras:[]}}];
  for(const extra of variations){
   await db.exec('begin');const p=await payload(extra);
   await db.query('select public.commerce_place_checkout($1::jsonb)',[JSON.stringify(p)]);
   const order=(await db.query('select * from public.commerce_invoices where id=$1',[p.id])).rows[0];
   assert.deepEqual(order.pricing,p.pricing);assert.deepEqual(order.request_data.items,p.request.items);
   for(const k of ['subtotal_cents','discount_cents','shipping_cents','total_cents','earned_points','points_redeemed','credit_redeemed_cents'])assert.equal(order[k],p[k],k);
   assert.equal(order.discount_cents,extra.coupon?Math.round(order.subtotal_cents*1500/10000):0);
   assertions++;await db.exec('rollback');
  }
  // An already-active legacy member gets no new monthly credit, gift or points.
  await db.exec('begin');let p=await payload({coupon:'BLACKFRIDAY15',credit_cents:17000});
  await db.query('select public.commerce_place_checkout($1::jsonb)',[JSON.stringify(p)]);
  const rows=(await db.query('select item from public.commerce_fulfillment_items where invoice_id=$1',[p.id])).rows;
  assert.equal(rows.length,1);assert.equal(rows[0].item.qty,2);assert.equal(rows[0].item.membership_gift,undefined);
  const bal=(await db.query('select points,credit_cents from public.commerce_balance_accounts where customer_id=$1',[uid])).rows[0];
  assert.deepEqual(bal,{points:5000,credit_cents:33000});assertions++;await db.exec('rollback');
  // Same quote must reject stale optional charges and delivery availability.
  p=await payload({delivery:{shipping:'standard',extras:['protection']}});
  await db.exec('begin');await db.exec("update public.commerce_delivery_options set price_cents=501 where id='protection'");await expectReject(p,'stale protection charge');await db.exec('rollback');
  await db.exec('begin');await db.exec("update public.commerce_delivery_options set enabled=false where id='standard'");await expectReject(await payload(),'unavailable delivery');await db.exec('rollback');
  // Changing a rounding cent while preserving the order discount must fail.
  p=await payload({coupon:'BLACKFRIDAY15',items:[{id:'a',size:'5mg',qty:2},{id:'a',size:'10mg',qty:1}]});
  p.pricing.lines[0].discount_cents--;p.pricing.lines[0].coupon_discount_cents--;p.pricing.lines[0].line_total_cents++;
  p.pricing.lines[1].discount_cents++;p.pricing.lines[1].coupon_discount_cents++;p.pricing.lines[1].line_total_cents--;
  await expectReject(p,'altered penny allocation');
  // Partner commission attribution remains, with no additional customer discount.
  await db.exec('begin');const partnerId=randomUUID();
  await db.query("insert into public.commerce_partners(customer_id,code,terms_version) values($1,'AP-ABCDEFGH2345','partner-2026-11-v1')",[partnerId]);
  await db.query("insert into public.commerce_partner_codes(code,partner_id) values('AP-ABCDEFGH2345',$1)",[partnerId]);
  p=await payload({coupon:'BLACKFRIDAY15'});p.pricing.referral={partner_id:partnerId,code:'AP-ABCDEFGH2345',first_order:true};
  await db.query('select public.commerce_place_checkout($1::jsonb)',[JSON.stringify(p)]);
  await db.query("update public.commerce_invoices set status='paid',paid_at=now() where id=$1",[p.id]);
  let commission=(await db.query('select basis_cents,rate_bps,amount_cents,status from public.commerce_partner_commissions where invoice_id=$1',[p.id])).rows[0];
  assert.deepEqual(commission,{basis_cents:17000,rate_bps:2000,amount_cents:3400,status:'pending'});
  assert.equal((await db.query('select total_cents from public.commerce_invoices where id=$1',[p.id])).rows[0].total_cents,17000);
  const repeat=await payload();repeat.pricing.referral={partner_id:partnerId,code:'AP-ABCDEFGH2345',first_order:false};
  await db.query('select public.commerce_place_checkout($1::jsonb)',[JSON.stringify(repeat)]);
  await db.query("update public.commerce_invoices set status='paid',paid_at=now() where id=$1",[repeat.id]);
  commission=(await db.query('select rate_bps,amount_cents from public.commerce_partner_commissions where invoice_id=$1',[repeat.id])).rows[0];
  assert.deepEqual(commission,{rate_bps:1000,amount_cents:2000});
  await db.query("update public.commerce_invoices set status='refunded' where id=$1",[p.id]);
  assert.equal((await db.query('select status from public.commerce_partner_commissions where invoice_id=$1',[p.id])).rows[0].status,'reversed');
  await db.exec('rollback');assertions++;
  // Old membership payment and entitlement endpoints fail while history is kept.
  await assert.rejects(db.query('select public.commerce_begin_gateway_attempt($1,$2,$3,$4,$5)',[randomUUID(),historical,uid,'sale','c'.repeat(64)]),e=>e.code==='P0001'&&/Membership payments are unavailable/.test(e.message));
  await assert.rejects(db.query("select public.commerce_accept_invoice($1,$2,1,'launch-2026-11-v1')",[historical,uid]),e=>e.code==='P0001'&&/Membership purchases are unavailable/.test(e.message));
  await assert.rejects(db.query("update public.commerce_memberships set expires_at='2100-01-01' where invoice_id=$1",[historical]),e=>e.code==='P0001');
  await assert.rejects(db.query('update public.research_subscriptions set paid_cycles=paid_cycles+1 where id=$1',[subscription]),e=>e.code==='P0001');
  await db.exec('begin');await db.query('update public.commerce_memberships set revoked_at=now() where invoice_id=$1',[historical]);await db.query("update public.research_subscriptions set status='canceled',next_billing_at=null,canceled_at=now() where id=$1",[subscription]);await db.query("update public.research_subscription_cycles set status='refunded' where subscription_id=$1",[subscription]);await db.exec('rollback');assertions++;
  // The same RPC still permits a verified refund against a historical membership sale.
  await db.exec('begin');const saleId=randomUUID(),refundId=randomUUID(),tag='c'.repeat(64);
  await db.query("update public.commerce_payment_methods set kind='hosted_link',native_provider='nmi' where id=$1",[mid]);
  await db.query("insert into public.commerce_gateway_accounts(method_id,provider,mode,account_tag,countries) values($1,'nmi','live',$2,array['US'])",[mid,tag]);
  await db.query("insert into public.commerce_gateway_attempts(id,invoice_id,method_id,provider,mode,account_tag,operation,amount_cents,currency,state,provider_transaction_id) values($1,$2,$3,'nmi','live',$4,'sale',9999,'USD','paid','historical-sale')",[saleId,historical,mid,tag]);
  const refund=(await db.query('select public.commerce_begin_gateway_attempt($1,$2,$3,$4,$5) as result',[refundId,historical,uid,'refund',tag])).rows[0].result;
  assert.equal(refund.claimed,true);assert.equal(refund.amount_cents,9999);assert.equal(refund.operation,'refund');assertions++;
  await db.exec('rollback');
  assert.deepEqual((await db.query(historyQuery)).rows[0].snapshot,before);assertions++;
  console.log(`Storefront reset SQL passed: ${assertions} integration groups plus rollback-only RPC/balance/security fixture.`);
 }finally{await db.close();}
}
main().catch(e=>{console.error(e.message);if(e.where)console.error(e.where);if(e.detail)console.error(e.detail);process.exitCode=1;});
