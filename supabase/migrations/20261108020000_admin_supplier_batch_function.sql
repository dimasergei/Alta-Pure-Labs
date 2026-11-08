create or replace function public.create_supplier_batch(
  p_supplier_id uuid,
  p_name text,
  p_order_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch_id uuid;
  v_supplier record;
  v_order record;
  v_item record;
  v_items jsonb := '[]'::jsonb;
  v_item_count integer := 0;
begin
  if p_supplier_id is null then
    raise exception 'Supplier is required.';
  end if;

  if p_name is null or length(btrim(p_name)) = 0 then
    raise exception 'Batch name is required.';
  end if;

  if p_order_ids is null or array_length(p_order_ids, 1) = 0 then
    raise exception 'At least one order is required.';
  end if;

  if array_length(p_order_ids, 1) > 200 then
    raise exception 'A batch can include at most 200 orders.';
  end if;

  select *
  into v_supplier
  from public.suppliers
  where id = p_supplier_id
    and active = true;

  if not found then
    raise exception 'Active supplier not found.';
  end if;

  if exists (
    select 1
    from public.supplier_batches
    where name = p_name
  ) then
    raise exception 'That batch name is already in use.';
  end if;

  insert into public.supplier_batches (
    supplier_id,
    name,
    status
  )
  values (
    p_supplier_id,
    btrim(p_name),
    'draft'
  )
  returning id into v_batch_id;

  for v_order in
    select
      o.id,
      o.order_number,
      o.fulfillment_status,
      o.payment_status,
      o.archived
    from public.store_orders o
    where o.id = any(p_order_ids)
  loop
    if v_order.archived then
      raise exception 'Archived orders cannot be added to a supplier batch.';
    end if;

    if v_order.payment_status not in ('paid', 'partially_refunded') then
      raise exception 'Only paid orders can be added to a supplier batch.';
    end if;

    if v_order.fulfillment_status not in (
      'unfulfilled',
      'processing',
      'awaiting_supplier'
    ) then
      raise exception 'Only unfulfilled orders can be added to a supplier batch.';
    end if;

    for v_item in
      select
        i.id,
        i.product_id,
        i.product_name,
        i.variant_size,
        i.quantity,
        i.supplier_sku,
        i.supplier_name,
        i.lot_number,
        i.fulfillment_notes
      from public.store_order_items i
      where i.order_id = v_order.id
    loop
      insert into public.supplier_batch_items (
        batch_id,
        order_id,
        order_item_id,
        product_name,
        variant_size,
        quantity,
        supplier_sku,
        supplier_name,
        lot_number,
        fulfillment_notes
      )
      values (
        v_batch_id,
        v_order.id,
        v_item.id,
        v_item.product_name,
        v_item.variant_size,
        v_item.quantity,
        v_item.supplier_sku,
        v_item.supplier_name,
        v_item.lot_number,
        v_item.fulfillment_notes
      );

      v_items := v_items || jsonb_build_object(
        'id', v_item.id,
        'order_id', v_order.id,
        'order_item_id', v_item.id,
        'product_name', v_item.product_name,
        'variant_size', v_item.variant_size,
        'quantity', v_item.quantity,
        'supplier_sku', v_item.supplier_sku,
        'supplier_name', v_item.supplier_name,
        'lot_number', v_item.lot_number,
        'fulfillment_notes', v_item.fulfillment_notes
      );

      v_item_count := v_item_count + 1;
    end loop;

    if v_item_count = 0 then
      raise exception 'Order % has no items.', v_order.order_number;
    end if;
  end loop;

  return jsonb_build_object(
    'batch_id', v_batch_id,
    'supplier_id', p_supplier_id,
    'name', btrim(p_name),
    'status', 'draft',
    'item_count', v_item_count,
    'items', v_items
  );
end;
$$;
