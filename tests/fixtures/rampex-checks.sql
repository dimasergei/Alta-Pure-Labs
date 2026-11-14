\set ON_ERROR_STOP on
-- DISPOSABLE POSTGRESQL ONLY. Run after the existing lifecycle fixtures and the Rampex migration.
set role service_role;
do $$
declare m uuid:=gen_random_uuid();u uuid:=gen_random_uuid();i uuid:=gen_random_uuid();j uuid:=gen_random_uuid();a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();
 p jsonb;q jsonb;r jsonb;tag text:=repeat('7',64);tx text:='0x'||repeat('8',64);ln text:='fixture-'||gen_random_uuid()::text;
begin
 p:=jsonb_build_object('id',m,'version',0,'provider','rampex','mode','live','account_tag',tag,'confirmed',true,'countries',jsonb_build_array('US'),
 'label','Fixture Rampex','payee','Fixture only','currency','USD','approval_reference','ISOLATED FIXTURE ONLY','active',true,'sale_scope','goods','rampex_provider','rampnetwork');
 begin perform public.commerce_configure_rampex_gateway(p||'{"rampex_provider":"stripe"}'::jsonb,'isolated-test-admin');raise exception 'Stripe allowed' using errcode='22000';exception when invalid_parameter_value then null;end;
 begin perform public.commerce_configure_rampex_gateway(p||'{"rampex_provider":"hosted"}'::jsonb,'isolated-test-admin');raise exception 'Mixed routing allowed' using errcode='22000';exception when invalid_parameter_value then null;end;
 begin perform public.commerce_configure_rampex_gateway(p||'{"mode":"sandbox"}'::jsonb,'isolated-test-admin');raise exception 'Sandbox allowed' using errcode='22000';exception when invalid_parameter_value then null;end;
 begin perform public.commerce_configure_rampex_gateway(p||'{"sale_scope":"membership"}'::jsonb,'isolated-test-admin');raise exception 'Membership allowed' using errcode='22000';exception when invalid_parameter_value then null;end;
 perform public.commerce_configure_rampex_gateway(p,'isolated-test-admin');
 p:=jsonb_build_object('id',i,'customer_id',u,'customer_email','rampex@example.test','customer_name','Rampex fixture','kind','goods','digest',repeat('7',64),'request',jsonb_build_object('items','[]'::jsonb,'address',jsonb_build_object('country','US')),'consent',true,'terms_version','launch-2026-11-v1');
 perform public.commerce_request_invoice(p);
 q:=jsonb_build_object('id',i,'version',1,'method_id',m,'method_version',1,'subtotal_cents',4900,'discount_cents',0,'shipping_cents',0,'tax_cents',0,'pricing',jsonb_build_object('lines','[]'::jsonb),'expires_at',now()+interval '24 hours','fulfillment_confirmed',true,'review_note','Isolated Rampex fixture','payment_url','https://altapurelabs.com/pay.html?invoice='||i::text);
 perform public.commerce_provider_command('issue',q,'isolated-test-admin');
 perform public.commerce_accept_invoice(i,u,2,'launch-2026-11-v1');
 r:=public.commerce_begin_rampex_attempt(a,i,u,tag);
 if r->>'claimed'<>'true' or r->>'rampex_provider'<>'rampnetwork' then raise exception 'First attempt not claimed';end if;
 r:=public.commerce_begin_rampex_attempt(b,i,u,tag);
 if r->>'claimed'<>'false' or r->>'id'<>a::text then raise exception 'Duplicate create allowed';end if;
 begin perform public.commerce_finish_rampex_payment(a,ln,tag,tx,4900,4900,'USD');raise exception 'Unbound link paid' using errcode='22000';exception when invalid_parameter_value then null;end;
 begin perform public.commerce_bind_rampex_link(a,ln,'https://evil.invalid/pay',tag);raise exception 'Unsafe redirect allowed' using errcode='22000';exception when invalid_parameter_value then null;end;
 perform public.commerce_bind_rampex_link(a,ln,'https://checkout.rampex.io/pay/'||ln,tag);
 r:=public.commerce_bind_rampex_link(a,ln,'https://checkout.rampex.io/pay/'||ln,tag);
 if r->>'replayed'<>'true' then raise exception 'Link replay failed';end if;
 begin perform public.commerce_bind_rampex_link(a,'different','https://checkout.rampex.io/pay/different',tag);raise exception 'Rebind allowed' using errcode='22000';exception when unique_violation then null;end;
 begin perform public.commerce_finish_rampex_payment(a,ln,tag,tx,4800,4800,'USD');raise exception 'Wrong amount paid' using errcode='22000';exception when invalid_parameter_value then null;end;
 begin perform public.commerce_finish_rampex_payment(a,ln,tag,tx,4900,4800,'USD');raise exception 'Underpayment paid' using errcode='22000';exception when invalid_parameter_value then null;end;
 begin perform public.commerce_finish_rampex_payment(a,ln,repeat('f',64),tx,4900,4900,'USD');raise exception 'Cross-account paid' using errcode='22000';exception when invalid_parameter_value then null;end;
 begin perform public.commerce_finish_rampex_payment(a,ln,tag,tx,4900,4900,'CAD');raise exception 'Wrong currency paid' using errcode='22000';exception when invalid_parameter_value then null;end;
 r:=public.commerce_finish_rampex_payment(a,ln,tag,tx,4900,4900,'USD');
 if r->>'state'<>'paid' or r->>'newly_paid'<>'true' then raise exception 'Payment not recorded: %',r;end if;
 r:=public.commerce_finish_rampex_payment(a,ln,tag,tx,4900,4900,'USD');
 if r->>'newly_paid'<>'false' or r->>'replayed'<>'true' then raise exception 'Replay not deduplicated';end if;
 if (select count(*) from public.commerce_gateway_events where attempt_id=a and outcome='approved')<>1 then raise exception 'Duplicate approval';end if;
 begin perform public.commerce_finish_rampex_payment(a,ln,tag,'0x'||repeat('9',64),4900,4900,'USD');raise exception 'Conflicting replay allowed' using errcode='22000';exception when unique_violation then null;end;
 if (select status from public.commerce_invoices where id=i)<>'paid' then raise exception 'Invoice not paid';end if;
end $$;
reset role;
do $$
declare role_name text; f record;
begin
 foreach role_name in array array['anon','authenticated'] loop
  for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('commerce_configure_rampex_gateway','commerce_begin_rampex_attempt','commerce_bind_rampex_link','commerce_finish_rampex_payment','commerce_rampex_schema_version') loop
   if has_function_privilege(role_name,f.oid,'execute') then raise exception 'Browser role can mutate Rampex';end if;
  end loop;
  if has_table_privilege(role_name,'public.commerce_gateway_attempts','insert,update,delete') then raise exception 'Browser direct mutation privilege';end if;
 end loop;
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('commerce_gateway_attempts','commerce_gateway_accounts','commerce_gateway_events') and not c.relrowsecurity) then raise exception 'RLS disabled';end if;
end $$;
select 'rampex_replay_amount_currency_account_permissions_passed' as result;
