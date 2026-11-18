-- Standalone personal stock spreadsheet. No catalog, order or supplier dependency.
-- New objects only; existing commerce and enterprise inventory objects are untouched.
create table public.pure_stock_items (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique check (sku ~ '^[A-Z0-9][A-Z0-9._-]{0,63}$'),
  product_name text not null check (length(btrim(product_name)) between 1 and 160 and product_name !~ '[[:cntrl:]]'),
  strength text not null default '' check (length(strength) <= 80 and strength !~ '[[:cntrl:]]'),
  unit text not null default 'vial' check (unit in ('vial','pen','bottle','pack','unit')),
  quantity integer check (quantity >= 0),
  minimum integer not null default 0 check (minimum >= 0),
  unit_cost numeric(12,2) check (unit_cost >= 0),
  currency text not null default 'USD' check (currency in ('CAD','USD')),
  location text not null default '' check (length(location) <= 120 and location !~ '[[:cntrl:]]'),
  notes text not null default '' check (length(notes) <= 2000),
  archived boolean not null default false,
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.pure_stock_requests (
  request_id uuid primary key,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  response jsonb not null check (jsonb_typeof(response) = 'object'),
  actor_reference text not null check (length(actor_reference) between 1 and 180),
  created_at timestamptz not null default now()
);

create table public.pure_stock_events (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.pure_stock_items(id) on delete restrict,
  request_id uuid not null,
  action text not null check (action in ('create','update','adjust','archive','restore','import')),
  mode text check (mode in ('add','remove','set')),
  sku text not null,
  product_name text not null,
  strength text not null,
  quantity_before integer check (quantity_before >= 0),
  quantity_after integer check (quantity_after >= 0),
  reason text not null default '' check (length(reason) <= 500),
  changes jsonb not null check (jsonb_typeof(changes) = 'object'),
  actor_reference text not null check (length(actor_reference) between 1 and 180),
  created_at timestamptz not null default now(),
  unique (request_id, item_id)
);
create index pure_stock_events_history_idx on public.pure_stock_events (created_at desc, id desc);
create index pure_stock_events_item_idx on public.pure_stock_events (item_id, created_at desc);

alter table public.pure_stock_items enable row level security;
alter table public.pure_stock_requests enable row level security;
alter table public.pure_stock_events enable row level security;

revoke all on public.pure_stock_items, public.pure_stock_requests, public.pure_stock_events from public, anon, authenticated, service_role;
grant select, insert, update on public.pure_stock_items to service_role;
grant select, insert on public.pure_stock_requests, public.pure_stock_events to service_role;
-- No role used by the application can update/delete audit history or delete stock.

create function public.pure_stock_normalize_item(p_item jsonb, p_partial boolean default false)
returns jsonb language plpgsql security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  result jsonb; k text; v jsonb; s text; n numeric;
  allowed text[] := array['sku','product_name','strength','unit','quantity','minimum','unit_cost','currency','location','notes'];
begin
  if p_partial is null or p_item is null or jsonb_typeof(p_item) <> 'object'
    or exists(select 1 from jsonb_object_keys(p_item) key where not key = any(allowed))
    or (p_partial and (p_item = '{}'::jsonb or p_item ? 'quantity')) then
    raise exception 'Invalid stock item fields' using errcode='22023';
  end if;
  result := case when p_partial then p_item else
    jsonb_build_object('strength','','unit','vial','quantity',null,'minimum',0,
      'unit_cost',null,'currency','USD','location','','notes','') || p_item end;
  if not p_partial and (not result ? 'sku' or not result ? 'product_name') then
    raise exception 'SKU and product name are required' using errcode='22023';
  end if;
  for k, v in select key, value from jsonb_each(result) loop
    if k in ('quantity','minimum') then
      if k='quantity' and v='null'::jsonb then continue; end if;
      if jsonb_typeof(v)<>'number' then raise exception 'Invalid stock count' using errcode='22023'; end if;
      n := (v #>> '{}')::numeric;
      if n<0 or n>2147483647 or n<>trunc(n) then raise exception 'Invalid stock count' using errcode='22023'; end if;
      result := jsonb_set(result,array[k],to_jsonb(n::integer));
    elsif k='unit_cost' then
      if v='null'::jsonb then continue; end if;
      if jsonb_typeof(v)<>'number' then raise exception 'Invalid stock cost' using errcode='22023'; end if;
      n := (v #>> '{}')::numeric;
      if n<0 or n>9999999999.99 or n*100<>trunc(n*100) then raise exception 'Invalid stock cost' using errcode='22023'; end if;
      result := jsonb_set(result,array[k],to_jsonb(n));
    else
      if jsonb_typeof(v)<>'string' then raise exception 'Invalid stock text' using errcode='22023'; end if;
      s := btrim(v #>> '{}');
      if (k<>'notes' and s ~ '[[:cntrl:]]')
        or (k='notes' and translate(s, chr(9)||chr(10)||chr(13), '') ~ '[[:cntrl:]]') then
        raise exception 'Invalid stock text' using errcode='22023';
      end if;
      if k='sku' then
        s := upper(s);
        if s !~ '^[A-Z0-9][A-Z0-9._-]{0,63}$' then raise exception 'Invalid SKU' using errcode='22023'; end if;
      elsif k='product_name' and length(s) not between 1 and 160 then raise exception 'Invalid product name' using errcode='22023';
      elsif k='strength' and length(s)>80 then raise exception 'Invalid strength' using errcode='22023';
      elsif k='location' and length(s)>120 then raise exception 'Invalid location' using errcode='22023';
      elsif k='notes' and length(s)>2000 then raise exception 'Invalid notes' using errcode='22023';
      elsif k='unit' and s not in ('vial','pen','bottle','pack','unit') then raise exception 'Invalid unit' using errcode='22023';
      elsif k='currency' and s not in ('CAD','USD') then raise exception 'Invalid currency' using errcode='22023';
      end if;
      result := jsonb_set(result,array[k],to_jsonb(s));
    end if;
  end loop;
  return result;
end;
$$;
revoke all on function public.pure_stock_normalize_item(jsonb,boolean) from public, anon, authenticated, service_role;
grant execute on function public.pure_stock_normalize_item(jsonb,boolean) to service_role;

create function public.pure_stock_changes(p_before jsonb, p_after jsonb)
returns jsonb language sql immutable security invoker
set search_path = pg_catalog, pg_temp
as $$
  select coalesce(jsonb_object_agg(key, jsonb_build_object('before', coalesce(p_before->key,'null'::jsonb), 'after', value)), '{}'::jsonb)
  from jsonb_each(p_after)
  where key not in ('id','version','created_at','updated_at')
    and value is distinct from p_before->key;
$$;
revoke all on function public.pure_stock_changes(jsonb,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.pure_stock_changes(jsonb,jsonb) to service_role;

create function public.pure_stock_command(p_request_id uuid, p_payload jsonb, p_actor text)
returns jsonb language plpgsql security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  action_name text; event_action text; mode_name text; reason_text text;
  allowed text[]; prior public.pure_stock_requests%rowtype;
  before_item public.pure_stock_items%rowtype;
  after_item public.pure_stock_items%rowtype;
  normalized jsonb; rows jsonb; item jsonb; merged jsonb; changes jsonb;
  result jsonb; results jsonb := '[]'::jsonb;
  item_id uuid; expected integer; amount bigint; next_quantity bigint;
  item_count integer; archived_value boolean;
begin
  if p_request_id is null or p_payload is null or jsonb_typeof(p_payload)<>'object'
    or p_actor is null or length(p_actor) not between 1 and 180 or p_actor ~ '[[:cntrl:]]' then
    raise exception 'Invalid stock command' using errcode='22023';
  end if;
  action_name := p_payload->>'action';
  if action_name is null or action_name not in ('create','update','adjust','archive','import') then
    raise exception 'Unknown stock action' using errcode='22023';
  end if;
  allowed := case action_name
    when 'create' then array['action','item','reason']
    when 'import' then array['action','items','reason']
    when 'update' then array['action','id','expected_version','item','reason']
    when 'adjust' then array['action','id','expected_version','mode','quantity','reason']
    when 'archive' then array['action','id','expected_version','archived','reason'] end;
  if exists(select 1 from jsonb_object_keys(p_payload) key where not key=any(allowed))
    or (p_payload ? 'reason' and jsonb_typeof(p_payload->'reason')<>'string') then
    raise exception 'Invalid stock command fields' using errcode='22023';
  end if;
  reason_text := btrim(coalesce(p_payload->>'reason',''));
  if length(reason_text)>500 or translate(reason_text, chr(9)||chr(10)||chr(13), '') ~ '[[:cntrl:]]' then
    raise exception 'Invalid stock reason' using errcode='22023';
  end if;

  -- Serialize identical operation IDs before checking their original response.
  -- The lock and every row/event/request write share this one transaction.
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 619827));
  select * into prior from public.pure_stock_requests where request_id=p_request_id;
  if found then
    if prior.payload is distinct from p_payload then
      raise exception 'STOCK_REQUEST_CONFLICT' using errcode='P0001';
    end if;
    return prior.response;
  end if;

  if action_name in ('create','import') then
    if action_name='create' then
      rows := jsonb_build_array(public.pure_stock_normalize_item(p_payload->'item',false));
    else
      if p_payload->'items' is null or jsonb_typeof(p_payload->'items')<>'array'
        or jsonb_array_length(p_payload->'items') not between 1 and 500 then
        raise exception 'Import between 1 and 500 stock items' using errcode='22023';
      end if;
      select jsonb_agg(public.pure_stock_normalize_item(value,false) order by ordinality)
        into rows from jsonb_array_elements(p_payload->'items') with ordinality;
    end if;
    item_count := jsonb_array_length(rows);
    if (select count(distinct value->>'sku') from jsonb_array_elements(rows))<>item_count then
      raise exception 'Duplicate SKU in import' using errcode='23505';
    end if;
    -- This lock only protects the small independent stock spreadsheet capacity.
    perform pg_advisory_xact_lock(619827,1);
    if (select count(*) from public.pure_stock_items)+item_count>5000 then
      raise exception 'STOCK_ITEM_LIMIT' using errcode='P0001';
    end if;
    if exists(select 1 from public.pure_stock_items i join jsonb_array_elements(rows) x on i.sku=x.value->>'sku') then
      raise exception 'SKU already exists' using errcode='23505';
    end if;
    for item in select value from jsonb_array_elements(rows) loop
      insert into public.pure_stock_items (sku,product_name,strength,unit,quantity,minimum,unit_cost,currency,location,notes)
      values (item->>'sku',item->>'product_name',item->>'strength',item->>'unit',
        (item->>'quantity')::integer,(item->>'minimum')::integer,(item->>'unit_cost')::numeric,
        item->>'currency',item->>'location',item->>'notes')
      returning * into after_item;
      insert into public.pure_stock_events
        (item_id,request_id,action,sku,product_name,strength,quantity_before,quantity_after,reason,changes,actor_reference)
      values (after_item.id,p_request_id,action_name,after_item.sku,after_item.product_name,after_item.strength,
        null,after_item.quantity,reason_text,public.pure_stock_changes(null,to_jsonb(after_item)),p_actor);
      results := results || jsonb_build_array(to_jsonb(after_item));
    end loop;
    result := case when action_name='create' then jsonb_build_object('item',results->0) else jsonb_build_object('items',results) end;
  else
    if jsonb_typeof(p_payload->'id') is distinct from 'string'
      or (p_payload->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(p_payload->'expected_version') is distinct from 'number' then
      raise exception 'Invalid stock item or version' using errcode='22023';
    end if;
    if (p_payload->>'expected_version')::numeric not between 1 and 2147483647
      or (p_payload->>'expected_version')::numeric <> trunc((p_payload->>'expected_version')::numeric) then
      raise exception 'Invalid stock version' using errcode='22023';
    end if;
    item_id := (p_payload->>'id')::uuid;
    expected := (p_payload->>'expected_version')::numeric::integer;
    select * into before_item from public.pure_stock_items where id=item_id for update;
    if not found then raise exception 'Stock item not found' using errcode='P0002'; end if;
    if before_item.version<>expected then raise exception 'Stock item changed' using errcode='40001'; end if;
    event_action := action_name;
    if action_name='update' then
      normalized := public.pure_stock_normalize_item(p_payload->'item',true);
      merged := to_jsonb(before_item) || normalized;
      changes := public.pure_stock_changes(to_jsonb(before_item),merged);
      if changes='{}'::jsonb then
        after_item := before_item;
      else
        update public.pure_stock_items set
          sku=merged->>'sku',product_name=merged->>'product_name',strength=merged->>'strength',
          unit=merged->>'unit',minimum=(merged->>'minimum')::integer,unit_cost=(merged->>'unit_cost')::numeric,
          currency=merged->>'currency',location=merged->>'location',notes=merged->>'notes',
          version=version+1,updated_at=now()
        where id=item_id returning * into after_item;
      end if;
    elsif action_name='adjust' then
      mode_name := p_payload->>'mode';
      if mode_name is null or mode_name not in ('add','remove','set')
        or jsonb_typeof(p_payload->'quantity') is distinct from 'number' or length(reason_text)=0 then
        raise exception 'Invalid quantity adjustment' using errcode='22023';
      end if;
      if (p_payload->>'quantity')::numeric not between 0 and 2147483647
        or (p_payload->>'quantity')::numeric<>trunc((p_payload->>'quantity')::numeric) then
        raise exception 'Invalid stock quantity' using errcode='22023';
      end if;
      amount := (p_payload->>'quantity')::numeric::bigint;
      if mode_name<>'set' and amount=0 then raise exception 'Adjustment must be positive' using errcode='22023'; end if;
      if before_item.archived then raise exception 'STOCK_ITEM_ARCHIVED' using errcode='P0001'; end if;
      if before_item.quantity is null and mode_name<>'set' then
        raise exception 'STOCK_QUANTITY_UNCONFIRMED' using errcode='P0001';
      end if;
      next_quantity := case mode_name when 'set' then amount when 'add' then before_item.quantity::bigint+amount else before_item.quantity::bigint-amount end;
      if next_quantity<0 then raise exception 'STOCK_NEGATIVE_QUANTITY' using errcode='P0001'; end if;
      if next_quantity>2147483647 then raise exception 'STOCK_QUANTITY_OVERFLOW' using errcode='P0001'; end if;
      update public.pure_stock_items set quantity=next_quantity::integer,version=version+1,updated_at=now()
        where id=item_id returning * into after_item;
    else
      if jsonb_typeof(p_payload->'archived') is distinct from 'boolean' then
        raise exception 'Invalid archive choice' using errcode='22023';
      end if;
      archived_value := (p_payload->>'archived')::boolean;
      event_action := case when archived_value then 'archive' else 'restore' end;
      if before_item.archived=archived_value then
        after_item := before_item;
      else
        update public.pure_stock_items set archived=archived_value,version=version+1,updated_at=now()
          where id=item_id returning * into after_item;
      end if;
    end if;
    if after_item.version<>before_item.version then
      insert into public.pure_stock_events
        (item_id,request_id,action,mode,sku,product_name,strength,quantity_before,quantity_after,reason,changes,actor_reference)
      values (after_item.id,p_request_id,event_action,mode_name,after_item.sku,after_item.product_name,after_item.strength,
        before_item.quantity,after_item.quantity,reason_text,
        public.pure_stock_changes(to_jsonb(before_item),to_jsonb(after_item)),p_actor);
    end if;
    result := jsonb_build_object('item',to_jsonb(after_item));
  end if;
  insert into public.pure_stock_requests(request_id,payload,response,actor_reference)
    values(p_request_id,p_payload,result,p_actor);
  return result;
end;
$$;
revoke all on function public.pure_stock_command(uuid,jsonb,text) from public, anon, authenticated, service_role;
grant execute on function public.pure_stock_command(uuid,jsonb,text) to service_role;
