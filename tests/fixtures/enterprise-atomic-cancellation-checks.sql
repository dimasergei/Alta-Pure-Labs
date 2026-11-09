\set ON_ERROR_STOP on
-- Run after the atomic reservation and two-session race fixtures.
\i tests/fixtures/enterprise-atomic-cancellation.sql

do $$
declare v_reservation uuid; v_release uuid; v_lot uuid; v_before integer; v_after integer;
begin
 select id,lot_id into v_reservation,v_lot
 from public.enterprise_inventory_events
 where idempotency_key='fixture-atomic-0002' and event_kind='reserve';
 if v_reservation is null then raise exception 'Missing fixture reservation'; end if;
 select reserved into v_before from public.enterprise_inventory_lots where id=v_lot;
 v_release := public.enterprise_cancel_reservation(
  v_reservation,'fixture-cancel-0001','fixture-admin');
 if v_release is null then raise exception 'No cancellation event returned'; end if;
 select reserved into v_after from public.enterprise_inventory_lots where id=v_lot;
 if v_after <> v_before-6 then raise exception 'Cancellation stock mismatch'; end if;
 begin
  perform public.enterprise_cancel_reservation(v_reservation,'fixture-cancel-0002','fixture-admin');
  raise exception 'Double cancellation was accepted' using errcode='22000';
 exception when unique_violation then null;
 end;
 begin
  perform public.enterprise_cancel_reservation(
   '00000000-0000-4000-8000-000000000099','fixture-cancel-0003','fixture-admin');
  raise exception 'Unknown reservation was accepted' using errcode='22000';
 exception when sqlstate 'P0001' then null;
 end;
 select reserved into v_after from public.enterprise_inventory_lots where id=v_lot;
 if v_after <> v_before-6 then raise exception 'Failed cancellation modified stock'; end if;
 if (select count(*) from public.enterprise_inventory_events
     where event_kind='release' and reason='reservation:'||v_reservation::text) <> 1 then
   raise exception 'Expected exactly one cancellation event';
 end if;
end $$;

do $$
begin
 if has_function_privilege('anon',
   'public.enterprise_cancel_reservation(uuid,text,text)','EXECUTE') or
    has_function_privilege('authenticated',
   'public.enterprise_cancel_reservation(uuid,text,text)','EXECUTE') then
   raise exception 'Browser role can cancel reservations';
 end if;
 if not has_function_privilege('service_role',
   'public.enterprise_cancel_reservation(uuid,text,text)','EXECUTE') then
   raise exception 'Service role cannot cancel reservations';
 end if;
end $$;
select 'enterprise_atomic_cancellation_fixture_passed' as result;
