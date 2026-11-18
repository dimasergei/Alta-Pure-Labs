'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const checkout=require('../lib/direct-checkout'),manual=require('../lib/manual-commerce'),config=require('../config/checkout.json');
let PGlite;try{({PGlite}=require('@electric-sql/pglite'));}catch{}
const read=name=>fs.readFileSync(path.join(__dirname,'../supabase/migrations',name),'utf8');

test('isolated PostgreSQL preserves CAD Interac request, review, acceptance and one verified bank receipt',{skip:!PGlite,timeout:60000},async()=>{
 const db=new PGlite(),methodId=randomUUID(),uid=randomUUID();
 const row=async(table,id)=>(await db.query('select * from '+table+' where id=$1',[id])).rows[0];
 const rpc=async(name,args)=>(await db.query('select '+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') result',args)).rows[0].result;
 const facade={from(table){let id;const q={select(){return q;},eq(key,value){assert.equal(key,'id');id=value;return q;},async single(){return{data:await row(table,id)};}};return q;}};
 const saveMethod=(data)=>rpc('commerce_provider_command',['save_method',JSON.stringify(data),'isolated-interac-test']);
 try{
  await db.exec('create role anon;create role authenticated;create role service_role;create schema commerce_internal;');
  await db.exec(read('20261110040926_manual_invoice_commerce.sql'));
  await db.exec(read('20261110074742_payment_provider_options.sql'));
  await db.exec('alter table commerce_payment_methods add column native_provider text;');
  await db.exec(read('20261111025932_direct_checkout_balances.sql'));
  const supplier=read('20261111174353_partner_settings_supplier_queue.sql');
  await db.exec(supplier.slice(supplier.indexOf('create table public.commerce_supplier_settings'),supplier.indexOf('create table public.commerce_delivery_options')));
  await db.exec(read('20261111195957_unified_supplier_fulfillment.sql'));
  await db.exec(read('20261111210000_single_supplier_per_order.sql'));
  await db.exec(read('20261116140000_unified_order_management.sql'));
  // Exercise the current goods-only request and acceptance definitions without
  // installing unrelated historical subscription or gateway fixture tables.
  const regular=read('20261117084413_pure_storefront_regular_pricing.sql');
  for(const name of ['commerce_request_invoice','commerce_accept_invoice']){
   const start=regular.indexOf('CREATE OR REPLACE FUNCTION public.'+name+'(');
   const end=regular.indexOf('to service_role;',start)+'to service_role;'.length;
   assert.ok(start>=0&&end>start);await db.exec(regular.slice(start,end));
  }
  const receiving={id:methodId,version:0,kind:'interac',provider_key:'interac',label:'Interac e-Transfer',currency:'CAD',
   payee:'Isolated fixture business',instructions:'Fixture only: receiving@example.test. Autodeposit enabled.',
   acceptance_reference:'Disposable fixture; no real payment account.',active:true,display_order:30,sale_scope:'goods',
   business_confirmed:true,catalog_accepted:true};
  await assert.rejects(saveMethod({...receiving,catalog_accepted:false}),/Verified business/);
  await saveMethod(receiving);
  await assert.rejects(saveMethod(receiving),/Method changed/);
  assert.equal((await row('commerce_payment_methods',methodId)).active,true);
  await db.query('insert into commerce_balance_accounts(customer_id,points,credit_cents) values($1,1500,5000)',[uid]);
  const balanceBefore=(await db.query('select * from commerce_balance_accounts where customer_id=$1',[uid])).rows[0];
  const catalog=[{id:'a',name:'Fixture A',variants:[{size:'5mg',price:19.99}]},{id:'b',name:'Fixture B',variants:[{size:'10mg',price:30.01}]}];
  async function request(){
   const record=await checkout.normalize({}, {id:uid,email:'fixture@example.test'},{
    id:randomUUID(),kind:'goods',name:'Fixture researcher',method_id:methodId,checkout_version:config.version,consent:true,research_use:true,
    coupon:'BLACKFRIDAY15',items:[{id:'a',size:'5mg',qty:2},{id:'b',size:'10mg',qty:1}],
    address:{line1:'123 Fixture Street',city:'Fixture City',region:'ON',postal_code:'N2L 1A1',country:'CA'},
    delivery:{shipping:'standard',extras:[]}
   },catalog);
   record.request.preferred_payment={method_id:methodId,provider_key:'interac',label:'Interac e-Transfer',currency:'CAD'};
   delete record.digest;record.digest=createHash('sha256').update(JSON.stringify(record)).digest('hex');
   const created=await rpc('commerce_request_invoice',[JSON.stringify(record)]);
   assert.equal(created.status,'requested');assert.equal(created.created,true);
   assert.equal((await rpc('commerce_request_invoice',[JSON.stringify(record)])).created,false);
   await assert.rejects(rpc('commerce_request_invoice',[JSON.stringify({...record,digest:'b'.repeat(64)})]),/Request ID conflict/);
   return record;
  }
  const record=await request(),pending=await row('commerce_invoices',record.id);
  assert.equal(pending.total_cents,null);assert.equal(pending.currency,null);assert.equal(pending.payment_snapshot,null);
  assert.equal(pending.checkout_version,null);assert.equal(pending.request_data.checkout.coupon,'BLACKFRIDAY15');
  assert.equal((await db.query('select count(*)::int n from commerce_receipts')).rows[0].n,0);
  const review={
   id:record.id,version:1,method_id:methodId,expected_method_version:1,action:'preview',fx_ppm:1375000,shipping_cents:1250,
   review_note:'Isolated fixture: fixed CAD total, delivery and tax reviewed.',fulfillment_confirmed:true,
   delivery_tax:{confirmed:true,seller_name:'Fixture corporation',destination_country:'CA',destination_region:'ON',
    tax_mode:'canada_taxable_goods',canada_supply_confirmed:true,gst_hst_number:'123456789RT0001',shipping_taxable:true,
    tax_basis:'Isolated taxable goods fixture; not a real tax determination.',jurisdictions_reviewed:true,components:[],
    delivery:{origin_country:'CA',origin_region:'ON',carrier:'Fixture carrier',service:'Ground',handling_max_days:1,
     transit_min_days:2,transit_max_days:4,duties:'domestic',quote_reference:'FIXTURE-SHIPPING-ONLY',
     quote_expires_at:new Date(Date.now()+3600000).toISOString(),route_review:'Fixture destination and delivery reviewed.'}}
  };
  const quote=await manual.issueInvoice(facade,review);
  assert.equal(quote.currency,'CAD');assert.equal(quote.subtotal_cents,9624);
  assert.equal(quote.discount_cents,1444);assert.equal(quote.pricing.coupon_code,'BLACKFRIDAY15');
  assert.equal(quote.tax_cents,1226);assert.equal(quote.total_cents,10656);
  assert.equal((await row('commerce_invoices',record.id)).status,'requested','Preview is read-only');
  const accept=(id=record.id,customer=uid,version=2,terms='launch-2026-11-v1')=>rpc('commerce_accept_invoice',[id,customer,version,terms]);
  const receipt={method_id:methodId,expected_version:3,receipt_id:randomUUID(),external_reference:'FIXTURE-BANK-'+randomUUID(),confirm_funds_received:true};
  const pay=(id=record.id,payload=receipt)=>rpc('commerce_admin_record_bank_payment',[id,JSON.stringify(payload)]);
  await assert.rejects(accept(),/changed, expired/);
  await assert.rejects(pay(),/Manual bank/);
  const issuePayload={...await manual.issueInvoice(facade,{...review,action:'issue',expected_total_cents:quote.total_cents}),method_version:1};
  const issue=(payload=issuePayload)=>rpc('commerce_provider_command',['issue',JSON.stringify(payload),'isolated-interac-test']);
  await assert.rejects(issue({...issuePayload,method_version:2}),/Method changed/);
  await issue();
  const issued=await row('commerce_invoices',record.id);
  assert.equal(issued.currency,'CAD');assert.equal(issued.status,'issued');assert.equal(issued.version,2);
  assert.equal(issued.payment_snapshot.kind,'interac');assert.equal(issued.total_cents,10656);
  await assert.rejects(pay(),/Order changed/);
  await assert.rejects(accept(record.id,randomUUID()),/Invoice not found/);
  await assert.rejects(accept(record.id,uid,1),/changed, expired/);
  await assert.rejects(accept(record.id,uid,2,'forged-terms'),/changed, expired/);
  await rpc('commerce_provider_command',['pause_method',JSON.stringify({id:methodId,version:1}),'isolated-interac-test']);
  await assert.rejects(accept(),/changed, expired/);
  await saveMethod({...receiving,version:2});
  assert.equal((await accept()).status,'accepted');
  assert.equal((await accept()).status,'accepted','Acceptance retry is idempotent');
  assert.equal((await row('commerce_invoices',record.id)).version,3);
  assert.equal((await db.query('select count(*)::int n from commerce_receipts')).rows[0].n,0,'Customer acceptance never records payment');
  await assert.rejects(pay(record.id,{...receipt,confirm_funds_received:false}),/Received funds/);
  await assert.rejects(pay(record.id,{...receipt,method_id:randomUUID()}),/Manual bank/);
  await assert.rejects(pay(record.id,{...receipt,expected_version:2}),/Order changed/);
  assert.equal((await pay()).status,'paid');
  assert.equal((await pay()).replayed,true);
  const stored=(await db.query('select amount_cents,currency,external_reference from commerce_receipts where invoice_id=$1',[record.id])).rows;
  assert.deepEqual(stored,[{amount_cents:10656,currency:'CAD',external_reference:receipt.external_reference}]);
  await assert.rejects(pay(record.id,{...receipt,external_reference:'FIXTURE-DIFFERENT-TRANSFER'}),/Receipt replay conflict/);
  assert.deepEqual((await db.query('select * from commerce_balance_accounts where customer_id=$1',[uid])).rows[0],balanceBefore);
  assert.equal((await db.query('select count(*)::int n from commerce_balance_events')).rows[0].n,0);
  assert.equal((await row('commerce_invoices',record.id)).pricing.fx_ppm,1375000);
  const allocations=(await db.query('select status from commerce_fulfillment_items where invoice_id=$1',[record.id])).rows;
  assert.equal(allocations.length,2);assert.ok(allocations.every(a=>a.status==='pending'),'Verified funds allow fulfillment without inventing shipment');
  for(const fn of ['commerce_request_invoice(jsonb)','commerce_accept_invoice(uuid,uuid,integer,text)','commerce_provider_command(text,jsonb,text)','commerce_admin_record_bank_payment(uuid,jsonb)']){
   const permissions=(await db.query("select has_function_privilege('anon',$1,'EXECUTE') anon,has_function_privilege('authenticated',$1,'EXECUTE') customer,has_function_privilege('service_role',$1,'EXECUTE') backend",['public.'+fn])).rows[0];
   assert.deepEqual(permissions,{anon:false,customer:false,backend:true});
  }
 }finally{await db.close();}
});
