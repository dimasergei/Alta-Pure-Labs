-- Disposable-only candidate: not a production migration.
-- Atomic inventory reservation with a unique idempotency event.
-- SECURITY INVOKER: callers require narrowly scoped privileges.
create or replace function public.enterprise_reserve_inventory(
 p_lot_id uuid,
 p_quantity integer,
 p_idempotency_key text,
 p_actor_reference text
) returns uuid
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare v_event_id uuid;
begin
 if p_lot_id is null or p_quantity is null or p_quantity < 1 or p_quantity > 100000
    or p_idempotency_key is null or length(trim(p_idempotency_key)) not between 8 and 180
    or p_actor_reference is null or length(trim(p_actor_reference)) not between 2 and 180 then
   raise exception 'Invalid inventory reservation request.' using errcode = '22023';
 end if;
 -- A prior identical key is an error, not another reservation.
 if exists(select 1 from public.enterprise_inventory_events
   where idempotency_key = p_idempotency_key) then
   raise exception 'Duplicate reservation key.' using errcode = '23505';
 end if;
 -- Conditional UPDATE acquires the lot row lock and serializes concurrent attempts.
 update public.enterprise_inventory_lots
 set reserved = reserved + p_quantity, updated_at = now()
 where id = p_lot_id
   and status = 'released'
   and nullif(trim(coalesce(evidence_reference,'')),'') is not null
   and nullif(trim(coalesce(reviewed_by,'')),'') is not null
   and reviewed_at is not null
   and on_hand - reserved - damaged >= p_quantity
 returning id into v_event_id;
 if not found then
   raise exception 'Lot is not released or stock is unavailable.' using errcode = 'P0001';
 end if;
 insert into public.enterprise_inventory_events
   (lot_id,event_kind,quantity,idempotency_key,actor_reference)
 values (p_lot_id,'reserve',p_quantity,p_idempotency_key,p_actor_reference)
 returning id into v_event_id;
 return v_event_id;
end
$$;
revoke all on function public.enterprise_reserve_inventory(uuid,integer,text,text)
 from public, anon, authenticated;
grant execute on function public.enterprise_reserve_inventory(uuid,integer,text,text)
 to service_role;
