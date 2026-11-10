\set ON_ERROR_STOP on
-- Disposable DB only. No real recipient or payment.
\i tests/fixtures/manual-invoice-commerce-checks.sql
\i supabase/migrations/20261110061306_invoice_notification_outbox.sql
set role service_role;
do $$
declare i uuid:='50000000-0000-4000-8000-000000000001'; u uuid:='60000000-0000-4000-8000-000000000001';
 n uuid; a uuid; c jsonb; r jsonb; p jsonb;
begin
 if exists(select 1 from public.commerce_notifications) then raise exception 'Old events were backfilled'; end if;
 p:=jsonb_build_object('id',i,'customer_id',u,'customer_email','notify@example.test','customer_name','Notification fixture','kind','goods','plan',null,'digest',repeat('e',64),'request',jsonb_build_object('items','[]'::jsonb),'consent',true,'terms_version','launch-2026-11-v1');
 perform public.commerce_request_invoice(p);
 if(select count(*) from public.commerce_notifications where invoice_id=i)<>2 then raise exception 'Request did not queue both audiences'; end if;
 perform public.commerce_request_invoice(p);
 if(select count(*) from public.commerce_notifications where invoice_id=i)<>2 then raise exception 'Replay duplicated notifications'; end if;
 select id into n from public.commerce_notifications where invoice_id=i and audience='customer';
 select id into a from public.commerce_notifications where invoice_id=i and audience='admin';
 begin
  perform public.commerce_claim_notification(n,'{"from":"sender@example.test","to":["wrong@example.test"],"text":"Wrong recipient must fail"}');
  raise exception 'Recipient substitution accepted' using errcode='22000';
 exception when invalid_parameter_value then null; end;
 c:=public.commerce_claim_notification(n,'{"from":"sender@example.test","to":["notify@example.test"],"text":"Immutable notification body"}');
 if c->>'claimed'<>'true' then raise exception 'First claim failed'; end if;
 r:=public.commerce_claim_notification(n,'{"from":"sender@example.test","to":["notify@example.test"],"text":"Altered body must not overwrite"}');
 if r->>'claimed'<>'false' then raise exception 'Active lease re-claimed'; end if;
 if public.commerce_finish_notification(n,gen_random_uuid(),'accepted','fixture-email',null) then raise exception 'Wrong worker completed'; end if;
 if not public.commerce_finish_notification(n,(c->>'claim')::uuid,'accepted','fixture-email',null) then raise exception 'Correct worker failed'; end if;
 r:=public.commerce_claim_notification(n,null);
 if r->>'state'<>'accepted' or r->>'claimed'<>'false' then raise exception 'Accepted notification replayed'; end if;
 c:=public.commerce_claim_notification(a,'{"from":"sender@example.test","to":["team@example.test"],"text":"Original stored team email"}');
 perform public.commerce_finish_notification(a,(c->>'claim')::uuid,'failed',null,'transport_uncertain');
 begin
  update public.commerce_notifications set state='queued' where id=n;
  raise exception 'Direct backend write allowed' using errcode='22000';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
-- The owner adjusts time only in this isolated fixture.
update public.commerce_notifications set next_attempt_at=now()-interval '1 minute' where audience='admin';
set role service_role;
do $$ declare n uuid; c jsonb; begin
 select id into n from public.commerce_notifications where audience='admin';
 c:=public.commerce_claim_notification(n,'{"from":"different@example.test","to":["other@example.test"],"text":"Changed transport config"}');
 if c->>'claimed'<>'true' or c->'envelope'->>'text'<>'Original stored team email' then raise exception 'Retry envelope not immutable'; end if;
 perform public.commerce_finish_notification(n,(c->>'claim')::uuid,'failed',null,'transport_uncertain');
end $$;
reset role;
update public.commerce_notifications set first_attempt_at=now()-interval '24 hours',next_attempt_at=now()-interval '1 minute' where audience='admin';
set role service_role;
do $$ declare n uuid; c jsonb; begin
 select id into n from public.commerce_notifications where audience='admin';
 c:=public.commerce_claim_notification(n,null);
 if c->>'state'<>'needs_review' then raise exception 'Unsafe retry window allowed'; end if;
end $$;
reset role;
do $$ declare f text; begin
 if has_table_privilege('anon','public.commerce_notifications','SELECT') or has_table_privilege('authenticated','public.commerce_notifications','SELECT') or has_table_privilege('service_role','public.commerce_notifications','INSERT,UPDATE,DELETE') then raise exception 'Unsafe outbox grants'; end if;
 foreach f in array array['public.commerce_claim_notification(uuid,jsonb)','public.commerce_finish_notification(uuid,uuid,text,text,text)'] loop
  if has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE') then raise exception 'Browser can dispatch'; end if;
 end loop;
end $$;
select 'invoice_notification_outbox_passed' as result;
