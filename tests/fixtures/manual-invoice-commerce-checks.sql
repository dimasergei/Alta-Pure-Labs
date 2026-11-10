\set ON_ERROR_STOP on
-- Disposable database only; these identities and receipts are isolated fixtures.
do $$ begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
alter role service_role bypassrls;
\i supabase/migrations/20261110040926_manual_invoice_commerce.sql
set role service_role;
do $$
declare m uuid:='30000000-0000-4000-8000-000000000001';
 u uuid:='20000000-0000-4000-8000-000000000001';
 v uuid:='20000000-0000-4000-8000-000000000002';
 i uuid:='10000000-0000-4000-8000-000000000001';
 j uuid:='10000000-0000-4000-8000-000000000002';
 k uuid:='10000000-0000-4000-8000-000000000003';
 p jsonb; quote jsonb; payment jsonb; r jsonb; n integer; t text;
begin
 if exists(select 1 from public.commerce_payment_methods where active) then raise exception 'Unexpected configured receiver'; end if;
 p:=jsonb_build_object('id',m,'version',0,'kind','bank_transfer','label','Fixture bank','currency','USD','payee','Fixture business','instructions','Isolated test receiving instructions','acceptance_reference','Fixture account acceptance','active',true,'business_confirmed',true,'catalog_accepted',true);
 perform public.commerce_admin_command('save_method',p,'fixture-admin-1');
 begin
  perform public.commerce_admin_command('save_method',p||'{"version":0}'::jsonb,'fixture-admin-2');
  raise exception 'Stale method edit succeeded' using errcode='22000';
 exception when serialization_failure then null; end;
 p:=jsonb_build_object('id',i,'customer_id',u,'customer_email','fixture@example.test','customer_name','Fixture researcher','kind','membership','plan','vip','digest',repeat('a',64),'request',jsonb_build_object('items','[]'::jsonb),'consent',true,'terms_version','launch-2026-11-v1');
 r:=public.commerce_request_invoice(p);
 if r->>'created'<>'true' then raise exception 'Request not created'; end if;
 r:=public.commerce_request_invoice(p);
 if r->>'created'<>'false' then raise exception 'Duplicate invoice'; end if;
 if (select count(*) from public.commerce_events where invoice_id=i and action='requested')<>1 then raise exception 'Duplicate request event'; end if;
 begin
  perform public.commerce_request_invoice(p||jsonb_build_object('customer_id',v));
  raise exception 'Cross-customer id collision accepted' using errcode='22000';
 exception when unique_violation then null; end;
 quote:=jsonb_build_object('id',i,'version',1,'method_id',m,'subtotal_cents',4900,'discount_cents',0,'shipping_cents',0,'tax_cents',0,'pricing',jsonb_build_object('lines','[]'::jsonb),'expires_at',now()+interval '24 hours','fulfillment_confirmed',true,'review_note','Prepaid annual pass reviewed for fixture.');
 perform public.commerce_admin_command('issue',quote,'fixture-admin-1');
 begin
  perform public.commerce_accept_invoice(i,v,2,'launch-2026-11-v1');
  raise exception 'Other customer accepted invoice' using errcode='22000';
 exception when no_data_found then null; end;
 perform public.commerce_accept_invoice(i,u,2,'launch-2026-11-v1');
 payment:=jsonb_build_object('id',i,'version',3,'receipt_id','40000000-0000-4000-8000-000000000001','external_reference','fixture-bank-transfer-1','amount_cents',4900,'currency','USD','funds_confirmed',true);
 begin
  perform public.commerce_admin_command('record_payment',payment||'{"amount_cents":4901}'::jsonb,'fixture-admin-1');
  raise exception 'Mismatched payment accepted' using errcode='22000';
 exception when raise_exception then null; end;
 begin
  perform public.commerce_admin_command('record_payment',payment||'{"currency":"CAD"}'::jsonb,'fixture-admin-1');
  raise exception 'Wrong currency payment accepted' using errcode='22000';
 exception when raise_exception then null; end;
 if exists(select 1 from public.commerce_memberships where customer_id=u) then raise exception 'Pass granted before payment'; end if;
 perform public.commerce_admin_command('record_payment',payment,'fixture-admin-1');
 r:=public.commerce_admin_command('record_payment',payment,'fixture-admin-1');
 if r->>'replayed'<>'true' then raise exception 'Payment not idempotent'; end if;
 if (select count(*) from public.commerce_receipts where invoice_id=i)<>1 or (select count(*) from public.commerce_memberships where customer_id=u)<>1 then raise exception 'Duplicate paid effect'; end if;
 if not exists(select 1 from public.commerce_memberships where invoice_id=i and expires_at-starts_at=interval '365 days' and revoked_at is null) then raise exception 'Wrong pass period'; end if;
 perform public.commerce_admin_command('record_refund',payment||jsonb_build_object('version',4,'receipt_id','40000000-0000-4000-8000-000000000002','external_reference','fixture-bank-refund-1'),'fixture-admin-1');
 if not exists(select 1 from public.commerce_memberships where invoice_id=i and revoked_at is not null) then raise exception 'Refund did not revoke pass'; end if;
 p:=p||jsonb_build_object('id',j,'kind','goods','plan',null,'digest',repeat('b',64));
 perform public.commerce_request_invoice(p);
 quote:=quote||jsonb_build_object('id',j,'subtotal_cents',6000,'shipping_cents',1000,'tax_cents',500);
 perform public.commerce_admin_command('issue',quote,'fixture-admin-1');
 perform public.commerce_accept_invoice(j,u,2,'launch-2026-11-v1');
 begin
  perform public.commerce_admin_command('status',jsonb_build_object('id',j,'version',3,'status','shipped','note','This must not ship before payment','tracking_carrier','Fixture carrier','tracking_number','FIXTURE123'),'fixture-admin-1');
  raise exception 'Unpaid goods shipped' using errcode='22000';
 exception when raise_exception then null; end;
 payment:=payment||jsonb_build_object('id',j,'version',3,'receipt_id','40000000-0000-4000-8000-000000000003','amount_cents',7500);
 begin
  perform public.commerce_admin_command('record_payment',payment,'fixture-admin-1');
  raise exception 'Same external reference paid twice' using errcode='22000';
 exception when unique_violation then null; end;
 payment:=payment||jsonb_build_object('external_reference','fixture-bank-transfer-2');
 perform public.commerce_admin_command('record_payment',payment,'fixture-admin-1');
 perform public.commerce_admin_command('status',jsonb_build_object('id',j,'version',4,'status','processing','note','Owner processing manually'),'fixture-admin-1');
 begin
  perform public.commerce_admin_command('status',jsonb_build_object('id',j,'version',5,'status','shipped','note','Missing tracking must fail'),'fixture-admin-1');
  raise exception 'Shipment without tracking' using errcode='22000';
 exception when invalid_parameter_value then null; end;
 perform public.commerce_admin_command('status',jsonb_build_object('id',j,'version',5,'status','shipped','note','Owner verified supplier handoff','tracking_carrier','Fixture carrier','tracking_number','FIXTURE123'),'fixture-admin-1');
 perform public.commerce_admin_command('status',jsonb_build_object('id',j,'version',6,'status','delivered','note','Delivery confirmed manually'),'fixture-admin-1');
 if (select status from public.commerce_invoices where id=j)<>'delivered' then raise exception 'Delivery state missing'; end if;
 perform public.commerce_request_invoice(p||jsonb_build_object('id',k,'digest',repeat('c',64)));
 perform public.commerce_admin_command('issue',quote||jsonb_build_object('id',k),'fixture-admin-1');
 perform public.commerce_admin_command('save_method',jsonb_build_object('id',m,'version',1,'kind','bank_transfer','label','Fixture bank','currency','USD','payee','Fixture business','instructions','Isolated test receiving instructions','acceptance_reference','Fixture account acceptance','active',false,'business_confirmed',true,'catalog_accepted',true),'fixture-admin-1');
 begin
  perform public.commerce_accept_invoice(k,u,2,'launch-2026-11-v1');
  raise exception 'Disabled method accepted' using errcode='22000';
 exception when raise_exception then null; end;
 begin
  update public.commerce_invoices set status='paid' where id=k;
  raise exception 'Direct unaudited payment write' using errcode='22000';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ declare t text; f text; begin
 foreach t in array array['commerce_payment_methods','commerce_invoices','commerce_receipts','commerce_memberships','commerce_events'] loop
  if not(select relrowsecurity from pg_class where oid=('public.'||t)::regclass) then raise exception 'Missing RLS on %',t; end if;
  if has_table_privilege('anon','public.'||t,'SELECT') or has_table_privilege('authenticated','public.'||t,'SELECT') or has_table_privilege('service_role','public.'||t,'INSERT,UPDATE,DELETE') then raise exception 'Unexpected grants on %',t; end if;
 end loop;
 foreach f in array array['public.commerce_request_invoice(jsonb)','public.commerce_accept_invoice(uuid,uuid,integer,text)','public.commerce_admin_command(text,jsonb,text)'] loop
  if has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE') or not has_function_privilege('service_role',f,'EXECUTE') then raise exception 'Unexpected function grants'; end if;
 end loop;
end $$;
select 'manual_invoice_full_lifecycle_passed' as result;
