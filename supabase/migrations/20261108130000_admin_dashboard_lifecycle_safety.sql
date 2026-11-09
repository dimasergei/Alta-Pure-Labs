-- AltaPure Labs admin dashboard lifecycle safeguards.
-- REVIEW ONLY: do not apply until the migration is separately approved.

alter table public.supplier_batches
  add column if not exists archived_at timestamptz;

create index if not exists supplier_batches_active_supplier_created_idx
  on public.supplier_batches (supplier_id, created_at desc)
  where archived_at is null;

create table if not exists public.supplier_batch_audit (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null,
  action text not null check (action in ('deleted')),
  batch_name text not null,
  supplier_id uuid,
  batch_status text not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.supplier_batch_audit enable row level security;
revoke all on table public.supplier_batch_audit from anon, authenticated;

create or replace function public.prevent_duplicate_active_supplier_batch_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Serialize concurrent attempts for the same order item.
  perform 1
  from public.store_order_items
  where id = new.order_item_id
  for update;

  if exists (
    select 1
    from public.supplier_batch_items existing_item
    join public.supplier_batches existing_batch
      on existing_batch.id = existing_item.batch_id
    where existing_item.order_item_id = new.order_item_id
      and existing_batch.archived_at is null
      and existing_batch.status <> 'canceled'
  ) then
    raise exception 'An order item is already assigned to an active supplier batch.';
  end if;

  return new;
end;
$$;

drop trigger if exists supplier_batch_items_prevent_duplicate_active
  on public.supplier_batch_items;

create trigger supplier_batch_items_prevent_duplicate_active
before insert on public.supplier_batch_items
for each row
execute function public.prevent_duplicate_active_supplier_batch_item();

create or replace function public.admin_delete_supplier_batch(p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch public.supplier_batches%rowtype;
  v_items jsonb;
  v_snapshot jsonb;
  v_audit_id uuid;
begin
  if p_batch_id is null then
    raise exception 'Batch ID is required.';
  end if;

  select *
  into v_batch
  from public.supplier_batches
  where id = p_batch_id
  for update;

  if not found then
    raise exception 'Batch not found.';
  end if;

  if v_batch.status not in ('draft', 'canceled') then
    raise exception 'Only draft or canceled batches can be permanently deleted.';
  end if;

  select coalesce(jsonb_agg(to_jsonb(item) order by item.id), '[]'::jsonb)
  into v_items
  from public.supplier_batch_items item
  where item.batch_id = p_batch_id;

  v_snapshot := jsonb_build_object(
    'batch', to_jsonb(v_batch),
    'items', v_items
  );

  insert into public.supplier_batch_audit (
    batch_id,
    action,
    batch_name,
    supplier_id,
    batch_status,
    snapshot
  )
  values (
    v_batch.id,
    'deleted',
    v_batch.name,
    v_batch.supplier_id,
    v_batch.status,
    v_snapshot
  )
  returning id into v_audit_id;

  -- Remove only batch associations. Orders and fulfillment records remain untouched.
  delete from public.supplier_batch_items
  where batch_id = p_batch_id;

  delete from public.supplier_batches
  where id = p_batch_id;

  return jsonb_build_object(
    'deleted', true,
    'batch_id', p_batch_id,
    'audit_id', v_audit_id
  );
end;
$$;

revoke all on function public.admin_delete_supplier_batch(uuid)
  from public, anon, authenticated;
grant execute on function public.admin_delete_supplier_batch(uuid)
  to service_role;

revoke all on function public.prevent_duplicate_active_supplier_batch_item()
  from public, anon, authenticated;
