\set ON_ERROR_STOP on
-- Disposable PostgreSQL 17 only; production SQL is never executed here.
\i tests/fixtures/enterprise-inventory-schema-checks.sql
\i tests/fixtures/enterprise-atomic-reservation.sql

-- Mimic Supabase's service_role BYPASSRLS attribute in the isolated fixture.
alter role service_role bypassrls;
do $$
declare v_lot uuid; v_event uuid; v_reserved integer;
begin
 select id into v_lot from public.enterprise_inventory_lots where lot_number='FIXTURE-LOT-1';
 -- A quarantined lot must never be reservable.
 begin
  perform public.enterprise_reserve_inventory(v_lot,1,'fixture-atomic-0001','fixture-admin');
  raise exception 'Quarantine reservation unexpectedly succeeded';
 exception when sqlstate 'P0001' then null;
 end;
 update public.enterprise_inventory_lots set status='released',
  evidence_reference='fixture-reviewed-coa', reviewed_by='fixture-quality-lead',
  reviewed_at=now() where id=v_lot;
 -- Simulate authorized backend service role, not anon/authenticated.
 set local role service_role;
 v_event:=public.enterprise_reserve_inventory(v_lot,6,'fixture-atomic-0002','fixture-admin');
 if v_event is null then raise exception 'No event returned'; end if;
 select reserved into v_reserved from public.enterprise_inventory_lots where id=v_lot;
 if v_reserved<>6 then raise exception 'Expected 6 reserved, got %',v_reserved; end if;
 begin
  perform public.enterprise_reserve_inventory(v_lot,5,'fixture-atomic-0003','fixture-admin');
  raise exception 'Oversell unexpectedly succeeded';
 exception when sqlstate 'P0001' then null;
 end;
 begin
  perform public.enterprise_reserve_inventory(v_lot,1,'fixture-atomic-0002','fixture-admin');
  raise exception 'Duplicate idempotency key unexpectedly succeeded';
 exception when unique_violation then null;
 end;
 select reserved into v_reserved from public.enterprise_inventory_lots where id=v_lot;
 if v_reserved<>6 then raise exception 'Failed attempt changed stock'; end if;
 if (select count(*) from public.enterprise_inventory_events where event_kind='reserve')<>1 then
  raise exception 'Expected exactly one reservation event';
 end if;
 reset role;
end $$;
do $$
begin
 if has_function_privilege('anon',
   'public.enterprise_reserve_inventory(uuid,integer,text,text)','EXECUTE')
   or has_function_privilege('authenticated',
   'public.enterprise_reserve_inventory(uuid,integer,text,text)','EXECUTE') then
   raise exception 'Browser roles must not execute reservation function';
 end if;
 if not has_function_privilege('service_role',
   'public.enterprise_reserve_inventory(uuid,integer,text,text)','EXECUTE') then
   raise exception 'Backend cannot execute reservation function';
 end if;
end $$;
select 'enterprise_atomic_reservation_fixture_passed' as result;
