'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const sql=fs.readFileSync('supabase/migrations/20261116130000_admin_shipping_lock_order.sql','utf8').toLowerCase();
const supplierSql=fs.readFileSync('supabase/migrations/20261111210000_single_supplier_per_order.sql','utf8').toLowerCase();
test('address edit follows supplier job then invoice lock order and keeps safety checks',()=>{
 const supplier=sql.indexOf('perform 1 from public.commerce_supplier_jobs');
 const invoice=sql.indexOf('select * into r from public.commerce_invoices');
 assert.ok(supplier>=0&&invoice>supplier,'supplier job lock precedes invoice lock');
 assert.match(sql,/where invoice_id=p_invoice for update/);
 assert.match(sql,/where id=p_invoice for update/);
 for(const guard of ["r.version is distinct from p_version","p_address->>'country' is distinct from old_address->>'country'","supplier_id is not null","payload is not null","lease_until>now()","status in ('submitted','shipped','working')","status in ('ordered','shipped','delivered')","'admin_shipping_address_edit'"])assert.ok(sql.includes(guard),guard);
});
test('one audited supplier assignment updates every line in a multi-line invoice',()=>{
 assert.match(supplierSql,/select \* into f from public\.commerce_fulfillment_items where invoice_id=p_invoice and variant_key=p_data->>'variant_key' for update/);
 assert.match(supplierSql,/update public\.commerce_fulfillment_items set route='manual'[\s\S]*?where invoice_id=p_invoice/);
 assert.match(supplierSql,/update public\.commerce_fulfillment_items fi set route='lotus'[\s\S]*?where fi\.invoice_id=p_invoice and mm\.variant_key=fi\.variant_key/);
 assert.match(supplierSql,/commerce_fulfillment_single_supplier_guard/);
});
