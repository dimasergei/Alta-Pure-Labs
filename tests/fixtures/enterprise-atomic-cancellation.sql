-- Candidate migration: full cancellation of one reservation event, atomically.
-- Does not restock shipped units or authorize new sales.
create unique index if not exists enterprise_inventory_release_once_idx
 on public.enterprise_inventory_events (reason)
 where event_kind = 'release' and reason like 'reservation:%';

create or replace function public.enterprise_cancel_reservation(
 p_reservation_event_id uuid,
 p_idempotency_key text,
 p_actor_reference text
) returns uuid
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
 v_reservation public.enterprise_inventory_events%rowtype;
 v_lot public.enterprise_inventory_lots%rowtype;
 v_event_id uuid;
 v_reason text;
begin
 if p_reservation_event_id is null or
    p_idempotency_key is null or length(trim(p_idempotency_key)) not between 8 and 180 or
    p_actor_reference is null or length(trim(p_actor_reference)) not between 2 and 180 then
   raise exception 'Invalid cancellation request.' using errcode = '22023';
 end if;

 select * into v_reservation
 from public.enterprise_inventory_events
 where id = p_reservation_event_id and event_kind = 'reserve';
 if not found then
   raise exception 'Reservation not found.' using errcode = 'P0001';
 end if;

 -- Serialize releases and other inventory changes on the lot row.
 select * into v_lot from public.enterprise_inventory_lots
 where id = v_reservation.lot_id for update;
 if not found then
   raise exception 'Inventory lot not found.' using errcode = 'P0001';
 end if;

 v_reason := 'reservation:' || p_reservation_event_id::text;
 if exists(select 1 from public.enterprise_inventory_events
   where event_kind='release' and reason=v_reason) then
   raise exception 'Reservation already cancelled.' using errcode = '23505';
 end if;
 if v_lot.reserved < v_reservation.quantity then
   raise exception 'Reserved quantity no longer available to release.' using errcode = 'P0001';
 end if;

 update public.enterprise_inventory_lots
 set reserved = reserved - v_reservation.quantity, updated_at = now()
 where id = v_reservation.lot_id;

 insert into public.enterprise_inventory_events
  (lot_id,event_kind,quantity,idempotency_key,actor_reference,reason)
 values
  (v_reservation.lot_id,'release',v_reservation.quantity,p_idempotency_key,p_actor_reference,v_reason)
 returning id into v_event_id;
 return v_event_id;
end
$$;
revoke all on function public.enterprise_cancel_reservation(uuid,text,text)
 from public, anon, authenticated;
grant execute on function public.enterprise_cancel_reservation(uuid,text,text)
 to service_role;
