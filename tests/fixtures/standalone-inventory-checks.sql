-- Run after the standalone inventory migration. Every fixture write rolls back.
-- This never reads or changes catalog, order, supplier, payment or other stock data.
begin;
set local role service_role;
do $$
declare
  suffix text := replace(gen_random_uuid()::text,'-','');
  request_id uuid := gen_random_uuid();
  payload jsonb; first_result jsonb; result jsonb; current_item jsonb;
  v_item_id uuid; event_total bigint; item_total bigint; request_total bigint;
begin
  if has_table_privilege('anon','public.pure_stock_items','SELECT')
    or has_table_privilege('authenticated','public.pure_stock_items','SELECT')
    or has_table_privilege('service_role','public.pure_stock_events','UPDATE')
    or has_table_privilege('service_role','public.pure_stock_events','DELETE')
    or has_function_privilege('anon','public.pure_stock_command(uuid,jsonb,text)','EXECUTE')
    or has_function_privilege('authenticated','public.pure_stock_command(uuid,jsonb,text)','EXECUTE') then
    raise exception 'Stock privilege verification failed';
  end if;
  payload := jsonb_build_object('action','create','item',jsonb_build_object(
    'sku','VERIFY-'||suffix,'product_name','Rollback-only stock fixture','quantity',null),'reason','Rollback verification');
  first_result := public.pure_stock_command(request_id,payload,'admin:rollback-verification');
  v_item_id := (first_result->'item'->>'id')::uuid;
  if first_result->'item'->'quantity' is distinct from 'null'::jsonb then raise exception 'Unknown count was lost'; end if;
  result := public.pure_stock_command(request_id,payload,'admin:rollback-verification');
  if result is distinct from first_result then raise exception 'Request replay changed'; end if;
  if (select count(*) from public.pure_stock_events e where e.item_id=v_item_id)<>1 then raise exception 'Creation was not recorded exactly once'; end if;
  begin
    perform public.pure_stock_command(request_id,payload||jsonb_build_object('reason','Different payload'),'admin:rollback-verification');
    raise exception 'Different request payload was accepted';
  exception when sqlstate 'P0001' then
    if sqlerrm<>'STOCK_REQUEST_CONFLICT' then raise; end if;
  end;
  begin
    perform public.pure_stock_command(gen_random_uuid(),jsonb_build_object(
      'action','adjust','id',v_item_id,'expected_version',1,'mode','add','quantity',1,'reason','Unknown quantity'),'admin:rollback-verification');
    raise exception 'Unknown quantity accepted addition';
  exception when sqlstate 'P0001' then
    if sqlerrm<>'STOCK_QUANTITY_UNCONFIRMED' then raise; end if;
  end;
  result := public.pure_stock_command(gen_random_uuid(),jsonb_build_object(
    'action','adjust','id',v_item_id,'expected_version',1,'mode','set','quantity',10,'reason','Opening count'),'admin:rollback-verification');
  if result->'item'->>'quantity'<>'10' or result->'item'->>'version'<>'2' then raise exception 'Set count failed'; end if;
  select count(*) into event_total from public.pure_stock_events;
  select count(*) into request_total from public.pure_stock_requests;
  begin
    perform public.pure_stock_command(gen_random_uuid(),jsonb_build_object(
      'action','adjust','id',v_item_id,'expected_version',1,'mode','remove','quantity',1,'reason','Stale edit'),'admin:rollback-verification');
    raise exception 'Stale edit was accepted';
  exception when serialization_failure then null;
  end;
  begin
    perform public.pure_stock_command(gen_random_uuid(),jsonb_build_object(
      'action','adjust','id',v_item_id,'expected_version',2,'mode','remove','quantity',11,'reason','Too many'),'admin:rollback-verification');
    raise exception 'Negative stock was accepted';
  exception when sqlstate 'P0001' then
    if sqlerrm<>'STOCK_NEGATIVE_QUANTITY' then raise; end if;
  end;
  select to_jsonb(i) into current_item from public.pure_stock_items i where i.id=v_item_id;
  if current_item->>'quantity'<>'10' or current_item->>'version'<>'2'
    or (select count(*) from public.pure_stock_events)<>event_total
    or (select count(*) from public.pure_stock_requests)<>request_total then
    raise exception 'Rejected count change left a partial write';
  end if;
  select count(*) into item_total from public.pure_stock_items;
  begin
    perform public.pure_stock_command(gen_random_uuid(),jsonb_build_object('action','import','items',jsonb_build_array(
      jsonb_build_object('sku','IMPORT-'||suffix,'product_name','Must roll back'),
      jsonb_build_object('sku','VERIFY-'||suffix,'product_name','Existing SKU collision')),'reason','Rollback import'),'admin:rollback-verification');
    raise exception 'Duplicate import was accepted';
  exception when unique_violation then null;
  end;
  if (select count(*) from public.pure_stock_items)<>item_total
    or (select count(*) from public.pure_stock_events)<>event_total
    or (select count(*) from public.pure_stock_requests)<>request_total then
    raise exception 'Failed import left partial rows';
  end if;
  result := public.pure_stock_command(gen_random_uuid(),jsonb_build_object(
    'action','archive','id',v_item_id,'expected_version',2,'archived',true,'reason','Archive verification'),'admin:rollback-verification');
  if result->'item'->'archived'<>'true'::jsonb or result->'item'->>'quantity'<>'10' then raise exception 'Archive changed physical quantity'; end if;
  result := public.pure_stock_command(gen_random_uuid(),jsonb_build_object(
    'action','archive','id',v_item_id,'expected_version',3,'archived',false,'reason','Restore verification'),'admin:rollback-verification');
  if result->'item'->'archived'<>'false'::jsonb then raise exception 'Restore failed'; end if;
end;
$$;
select 'Standalone inventory checks passed; fixture writes are rolled back.' as verification;
rollback;
