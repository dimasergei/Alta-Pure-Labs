\set ON_ERROR_STOP on
-- Disposable PostgreSQL only.
\i tests/fixtures/manual-invoice-commerce-checks.sql
\i supabase/migrations/20261110072347_payment_provider_options.sql
set role service_role;
do $$
declare method_id uuid:='81000000-0000-4000-8000-000000000001';
 v_invoice uuid:='82000000-0000-4000-8000-000000000001';
 member_invoice uuid:='82000000-0000-4000-8000-000000000002';
 actor_id uuid:='83000000-0000-4000-8000-000000000001'; p jsonb; q jsonb; result jsonb;
begin
 p:=jsonb_build_object('id',method_id,'version',0,'provider_key','paypal','display_order',30,'sale_scope','goods','kind','hosted_link','label','PayPal fixture','currency','USD','payee','Fixture business','instructions','Pay the exact hosted business invoice','allowed_host','www.paypal.com','acceptance_reference','Fixture eligibility review','active',true,'business_confirmed',true,'catalog_accepted',true);
 perform public.commerce_provider_command('save_method',p,'fixture-admin');
 if not exists(select 1 from public.commerce_payment_methods where id=method_id and provider_key='paypal' and display_order=30 and sale_scope='goods') then raise exception 'Provider fields not saved'; end if;
 begin
  perform public.commerce_provider_command('save_method',p||jsonb_build_object('id',gen_random_uuid(),'allowed_host','paypal.com.evil.com'),'fixture-admin');
  raise exception 'Wrong provider host saved' using errcode='22000';
 exception when invalid_parameter_value then null; end;
 perform public.commerce_provider_command('set_method_priority',jsonb_build_object('id',method_id,'version',1,'display_order',2),'fixture-admin');
 begin
  perform public.commerce_provider_command('set_method_priority',jsonb_build_object('id',method_id,'version',1,'display_order',3),'fixture-admin');
  raise exception 'Stale reorder succeeded' using errcode='22000';
 exception when serialization_failure then null; end;
 perform public.commerce_request_invoice(jsonb_build_object('id',v_invoice,'customer_id',actor_id,'customer_email','providerfixture@example.test','customer_name','Fixture owner','kind','goods','plan',null,'digest',repeat('f',64),'request',jsonb_build_object('items','[]'::jsonb),'consent',true,'terms_version','launch-2026-11-v1'));
 q:=jsonb_build_object('id',v_invoice,'version',1,'method_id',method_id,'method_version',2,'subtotal_cents',6000,'discount_cents',0,'shipping_cents',500,'tax_cents',0,'pricing',jsonb_build_object('lines','[]'::jsonb),'expires_at',now()+interval '24 hours','fulfillment_confirmed',true,'review_note','Fixture delivery and tax review','payment_url','https://www.paypal.com/invoice/p/#INV2-ABCDEF');
 begin
  perform public.commerce_provider_command('issue',q||'{"method_version":1}'::jsonb,'fixture-admin');
  raise exception 'Stale provider snapshot issued' using errcode='22000';
 exception when serialization_failure then null; end;
 begin
  perform public.commerce_provider_command('issue',q||'{"payment_url":"https://evil.example.com/invoice/p/ABCDEF"}'::jsonb,'fixture-admin');
  raise exception 'Wrong hosted domain issued' using errcode='22000';
 exception when invalid_parameter_value then null; end;
 perform public.commerce_provider_command('issue',q,'fixture-admin');
 if (select payment_snapshot->>'provider_key' from public.commerce_invoices where id=v_invoice)<>'paypal' then raise exception 'Invoice lacks provider snapshot'; end if;
 perform public.commerce_provider_command('set_method_priority',jsonb_build_object('id',method_id,'version',2,'display_order',100),'fixture-admin');
 if (select payment_snapshot->>'display_order' from public.commerce_invoices where id=v_invoice)<>'2' then raise exception 'Old invoice snapshot changed on reorder'; end if;
 perform public.commerce_request_invoice(jsonb_build_object('id',member_invoice,'customer_id',actor_id,'customer_email','providerfixture@example.test','customer_name','Fixture owner','kind','membership','plan','vip','digest',repeat('d',64),'request',jsonb_build_object('items','[]'::jsonb),'consent',true,'terms_version','launch-2026-11-v1'));
 begin
  perform public.commerce_provider_command('issue',q||jsonb_build_object('id',member_invoice,'method_version',3,'subtotal_cents',4900,'shipping_cents',0),'fixture-admin');
  raise exception 'Goods-only method accepted membership' using errcode='22000';
 exception when raise_exception then null; end;
 perform public.commerce_provider_command('pause_method',jsonb_build_object('id',method_id,'version',3),'fixture-admin');
 if (select active from public.commerce_payment_methods where id=method_id) then raise exception 'Pause did not disable method'; end if;
 begin
  perform public.commerce_accept_invoice(v_invoice,actor_id,2,'launch-2026-11-v1');
  raise exception 'Paused provider invoice accepted' using errcode='22000';
 exception when raise_exception then null; end;
 if (select count(*) from public.commerce_receipts where commerce_receipts.invoice_id in (v_invoice,member_invoice))<>0 then raise exception 'Configuration created payments'; end if;
end $$;
reset role;
do $$ begin
 if has_function_privilege('anon','public.commerce_provider_command(text,jsonb,text)','EXECUTE') or has_function_privilege('authenticated','public.commerce_provider_command(text,jsonb,text)','EXECUTE') then raise exception 'Browser provider-write access'; end if;
 if not has_function_privilege('service_role','public.commerce_provider_command(text,jsonb,text)','EXECUTE') then raise exception 'Backend cannot manage providers'; end if;
 if has_table_privilege('anon','public.commerce_payment_methods','SELECT') or has_table_privilege('authenticated','public.commerce_payment_methods','SELECT') then raise exception 'Public access to receiving details'; end if;
end $$;
select 'payment_provider_options_passed' as result;
