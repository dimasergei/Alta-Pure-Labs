\set ON_ERROR_STOP on
\i supabase/migrations/20261111174353_partner_settings_supplier_queue.sql
reset role;
do $$
declare p uuid:=gen_random_uuid();p2 uuid:=gen_random_uuid();u uuid:=gen_random_uuid();m uuid:=gen_random_uuid();i uuid:=gen_random_uuid();payload jsonb;j public.commerce_supplier_jobs%rowtype;lease uuid:=gen_random_uuid();
begin
 perform public.commerce_join_partner(p,'MYLAB20','partner-2026-11-v1');
 perform public.commerce_partner_add_code(p,'LAB-FRIENDS');
 if (select code from public.commerce_partners where customer_id=p)<>'LAB-FRIENDS' or not exists(select 1 from public.commerce_partner_codes where partner_id=p and code='MYLAB20') then raise exception 'Chosen code or alias lost';end if;
 perform public.commerce_partner_add_code(p,'THIRDCODE');
 begin perform public.commerce_partner_add_code(p,'FOURTHCODE');raise exception 'Fourth code allowed' using errcode='22000';exception when raise_exception then null;end;
 begin perform public.commerce_join_partner(p2,'MYLAB20','partner-2026-11-v1');raise exception 'Code collision allowed' using errcode='22000';exception when unique_violation then null;end;
 begin perform public.commerce_join_partner(p2,'BOGO','partner-2026-11-v1');raise exception 'Reserved coupon accepted' using errcode='22000';exception when invalid_parameter_value then null;end;
 perform public.commerce_partner_save_bank(p,repeat('x',80),'{"bank_name":"Fixture","account_type":"checking","country":"US","last4":"6789"}');
 if public.commerce_partner_read_bank(p)<>repeat('x',80) then raise exception 'Encrypted bank roundtrip failed';end if;
 if (select count(*) from public.commerce_partner_settings_audit where partner_id=p and action='admin_bank_details_read')<>1 then raise exception 'Read audit missing';end if;
 if commerce_internal.delivery_total('{"shipping":"standard","extras":[]}',false)<>2500 or commerce_internal.delivery_total('{"shipping":"standard","extras":[]}',true)<>0 then raise exception 'Delivery amount wrong';end if;
 begin perform commerce_internal.delivery_total('{"shipping":"express","extras":[]}',false);raise exception 'Disabled shipping accepted' using errcode='22000';exception when invalid_parameter_value then null;end;
 begin perform commerce_internal.delivery_total('{"shipping":"standard","extras":["protection"]}',true);raise exception 'Disabled protection charged' using errcode='22000';exception when invalid_parameter_value then null;end;
 perform public.commerce_admin_command('save_method',jsonb_build_object('id',m,'version',0,'kind','bank_transfer','label','Readiness fixture','currency','USD','payee','Fixture','instructions','Not real bank data','acceptance_reference','Isolated fixture approval','active',true,'business_confirmed',true,'catalog_accepted',true),'readiness-fixture');
 payload:=jsonb_build_object('id',i,'customer_id',u,'customer_email','readiness@example.test','customer_name','Fixture','kind','goods','plan',null,'digest',repeat('e',64),'request',jsonb_build_object('items','[]'::jsonb,'address',jsonb_build_object('country','US'),'checkout',jsonb_build_object('delivery','{"shipping":"standard","extras":[]}'::jsonb)),'consent',true,'terms_version','launch-2026-11-v1','checkout_version','checkout-2026-11-v4','currency','USD','method_id',m,'method_version',1,'subtotal_cents',10000,'discount_cents',0,'shipping_cents',2500,'tax_cents',0,'total_cents',12500,'points_redeemed',0,'credit_redeemed_cents',0,'earned_points',250,'pricing',jsonb_build_object('referral',jsonb_build_object('partner_id',p,'code','MYLAB20','first_order',true)),'membership_invoice_id',null);
 perform public.commerce_place_checkout(payload);
 if exists(select 1 from public.commerce_supplier_jobs) then raise exception 'Unpaid supplier submission';end if;
 -- Settings remain off in production; opt in only in this disposable fixture.
 update public.commerce_supplier_settings set enabled=true,verified_at=now(),max_order_cents=20000;
 perform public.commerce_admin_command('record_payment',jsonb_build_object('id',i,'version',1,'receipt_id',gen_random_uuid(),'external_reference','readiness-'||i,'amount_cents',12500,'currency','USD','funds_confirmed',true),'readiness-fixture');
 if (select count(*) from public.commerce_partner_commissions where invoice_id=i)<>1 then raise exception 'v4 referral commission missing';end if;
 if (select count(*) from public.commerce_supplier_jobs where invoice_id=i)<>1 then raise exception 'Paid supplier queue missing';end if;
 select * into j from public.commerce_supplier_claim(lease);
 if j.invoice_id<>i then raise exception 'Lease failed';end if;
 if exists(select 1 from public.commerce_supplier_claim(gen_random_uuid())) then raise exception 'Concurrent lease allowed';end if;
 perform public.commerce_supplier_save(i,lease,'{"status":"submitted","supplier_id":"fixture-only","release":true}');
 begin perform public.commerce_supplier_save(i,lease,'{"status":"shipped"}');raise exception 'Stale lease allowed' using errcode='22000';exception when serialization_failure then null;end;
 if has_table_privilege('anon','public.commerce_partner_banks','select') or has_table_privilege('authenticated','public.commerce_partner_codes','insert') or has_table_privilege('authenticated','public.commerce_supplier_jobs','select') or has_function_privilege('authenticated','public.commerce_partner_read_bank(uuid)','execute') or has_function_privilege('anon','public.commerce_supplier_claim(uuid)','execute') then raise exception 'Browser role access leaked';end if;
end $$;
