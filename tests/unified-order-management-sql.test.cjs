'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
let PGlite;try{({PGlite}=require('@electric-sql/pglite'));}catch{}
const read=name=>fs.readFileSync(path.join(__dirname,'../supabase/migrations',name),'utf8');
test('isolated PostgreSQL validates bank receipt replay and atomic fulfillment lifecycle',{skip:!PGlite,timeout:60000},async()=>{
 const db=new PGlite();
 try{
  await db.exec('create role anon;create role authenticated;create role service_role;create schema commerce_internal;');
  await db.exec(read('20261110040926_manual_invoice_commerce.sql'));
  await db.exec('alter table commerce_payment_methods add column native_provider text;');
  const supplier=read('20261111174353_partner_settings_supplier_queue.sql');
  await db.exec(supplier.slice(supplier.indexOf('create table public.commerce_supplier_settings'),supplier.indexOf('create table public.commerce_delivery_options')));
  await db.exec(read('20261111195957_unified_supplier_fulfillment.sql'));
  await db.exec(read('20261111210000_single_supplier_per_order.sql'));
  await db.exec(read('20261116140000_unified_order_management.sql'));
  const methodId=randomUUID();
  await db.query("insert into commerce_payment_methods(id,kind,label,currency,payee,instructions,acceptance_reference,active) values($1,'bank_transfer','Fixture wire','USD','Fixture business','Fixture bank instructions','Fixture bank acceptance',true)",[methodId]);
  const makeOrder=async({lotus=false,status='accepted'}={})=>{
   const id=randomUUID();await db.query("insert into commerce_invoices(id,customer_id,customer_email,customer_name,kind,request_digest,request_data,status,method_id,payment_snapshot,currency,subtotal_cents,discount_cents,shipping_cents,tax_cents,total_cents) values($1,$2,'fixture@example.test','Fixture','goods',$3,$4,$5,$6,'{\"kind\":\"bank_transfer\"}','USD',10000,0,0,0,10000)",[id,randomUUID(),'a'.repeat(64),JSON.stringify({address:{country:lotus?'US':'CA'},items:[{id:'a',size:'10mg',qty:2},{id:'b',size:'5mg',qty:1}]}),status,methodId]);return id;
  };
  const payBody=()=>({method_id:methodId,expected_version:1,receipt_id:randomUUID(),external_reference:'BANK-'+randomUUID(),confirm_funds_received:true});
  const pay=async(id,payload)=>(await db.query('select commerce_admin_record_bank_payment($1,$2) result',[id,JSON.stringify(payload)])).rows[0].result;
  const fulfill=async(id,payload)=>(await db.query('select commerce_admin_fulfill_order($1,$2) result',[id,JSON.stringify(payload)])).rows[0].result;
  const load=async(id)=>(await db.query('select * from commerce_invoices where id=$1',[id])).rows[0];
  const allocations=async(id)=>(await db.query('select * from commerce_fulfillment_items where invoice_id=$1 order by variant_key',[id])).rows;
  const update=(version,status)=>({action:'update_order',version,status,note:'Fixture verified supplier update',tracking_carrier:'UPS',tracking_number:'TRACK12345'});
  const id=await makeOrder(),body=payBody();
  await assert.rejects(pay(id,{...body,expected_version:2}),/Order changed/);
  await assert.rejects(pay(id,{...body,confirm_funds_received:false}),/Received funds/);
  await assert.rejects(pay(id,{...body,method_id:randomUUID()}),/Manual bank/);
  assert.equal((await pay(id,body)).status,'paid');
  assert.equal((await allocations(id)).length,2);
  assert.equal((await pay(id,body)).replayed,true);
  assert.equal((await db.query('select count(*)::int n from commerce_receipts where invoice_id=$1',[id])).rows[0].n,1);
  await assert.rejects(pay(id,{...body,external_reference:'DIFFERENT-TRANSFER'}),/Receipt replay conflict/);
  await assert.rejects(pay(id,{...body,receipt_id:randomUUID()}),/Order changed/);
  const duplicate=await makeOrder();await assert.rejects(pay(duplicate,{...payBody(),external_reference:body.external_reference}),/unique constraint/);
  assert.equal((await load(duplicate)).status,'accepted');
  await assert.rejects(fulfill(id,update(2,'shipped')),/Manual supplier assignment/);
  assert.ok((await allocations(id)).every(x=>x.status==='pending'));
  await db.query('select commerce_fulfillment_admin($1,$2)',[id,JSON.stringify({action:'assign',variant_key:'a|10mg',version:1,route:'manual',supplier_name:'Fixture supplier',note:'Fixture supplier selected'})]);
  assert.equal((await fulfill(id,update(2,'processing'))).version,3);
  await assert.rejects(fulfill(id,update(2,'shipped')),/Order changed/);
  assert.equal((await fulfill(id,update(3,'shipped'))).status,'shipped');
  assert.ok((await allocations(id)).every(x=>x.status==='shipped'&&x.tracking_number==='TRACK12345'));
  assert.equal((await pay(id,body)).replayed,true);
  const correction={action:'update_tracking',version:4,note:'Carrier corrected parcel reference',tracking_carrier:'USPS',tracking_number:'CORRECT12345'};
  assert.equal((await fulfill(id,correction)).version,5);
  assert.ok((await allocations(id)).every(x=>x.tracking_number==='CORRECT12345'));
  assert.equal((await fulfill(id,update(5,'delivered'))).status,'delivered');
  assert.ok((await allocations(id)).every(x=>x.status==='delivered'&&x.tracking_number==='CORRECT12345'));
  await assert.rejects(fulfill(id,update(6,'shipped')),/partly dispatched/);
  assert.equal((await fulfill(id,{...correction,version:6,tracking_number:'FINAL12345'})).version,7);
  assert.equal((await load(id)).tracking_number,'FINAL12345');
  await db.exec("insert into commerce_supplier_mappings(variant_key,product,vials,supplier_name) values('a|10mg',1,1,'Lotus'),('b|5mg',2,1,'Lotus');update commerce_supplier_settings set enabled=true,verified_at=now(),max_order_cents=50000;");
  const remote=await makeOrder({lotus:true});await pay(remote,payBody());
  assert.equal((await db.query('select count(*)::int n from commerce_supplier_jobs where invoice_id=$1',[remote])).rows[0].n,1);
  assert.ok((await allocations(remote)).every(x=>x.route==='lotus'));
  await assert.rejects(fulfill(remote,update(2,'shipped')),/Lotus dispatch/);
  const lease=randomUUID();await db.query("update commerce_supplier_jobs set lease_id=$2,lease_until=now()+interval '5 minutes' where invoice_id=$1",[remote,lease]);
  await assert.rejects(fulfill(remote,update(2,'processing')),/Supplier sync in progress/);
  await db.query('select commerce_fulfillment_sync($1,$2,$3)',[remote,lease,JSON.stringify({carrier:'UPS',tracking_number:'LOTUS12345',shipped_at:'2026-11-16T07:30:00Z'})]);
  await db.query("update commerce_supplier_jobs set lease_until=null,status='shipped',supplier_id='remote-id',payload='{}' where invoice_id=$1",[remote]);
  assert.equal((await load(remote)).status,'shipped');
  await assert.rejects(fulfill(remote,{...correction,version:3}),/Lotus dispatch/);
  assert.equal((await fulfill(remote,update(3,'delivered'))).status,'delivered');
  assert.ok((await allocations(remote)).every(x=>x.tracking_number==='LOTUS12345'));
  // An unconfirmed remote cancellation blocks manual dispatch even if a legacy
  // allocation was already switched. It must not create duplicate fulfillment.
  const unsafe=await makeOrder();await pay(unsafe,payBody());
  await db.query("update commerce_fulfillment_items set supplier_name='Fixture supplier' where invoice_id=$1",[unsafe]);
  await db.query("insert into commerce_supplier_jobs(invoice_id,reference,status,supplier_id,payload) values($1,$2,'submitted','remote-uncertain','{}')",[unsafe,'ALTA-'+unsafe]);
  await assert.rejects(fulfill(unsafe,update(2,'shipped')),/Confirm Lotus cancellation/);
  assert.equal((await load(unsafe)).status,'paid');
  // Processor-tagged methods cannot be manually marked as bank receipts.
  const provider=await makeOrder();await db.query("update commerce_payment_methods set native_provider='stripe' where id=$1",[methodId]);
  await assert.rejects(pay(provider,payBody()),/Manual bank/);
  const grants=(await db.query("select has_function_privilege('anon','public.commerce_admin_record_bank_payment(uuid,jsonb)','EXECUTE') bank,has_function_privilege('authenticated','public.commerce_admin_fulfill_order(uuid,jsonb)','EXECUTE') fulfillment,has_function_privilege('service_role','public.commerce_admin_fulfill_order(uuid,jsonb)','EXECUTE') service")).rows[0];
  assert.deepEqual(grants,{bank:false,fulfillment:false,service:true});
 }finally{await db.close();}
});
