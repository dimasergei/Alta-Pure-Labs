\set ON_ERROR_STOP on
-- Disposable PostgreSQL only. Never execute this fixture against a hosted project.
do $$ begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
end $$;
-- Supabase service_role has BYPASSRLS; reproduce that in this disposable database.
-- Table DML grants remain independently restricted and are tested below.
alter role service_role bypassrls;
\i supabase/migrations/20261110025900_customer_request_operations.sql
set role service_role;
do $$
declare p jsonb; r jsonb; c jsonb; ok boolean; n integer;
 id1 uuid:='10000000-0000-4000-8000-000000000001';
 id2 uuid:='10000000-0000-4000-8000-000000000002';
 digest text:=repeat('a',64);
begin
 p:=jsonb_build_object('type','contact','name','Fixture researcher','email','fixture@example.test','consent',true,'message','Fixture message only');
 r:=public.enterprise_submit_customer_request(id1,digest,p,jsonb_build_object('to',jsonb_build_array('fixture@example.test'),'text','fixture only'));
 if r->>'created'<>'true' then raise exception 'First submission not created'; end if;
 r:=public.enterprise_submit_customer_request(id1,digest,p,null);
 if r->>'created'<>'false' then raise exception 'Duplicate submission recreated'; end if;
 select count(*) into n from public.enterprise_customer_request_events where request_id=id1 and kind='submitted';
 if n<>1 then raise exception 'Duplicate submission audit'; end if;
 begin
  perform public.enterprise_submit_customer_request(id1,repeat('b',64),p,null);
  raise exception 'Digest conflict was accepted' using errcode='22000';
 exception when unique_violation then null; end;
 c:=public.enterprise_claim_request_email(id1,null);
 if c->>'claimed'<>'true' then raise exception 'First email claim failed'; end if;
 r:=public.enterprise_claim_request_email(id1,null);
 if r->>'claimed'<>'false' then raise exception 'Concurrent email claim allowed'; end if;
 ok:=public.enterprise_finish_request_email(id1,gen_random_uuid(),'accepted','fixture-message',null);
 if ok then raise exception 'Wrong worker can complete delivery'; end if;
 ok:=public.enterprise_finish_request_email(id1,(c->>'claim')::uuid,'accepted','fixture-message',null);
 if not ok then raise exception 'Valid worker cannot complete delivery'; end if;
 r:=public.enterprise_claim_request_email(id1,null);
 if r->>'claimed'<>'false' or r->>'email_status'<>'accepted' then raise exception 'Accepted email can be resent'; end if;
 r:=public.enterprise_update_customer_request(id1,1,'in_review','Fixture assignment','Customer-visible response','fixture-staff','fixture-server-request');
 if r->>'version'<>'2' then raise exception 'Request version did not advance'; end if;
 begin
  perform public.enterprise_update_customer_request(id1,1,'resolved','Stale update attempt','','','fixture-server-request');
  raise exception 'Lost update was accepted' using errcode='22000';
 exception when serialization_failure then null; end;
 if (select public_reply from public.enterprise_customer_requests where id=id1)<>'Customer-visible response' then raise exception 'Public response changed on failed update'; end if;
 begin
  update public.enterprise_customer_requests set status='resolved' where id=id1;
  raise exception 'Backend bypassed audited update' using errcode='22000';
 exception when insufficient_privilege then null; end;
 begin
  insert into public.enterprise_customer_request_events(request_id,kind,actor_reference) values(id1,'submitted','forged');
  raise exception 'Backend appended an unaudited event' using errcode='22000';
 exception when insufficient_privilege then null; end;
 perform public.enterprise_submit_customer_request(id2,digest,p,jsonb_build_object('text','retry fixture'));
 for n in 1..5 loop
  c:=public.enterprise_claim_request_email(id2,null);
  if c->>'claimed'<>'true' then raise exception 'Expected allowed bounded retry %',n; end if;
  perform public.enterprise_finish_request_email(id2,(c->>'claim')::uuid,'failed',null,'fixture_failure');
 end loop;
 r:=public.enterprise_claim_request_email(id2,null);
 if r->>'claimed'<>'false' or r->>'email_status'<>'needs_review' then raise exception 'Retry limit not enforced'; end if;
end $$;
reset role;
-- Simulate an old first attempt as database owner, solely in this disposable fixture.
update public.enterprise_customer_requests set email_status='failed',email_attempts=1,first_email_attempt_at=now()-interval '24 hours' where id='10000000-0000-4000-8000-000000000002';
set role service_role;
do $$ declare r jsonb; begin
 r:=public.enterprise_claim_request_email('10000000-0000-4000-8000-000000000002',null);
 if r->>'email_status'<>'needs_review' then raise exception 'Expired provider idempotency window permitted resend'; end if;
end $$;
reset role;
do $$ declare t text; fn text; begin
 foreach t in array array['enterprise_customer_requests','enterprise_customer_request_events'] loop
  if not (select relrowsecurity from pg_class where oid=('public.'||t)::regclass) then raise exception 'RLS missing on %',t; end if;
  if has_table_privilege('anon','public.'||t,'SELECT') or has_table_privilege('authenticated','public.'||t,'SELECT') then raise exception 'Browser can read requests'; end if;
  if has_table_privilege('service_role','public.'||t,'INSERT') or has_table_privilege('service_role','public.'||t,'UPDATE') or has_table_privilege('service_role','public.'||t,'DELETE') then raise exception 'Unaudited write privilege'; end if;
 end loop;
 foreach fn in array array[
 'public.enterprise_submit_customer_request(uuid,text,jsonb,jsonb)',
 'public.enterprise_claim_request_email(uuid,jsonb)',
 'public.enterprise_finish_request_email(uuid,uuid,text,text,text)',
 'public.enterprise_update_customer_request(uuid,integer,text,text,text,text,text)'] loop
  if has_function_privilege('anon',fn,'EXECUTE') or has_function_privilege('authenticated',fn,'EXECUTE') then raise exception 'Browser can call %',fn; end if;
  if not has_function_privilege('service_role',fn,'EXECUTE') then raise exception 'Backend cannot call %',fn; end if;
 end loop;
end $$;
select 'customer_request_operations_fixture_passed' as result;
