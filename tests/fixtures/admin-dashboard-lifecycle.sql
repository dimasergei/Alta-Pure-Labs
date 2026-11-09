-- Disposable PostgreSQL fixture for admin batch lifecycle safeguards.
\set ON_ERROR_STOP on

insert into public.suppliers (id, name, active)
values ('50000000-0000-4000-8000-000000000001', 'Lifecycle Test Supplier', true);

insert into public.store_orders (id, order_number, fulfillment_status, payment_status, archived)
values ('60000000-0000-4000-8000-000000000001', 'ALTA-LIFECYCLE-1', 'unfulfilled', 'paid', false);

insert into public.store_order_items (
  id, order_id, product_name, variant_size, quantity
) values (
  '70000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000001',
  'Lifecycle Test Item', 'Test size', 1
);

do $$
declare
  v_first jsonb;
  v_second jsonb;
  v_first_id uuid;
  v_second_id uuid;
  v_audit_count integer;
  v_order_count integer;
  v_duplicate_rejected boolean := false;
begin
  v_first := public.create_supplier_batch(
    '50000000-0000-4000-8000-000000000001',
    'Lifecycle Batch One',
    array['60000000-0000-4000-8000-000000000001']::uuid[]
  );
  v_first_id := (v_first->>'batch_id')::uuid;

  begin
    insert into public.supplier_batch_items (
      batch_id, order_id, order_item_id, product_name, quantity
    ) values (
      v_first_id,
      '60000000-0000-4000-8000-000000000001',
      '70000000-0000-4000-8000-000000000001',
      'Duplicate assignment',
      1
    );
  exception when others then
    if sqlerrm like '%already assigned to an active supplier batch%' then
      v_duplicate_rejected := true;
    else
      raise;
    end if;
  end;

  if not v_duplicate_rejected then
    raise exception 'Duplicate active order-item assignment was not rejected.';
  end if;

  update public.supplier_batches
  set archived_at = now()
  where id = v_first_id;

  v_second := public.create_supplier_batch(
    '50000000-0000-4000-8000-000000000001',
    'Lifecycle Batch Two',
    array['60000000-0000-4000-8000-000000000001']::uuid[]
  );
  v_second_id := (v_second->>'batch_id')::uuid;

  perform public.admin_delete_supplier_batch(v_second_id);

  select count(*) into v_audit_count
  from public.supplier_batch_audit
  where batch_id = v_second_id
    and action = 'deleted'
    and snapshot->'items' <> '[]'::jsonb;

  if v_audit_count <> 1 then
    raise exception 'Deleted batch audit snapshot was not retained.';
  end if;

  select count(*) into v_order_count
  from public.store_orders
  where id = '60000000-0000-4000-8000-000000000001';

  if v_order_count <> 1 then
    raise exception 'Batch deletion unexpectedly removed the related order.';
  end if;
end
$$;
