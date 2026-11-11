\set ON_ERROR_STOP on
\i supabase/migrations/20261111195957_unified_supplier_fulfillment.sql
reset role;
do $$
declare i uuid:=gen_random_uuid();j uuid:=gen_random_uuid();l uuid:=gen_random_uuid();v integer;job public.commerce_supplier_jobs%rowtype;
begin
 insert into public.commerce_supplier_mappings(variant_key,product,vials,supplier_name) values('fixture|5mg',999,1,'Fixture Lotus') on conflict do nothing;
 insert into public.commerce_invoices(id,customer_id,customer_email,customer_name,kind,request_digest,request_data,status)
 values(i,gen_random_uuid(),'fulfillment@example.test','Fixture','goods',repeat('a',64),'{"address":{"country":"US"},"items":[{"id":"fixture","name":"Fixture","size":"5mg","qty":2},{"id":"manual","name":"Other","size":"20mg","qty":1}]}','accepted');
 update public.commerce_invoices set status='paid' where id=i;
 if (select count(*) from public.commerce_fulfillment_items where invoice_id=i)<>2 or not exists(select 1 from public.commerce_fulfillment_items where invoice_id=i and route='manual') then raise exception 'Mixed allocation failed';end if;
 select * into job from public.commerce_supplier_claim(l);
 if job.invoice_id<>i then raise exception 'Wrong claim';end if;
 begin perform public.commerce_fulfillment_admin(i,'{"action":"assign","variant_key":"fixture|5mg","version":1,"route":"manual","supplier_name":"Other","note":"Fixture route"}');raise exception 'Lease override allowed' using errcode='22000';exception when serialization_failure then null;end;
 perform public.commerce_supplier_save(i,l,'{"payload":{"reference":"fixture"},"status":"submitted","supplier_id":"test-only"}');
 perform public.commerce_fulfillment_sync(i,l,'{"carrier":"UPS","tracking_number":"FIXTURE1","shipped_at":"2026-11-11T20:00:00Z"}');
 if (select status from public.commerce_invoices where id=i)<>'paid' then raise exception 'Partial marked shipped';end if;
 begin update public.commerce_invoices set status='shipped' where id=i;raise exception 'Partial bypass allowed' using errcode='22000';exception when raise_exception then null;end;
 perform public.commerce_supplier_save(i,l,'{"status":"shipped","release":true}');
 begin perform public.commerce_fulfillment_admin(i,'{"action":"assign","variant_key":"fixture|5mg","version":2,"route":"manual","supplier_name":"Other","note":"Fixture route"}');raise exception 'Dispatched reassignment allowed' using errcode='22000';exception when raise_exception then null;end;
 perform public.commerce_fulfillment_admin(i,'{"action":"assign","variant_key":"manual|20mg","version":1,"route":"manual","supplier_name":"Second supplier","note":"Fixture supplier assignment"}');
 begin perform public.commerce_fulfillment_admin(i,'{"action":"shipment","variant_key":"manual|20mg","version":1,"status":"shipped","note":"Stale fixture update"}');raise exception 'Stale write allowed' using errcode='22000';exception when serialization_failure then null;end;
 perform public.commerce_fulfillment_admin(i,'{"action":"shipment","variant_key":"manual|20mg","version":2,"status":"shipped","tracking_carrier":"USPS","tracking_number":"FIXTURE2","note":"Confirmed manual dispatch"}');
 if (select status from public.commerce_invoices where id=i)<>'shipped' then raise exception 'Complete order not rolled up';end if;
 if (select count(distinct tracking_number) from public.commerce_fulfillment_items where invoice_id=i)<>2 then raise exception 'Split tracking lost';end if;
 perform public.commerce_fulfillment_admin(i,'{"action":"shipment","variant_key":"fixture|5mg","version":2,"status":"delivered","tracking_carrier":"UPS","tracking_number":"FIXTURE1","note":"Confirmed carrier delivery"}');
 perform public.commerce_fulfillment_admin(i,'{"action":"shipment","variant_key":"manual|20mg","version":3,"status":"delivered","tracking_carrier":"USPS","tracking_number":"FIXTURE2","note":"Confirmed carrier delivery"}');
 if (select status from public.commerce_invoices where id=i)<>'delivered' then raise exception 'Delivery rollup missing';end if;
 insert into public.commerce_invoices(id,customer_id,customer_email,customer_name,kind,request_digest,request_data,status)
 values(j,gen_random_uuid(),'takeover@example.test','Fixture','goods',repeat('b',64),'{"address":{"country":"US"},"items":[{"id":"fixture","name":"Fixture","size":"5mg","qty":1}]}','accepted');
 update public.commerce_invoices set status='paid' where id=j;
 perform public.commerce_fulfillment_admin(j,'{"action":"takeover","note":"Manual cancellation fixture"}');
 if not exists(select 1 from public.commerce_fulfillment_items where invoice_id=j and route='lotus') then raise exception 'Premature manual release';end if;
 l:=gen_random_uuid();select * into job from public.commerce_supplier_claim(l);
 perform public.commerce_fulfillment_release_lotus(j,l);
 if not exists(select 1 from public.commerce_fulfillment_items where invoice_id=j and route='manual') or (select status from public.commerce_supplier_jobs where invoice_id=j)<>'cancelled' then raise exception 'Takeover failed';end if;
 if has_table_privilege('anon','public.commerce_fulfillment_items','select') or has_table_privilege('authenticated','public.commerce_fulfillment_items','update') or has_function_privilege('anon','public.commerce_fulfillment_admin(uuid,jsonb)','execute') then raise exception 'Browser access leaked';end if;
end $$;
