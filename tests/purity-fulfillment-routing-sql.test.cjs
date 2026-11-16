'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
let PGlite;try{({PGlite}=require('@electric-sql/pglite'));}catch{}
const read=name=>fs.readFileSync(path.join(__dirname,'../supabase/migrations',name),'utf8');
test('99Purity routing preserves paid quantities, membership gifts and manual order management without Lotus jobs',{skip:!PGlite,timeout:60000},async()=>{
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
  const platinum=read('20261114211235_platinum_membership_benefits.sql');
  await db.exec(platinum.slice(0,platinum.indexOf('-- Once per UTC')));
  const methodId=randomUUID();
  await db.query("insert into commerce_payment_methods(id,kind,label,currency,payee,instructions,acceptance_reference,active) values($1,'bank_transfer','Fixture wire','USD','Fixture business','Fixture bank instructions','Fixture bank acceptance',true)",[methodId]);
  const makeOrder=async({country='US',customerId=randomUUID(),kind='goods',items=[{id:'a',name:'Compound A',size:'10mg',qty:4,bogo_free_qty:2},{id:'b',name:'Compound B',size:'5mg',qty:50}],source='store'}={})=>{
   const id=randomUUID();await db.query("insert into commerce_invoices(id,customer_id,customer_email,customer_name,kind,plan,request_digest,request_data,status,method_id,payment_snapshot,currency,subtotal_cents,discount_cents,shipping_cents,tax_cents,total_cents) values($1,$2,'fixture@example.test','Fixture',$3,$4,$5,$6,'accepted',$7,'{\"kind\":\"bank_transfer\"}','USD',10000,0,0,0,10000)",[id,customerId,kind,kind==='membership'?'elite':null,'a'.repeat(64),JSON.stringify({address:{country},items,source}),methodId]);return id;
  };
  const pay=async id=>(await db.query('select commerce_admin_record_bank_payment($1,$2) result',[id,JSON.stringify({method_id:methodId,expected_version:1,receipt_id:randomUUID(),external_reference:'BANK-'+randomUUID(),confirm_funds_received:true})])).rows[0].result;
  const allocations=async id=>(await db.query('select * from commerce_fulfillment_items where invoice_id=$1 order by variant_key',[id])).rows;
  const jobCount=async id=>(await db.query('select count(*)::int n from commerce_supplier_jobs where invoice_id=$1',[id])).rows[0].n;
  await db.exec("insert into commerce_supplier_mappings(variant_key,product,vials,supplier_name) values('a|10mg',1,1,'Lotus'),('b|5mg',2,1,'Lotus');update commerce_supplier_settings set enabled=true,verified_at=now(),max_order_cents=50000;");
  const legacy=await makeOrder();await pay(legacy);
  const legacyItems=await allocations(legacy),legacyJobs=(await db.query('select * from commerce_supplier_jobs where invoice_id=$1',[legacy])).rows;
  assert.ok(legacyItems.every(x=>x.route==='lotus'));assert.equal(legacyJobs.length,1);
  await db.exec(read('20261116150000_purity_manual_fulfillment.sql'));
  assert.equal((await db.query('select enabled from commerce_supplier_settings')).rows[0].enabled,false);
  assert.deepEqual(await allocations(legacy),legacyItems);
  assert.deepEqual((await db.query('select * from commerce_supplier_jobs where invoice_id=$1',[legacy])).rows,legacyJobs);
  await db.query('select commerce_internal.fulfillment_seed($1)',[legacy]);assert.deepEqual(await allocations(legacy),legacyItems);
  // Even accidental legacy configuration changes cannot restart automatic routing.
  await db.exec('update commerce_supplier_settings set enabled=true;');
  for(const source of ['store','bulk','research-builder']){
   const id=await makeOrder({source,country:source==='bulk'?'CA':'US'});
   assert.equal((await allocations(id)).length,0);await db.query('select commerce_internal.fulfillment_seed($1)',[id]);assert.equal((await allocations(id)).length,0);
   assert.equal((await pay(id)).status,'paid');const rows=await allocations(id);
   assert.equal(rows.length,2);assert.ok(rows.every(x=>x.route==='manual'&&x.supplier_name==='99Purity Peptides'&&x.product===null&&x.vials===null));
   assert.deepEqual(rows.map(x=>x.item.qty),[4,50]);assert.equal(rows[0].item.bogo_free_qty,2);assert.equal(await jobCount(id),0);
   await db.query('select commerce_internal.fulfillment_seed($1)',[id]);assert.deepEqual(await allocations(id),rows);
   const update=(version,status)=>JSON.stringify({action:'update_order',version,status,note:'Supplier confirmed shipment status',tracking_carrier:'UPS',tracking_number:'PURITY123456'});
   assert.equal((await db.query('select commerce_admin_fulfill_order($1,$2) result',[id,update(2,'processing')])).rows[0].result.status,'processing');
   assert.equal((await db.query('select commerce_admin_fulfill_order($1,$2) result',[id,update(3,'shipped')])).rows[0].result.status,'shipped');
   assert.equal((await db.query('select commerce_admin_fulfill_order($1,$2) result',[id,update(4,'delivered')])).rows[0].result.status,'delivered');
   assert.ok((await allocations(id)).every(x=>x.status==='delivered'&&x.tracking_number==='PURITY123456'));assert.equal(await jobCount(id),0);
  }
  const customerId=randomUUID(),membership=await makeOrder({kind:'membership',customerId,items:[]});await pay(membership);
  assert.equal((await allocations(membership)).length,0);assert.equal(await jobCount(membership),0);
  const memberOrder=await makeOrder({customerId,items:[{id:'bac-3',name:'BAC Water',size:'3 mL',qty:2}]});await pay(memberOrder);
  const memberItems=await allocations(memberOrder);assert.equal(memberItems.length,2);
  assert.ok(memberItems.every(x=>x.supplier_name==='99Purity Peptides'&&x.route==='manual'));
  const gift=memberItems.find(x=>x.variant_key==='gift-bac-3|3 mL');assert.equal(gift.item.qty,1);assert.equal(gift.item.membership_gift,true);
  assert.equal(memberItems.find(x=>x.variant_key==='bac-3|3 mL').item.qty,2);assert.equal(await jobCount(memberOrder),0);
  await db.query('select commerce_internal.fulfillment_seed($1)',[memberOrder]);assert.deepEqual(await allocations(memberOrder),memberItems);
  // Voiding/refunding a historical supplier order does not restart its old job.
  await db.query("update commerce_supplier_jobs set status='cancelled',next_attempt_at='2026-01-01' where invoice_id=$1",[legacy]);
  await db.query("update commerce_invoices set status='refunded' where id=$1",[legacy]);
  assert.equal((await db.query('select status from commerce_supplier_jobs where invoice_id=$1',[legacy])).rows[0].status,'cancelled');
  const grants=(await db.query("select has_function_privilege('anon','commerce_internal.fulfillment_seed(uuid)','EXECUTE') anon_seed,has_function_privilege('authenticated','commerce_internal.lotus_enqueue()','EXECUTE') customer_trigger,has_function_privilege('service_role','commerce_internal.fulfillment_seed(uuid)','EXECUTE') service_seed")).rows[0];
  assert.deepEqual(grants,{anon_seed:false,customer_trigger:false,service_seed:false});
 }finally{await db.close();}
});
