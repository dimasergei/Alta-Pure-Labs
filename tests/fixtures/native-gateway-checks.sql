\set ON_ERROR_STOP on
-- Isolated PostgreSQL only. No merchant or payment in this fixture is real.
\i tests/fixtures/invoice-notification-checks.sql
\i supabase/migrations/20261110074742_payment_provider_options.sql
\i supabase/migrations/20261110160106_native_gateway_checkout.sql
set role service_role;
do $$
declare m uuid:='90000000-0000-4000-8000-000000000001';u uuid:='90000000-0000-4000-8000-000000000002';
 i uuid:='90000000-0000-4000-8000-000000000003';a uuid:='90000000-0000-4000-8000-000000000004';
 r uuid:='90000000-0000-4000-8000-000000000005';j uuid:='90000000-0000-4000-8000-000000000006';
 tag text:=repeat('a',64);p jsonb;q jsonb;o jsonb;n integer;
begin
 p:=jsonb_build_object('id',m,'version',0,'provider','nmi','mode','live','account_tag',tag,'confirmed',true,'countries',jsonb_build_array('US'),
 'label','Fixture NMI','payee','Fixture business','currency','USD','approval_reference','ISOLATED FIXTURE ONLY','active',true,'sale_scope','both');
 perform public.commerce_configure_native_gateway(p,'isolated-native-admin');
 if(select native_provider from public.commerce_payment_methods where id=m)<>'nmi' then raise exception 'Native route not recorded'; end if;
 p:=jsonb_build_object('id',i,'customer_id',u,'customer_email','native@example.test','customer_name','Native fixture','kind','membership','plan','vip',
 'digest',repeat('b',64),'request',jsonb_build_object('items','[]'::jsonb),'consent',true,'terms_version','launch-2026-11-v1');
 perform public.commerce_request_invoice(p);
 q:=jsonb_build_object('id',i,'version',1,'method_id',m,'method_version',1,'subtotal_cents',4900,'discount_cents',0,'shipping_cents',0,'tax_cents',0,
 'pricing',jsonb_build_object('lines','[]'::jsonb),'expires_at',now()+interval '24 hours','fulfillment_confirmed',true,'review_note','Reviewed fixture pass only',
 'payment_url','https://altapurelabs.com/pay.html?invoice='||i::text);
 perform public.commerce_provider_command('issue',q,'isolated-native-admin');
 perform public.commerce_accept_invoice(i,u,2,'launch-2026-11-v1');
 begin
  perform public.commerce_begin_gateway_attempt(a,i,gen_random_uuid(),'sale',tag);
  raise exception 'Cross-customer charge accepted' using errcode='22000';
 exception when no_data_found then null; end;
 o:=public.commerce_begin_gateway_attempt(a,i,u,'sale',tag);
 if o->>'claimed'<>'true' then raise exception 'First attempt not claimed'; end if;
 o:=public.commerce_begin_gateway_attempt(gen_random_uuid(),i,u,'sale',tag);
 if o->>'claimed'<>'false' or o->>'id'<>a::text then raise exception 'Duplicate charge could start'; end if;
 perform public.commerce_finish_gateway_attempt(a,'response:'||a::text,'unknown',null,null,null,null,'transport_uncertain');
 begin
  perform public.commerce_admin_command('record_payment',jsonb_build_object('id',i,'version',3,'receipt_id',gen_random_uuid(),'external_reference','fake-manual-override','amount_cents',4900,'currency','USD','funds_confirmed',true),'isolated-admin');
  raise exception 'Uncertain gateway payment was overridden' using errcode='22000';
 exception when raise_exception then null; end;
 if exists(select 1 from public.commerce_memberships where customer_id=u) then raise exception 'Entitlement before provider confirmation'; end if;
 o:=public.commerce_finish_gateway_attempt(a,'nmi-fixture-event','approved','tx-native-1',4900,'USD',null,null);
 if o->>'state'<>'paid' or (select status from public.commerce_invoices where id=i)<>'paid' then raise exception 'Confirmed native payment not applied: %',o; end if;
 o:=public.commerce_finish_gateway_attempt(a,'nmi-fixture-event','approved','tx-native-1',4900,'USD',null,null);
 if o->>'replayed'<>'true' then raise exception 'Payment event replay not idempotent'; end if;
 if(select count(*) from public.commerce_receipts where invoice_id=i)<>1 or (select count(*) from public.commerce_memberships where customer_id=u)<>1 then raise exception 'Repeated paid effects'; end if;
 begin
  perform public.commerce_finish_gateway_attempt(a,'nmi-fixture-event','approved','tx-native-1',100,'USD',null,null);
  raise exception 'Mutated replay accepted' using errcode='22000';
 exception when unique_violation then null; end;
 o:=public.commerce_begin_gateway_attempt(r,i,u,'refund',tag);
 if o->>'claimed'<>'true' then raise exception 'Refund claim failed'; end if;
 o:=public.commerce_finish_gateway_attempt(r,'native-refund-fixture','refunded','tx-native-1',4900,'USD',null,null);
 if o->>'state'<>'refunded' or (select status from public.commerce_invoices where id=i)<>'refunded' then raise exception 'Refund not applied'; end if;
 if not exists(select 1 from public.commerce_memberships where invoice_id=i and revoked_at is not null) then raise exception 'Refund did not revoke pass'; end if;
 -- Wrong amount remains review, and cannot produce an order or pass.
 perform public.commerce_request_invoice(p||jsonb_build_object('id',j,'kind','goods','plan',null,'digest',repeat('c',64),'request',jsonb_build_object('items','[]'::jsonb,'address',jsonb_build_object('country','US'))));
 perform public.commerce_provider_command('issue',q||jsonb_build_object('id',j,'payment_url','https://altapurelabs.com/pay.html?invoice='||j::text),'isolated-native-admin');
 perform public.commerce_accept_invoice(j,u,2,'launch-2026-11-v1');
 a:=gen_random_uuid();perform public.commerce_begin_gateway_attempt(a,j,u,'sale',tag);
 o:=public.commerce_finish_gateway_attempt(a,'wrong-amount-fixture','approved','tx-native-2',4800,'USD',null,null);
 if o->>'state'<>'review' or (select status from public.commerce_invoices where id=j)<>'accepted' then raise exception 'Wrong amount granted payment'; end if;
 begin
  update public.commerce_gateway_attempts set state='paid' where id=a;
  raise exception 'Backend direct payment write allowed' using errcode='22000';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ declare t text;f text;begin
 foreach t in array array['commerce_gateway_accounts','commerce_gateway_attempts','commerce_gateway_events'] loop
  if not(select relrowsecurity from pg_class where oid=('public.'||t)::regclass) then raise exception 'Missing RLS'; end if;
  if has_table_privilege('anon','public.'||t,'SELECT') or has_table_privilege('authenticated','public.'||t,'SELECT') or has_table_privilege('service_role','public.'||t,'INSERT,UPDATE,DELETE') then raise exception 'Unexpected direct privileges'; end if;
 end loop;
 foreach f in array array['public.commerce_configure_native_gateway(jsonb,text)','public.commerce_begin_gateway_attempt(uuid,uuid,uuid,text,text)','public.commerce_finish_gateway_attempt(uuid,text,text,text,integer,text,text,text)'] loop
  if has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE') then raise exception 'Browser mutation allowed'; end if;
 end loop;
end $$;
select 'native_gateway_lifecycle_passed' as result;
