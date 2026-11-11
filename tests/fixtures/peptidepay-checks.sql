\set ON_ERROR_STOP on
-- Runs after native-gateway-checks.sql in a disposable PostgreSQL database only.
\i supabase/migrations/20261111013010_peptidepay_invoice_sessions.sql
set role service_role;
do $$
declare m uuid:=gen_random_uuid();u uuid:=gen_random_uuid();i uuid:=gen_random_uuid();j uuid:=gen_random_uuid();a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();
 p jsonb;q jsonb;r jsonb;tag text:=repeat('c',64);tx text:='0x'||repeat('d',64);addr text:='0x'||repeat('e',40);
begin
 p:=jsonb_build_object('id',m,'version',0,'provider','peptidepay','mode','live','account_tag',tag,'confirmed',true,'countries',jsonb_build_array('US'),
 'label','Fixture PeptidePay','payee','Fixture business','currency','USD','approval_reference','ISOLATED FIXTURE ONLY','active',true,'sale_scope','goods');
 begin
  perform public.commerce_configure_native_gateway(p||'{"mode":"sandbox"}'::jsonb,'isolated-test-admin');
  raise exception 'Test route allowed' using errcode='22000';
 exception when invalid_parameter_value then null;end;
 perform public.commerce_configure_native_gateway(p,'isolated-test-admin');
 p:=jsonb_build_object('id',i,'customer_id',u,'customer_email','peptidepay@example.test','customer_name','Payment fixture','kind','goods',
 'digest',repeat('e',64),'request',jsonb_build_object('items','[]'::jsonb,'address',jsonb_build_object('country','US')),'consent',true,'terms_version','launch-2026-11-v1');
 perform public.commerce_request_invoice(p);
 q:=jsonb_build_object('id',i,'version',1,'method_id',m,'method_version',1,'subtotal_cents',4900,'discount_cents',0,'shipping_cents',0,'tax_cents',0,
 'pricing',jsonb_build_object('lines','[]'::jsonb),'expires_at',now()+interval '24 hours','fulfillment_confirmed',true,'review_note','Reviewed isolated fixture',
 'payment_url','https://altapurelabs.com/pay.html?invoice='||i::text);
 perform public.commerce_provider_command('issue',q,'isolated-test-admin');
 perform public.commerce_accept_invoice(i,u,2,'launch-2026-11-v1');
 perform public.commerce_begin_gateway_attempt(a,i,u,'sale',tag);
 begin
  perform public.commerce_finish_gateway_attempt(a,'unbound-fixture','approved',tx,4900,'USD',null,null);
  raise exception 'Unbound settlement accepted' using errcode='22000';
 exception when invalid_parameter_value then null;end;
 begin
  perform public.commerce_bind_peptidepay_session(a,'cs_test_fixture',addr,'https://peptide-pay.com/session/cs_test_fixture');
  raise exception 'Simulator session bound' using errcode='22000';
 exception when invalid_parameter_value then null;end;
 r:=public.commerce_bind_peptidepay_session(a,'cs_fixture123456',addr,'https://peptide-pay.com/session/cs_fixture123456');
 if r->>'state'<>'redirected' then raise exception 'Session not redirected';end if;
 r:=public.commerce_bind_peptidepay_session(a,'cs_fixture123456',addr,'https://peptide-pay.com/session/cs_fixture123456');
 if r->>'replayed'<>'true' then raise exception 'Session bind not idempotent';end if;
 begin
  perform public.commerce_bind_peptidepay_session(a,'cs_other123456',addr,'https://peptide-pay.com/session/cs_other123456');
  raise exception 'Attempt rebound' using errcode='22000';
 exception when unique_violation then null;end;
 r:=public.commerce_begin_gateway_attempt(gen_random_uuid(),i,u,'sale',tag);
 if r->>'claimed'<>'false' or r->>'id'<>a::text then raise exception 'Duplicate session permitted';end if;
 if(select status from public.commerce_invoices where id=i)<>'accepted' then raise exception 'Redirect became payment';end if;
 perform public.commerce_request_invoice(p||jsonb_build_object('id',j,'digest',repeat('f',64)));
 perform public.commerce_provider_command('issue',q||jsonb_build_object('id',j,'payment_url','https://altapurelabs.com/pay.html?invoice='||j::text),'isolated-test-admin');
 perform public.commerce_accept_invoice(j,u,2,'launch-2026-11-v1');
 perform public.commerce_begin_gateway_attempt(b,j,u,'sale',tag);
 begin
  perform public.commerce_bind_peptidepay_session(b,'cs_fixture123456',addr,'https://peptide-pay.com/session/cs_fixture123456');
  raise exception 'Session reused across invoices' using errcode='22000';
 exception when unique_violation then null;end;
 r:=public.commerce_finish_gateway_attempt(a,'pp-confirmed-fixture','approved',tx,4900,'USD',null,null);
 if r->>'state'<>'paid' then raise exception 'Settlement not applied: %',r;end if;
 perform public.commerce_finish_gateway_attempt(a,'pp-confirmed-fixture','approved',tx,4900,'USD',null,null);
 if(select count(*) from public.commerce_receipts where invoice_id=i)<>1 then raise exception 'Duplicate receipt';end if;
 if(select status from public.commerce_invoices where id=j)<>'accepted' then raise exception 'Unrelated invoice mutated';end if;
 begin
  perform public.commerce_begin_gateway_attempt(gen_random_uuid(),i,u,'refund',tag);
  raise exception 'Unsupported automated crypto refund allowed' using errcode='22000';
 exception when raise_exception then null;end;
end $$;
reset role;
do $$begin
 if has_function_privilege('anon','public.commerce_bind_peptidepay_session(uuid,text,text,text)','EXECUTE')
  or has_function_privilege('authenticated','public.commerce_bind_peptidepay_session(uuid,text,text,text)','EXECUTE')
  or not has_function_privilege('service_role','public.commerce_bind_peptidepay_session(uuid,text,text,text)','EXECUTE') then raise exception 'Wrong session-binding ACL';end if;
 if has_table_privilege('anon','public.commerce_gateway_attempts','SELECT') or has_table_privilege('authenticated','public.commerce_gateway_attempts','SELECT')
  or has_table_privilege('service_role','public.commerce_gateway_attempts','UPDATE') then raise exception 'Payment data permissions expanded';end if;
end $$;
select 'peptidepay_session_lifecycle_passed' as result;
