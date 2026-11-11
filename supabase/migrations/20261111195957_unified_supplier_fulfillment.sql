begin;
create table public.commerce_fulfillment_items (
 invoice_id uuid not null references public.commerce_invoices(id), variant_key text not null,
 item jsonb not null, route text not null check(route in ('lotus','manual')),
 supplier_name text not null default '', product integer, vials integer,
 status text not null default 'pending' check(status in ('pending','ordered','shipped','delivered')),
 tracking_carrier text not null default '', tracking_number text not null default '', note text not null default '',
 version integer not null default 1, updated_at timestamptz not null default now(),
 primary key(invoice_id,variant_key)
);
alter table public.commerce_fulfillment_items enable row level security;
revoke all on public.commerce_fulfillment_items from public,anon,authenticated,service_role;
grant select on public.commerce_fulfillment_items to service_role;
alter table public.commerce_supplier_jobs add column takeover_requested boolean not null default false;
create function commerce_internal.fulfillment_seed(p_invoice uuid) returns void language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 insert into public.commerce_fulfillment_items(invoice_id,variant_key,item,route,supplier_name,product,vials)
 select r.id,x->>'id'||'|'||(x->>'size'),x,
 case when m.product is not null and r.request_data->'address'->>'country'='US' then 'lotus' else 'manual' end,
 case when m.product is not null and r.request_data->'address'->>'country'='US' then 'Lotus' else '' end,m.product,m.vials
 from public.commerce_invoices r cross join lateral jsonb_array_elements(r.request_data->'items') x
 left join public.commerce_supplier_mappings m on m.variant_key=x->>'id'||'|'||(x->>'size')
 where r.id=p_invoice and r.kind='goods' and r.status in ('paid','processing') on conflict do nothing;
end $$;
create or replace function commerce_internal.lotus_enqueue() returns trigger language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 if new.kind='goods' and new.status='paid' and old.status is distinct from new.status then
  perform commerce_internal.fulfillment_seed(new.id);
  if exists(select 1 from public.commerce_supplier_settings where enabled and verified_at is not null and max_order_cents>0)
   and exists(select 1 from public.commerce_fulfillment_items where invoice_id=new.id and route='lotus') then
   insert into public.commerce_supplier_jobs(invoice_id,reference) values(new.id,'ALTA-'||new.id::text) on conflict do nothing;
  end if;
 elsif new.status in ('refunded','void') and old.status is distinct from new.status then
  update public.commerce_supplier_jobs set status='queued',next_attempt_at=now() where invoice_id=new.id and status<>'cancelled';
 end if;return new;
end $$;
-- Do not silently send historical orders. Initialize only already queued, unsubmitted jobs.
select commerce_internal.fulfillment_seed(invoice_id) from public.commerce_supplier_jobs where payload is null;
create function commerce_internal.fulfillment_rollup(p_invoice uuid) returns void language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare r public.commerce_invoices%rowtype; f public.commerce_fulfillment_items%rowtype;
begin
 select * into r from public.commerce_invoices where id=p_invoice for update;
 if not exists(select 1 from public.commerce_fulfillment_items where invoice_id=p_invoice) then return;end if;
 if r.status in ('paid','processing') and not exists(select 1 from public.commerce_fulfillment_items where invoice_id=p_invoice and status not in ('shipped','delivered')) then
  select * into f from public.commerce_fulfillment_items where invoice_id=p_invoice order by variant_key limit 1;
  perform public.commerce_admin_command('status',jsonb_build_object('id',r.id,'version',r.version,'status','shipped','tracking_carrier',f.tracking_carrier,'tracking_number',f.tracking_number,'note','All supplier allocations confirmed dispatched; see fulfillment items for every tracking number.'),'fulfillment-worker');
  select * into r from public.commerce_invoices where id=p_invoice;
 end if;
 if r.status='shipped' and not exists(select 1 from public.commerce_fulfillment_items where invoice_id=p_invoice and status<>'delivered') then
  perform public.commerce_admin_command('status',jsonb_build_object('id',r.id,'version',r.version,'status','delivered','note','All supplier allocations confirmed delivered.'),'fulfillment-worker');
 end if;
end $$;
create function public.commerce_fulfillment_sync(p_invoice uuid,p_lease uuid,p_shipping jsonb default null) returns void language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 perform 1 from public.commerce_supplier_jobs where invoice_id=p_invoice and lease_id=p_lease and lease_until>now() for update;
 if not found then raise exception 'Supplier lease changed' using errcode='40001';end if;
 if p_shipping is not null and (length(coalesce(p_shipping->>'tracking_number',''))<4 or length(coalesce(p_shipping->>'carrier',''))<2 or p_shipping->>'shipped_at' is null) then raise exception 'Dispatch evidence required';end if;
 update public.commerce_fulfillment_items set status=case when p_shipping is null then 'ordered' else 'shipped' end,
 tracking_carrier=coalesce(p_shipping->>'carrier',tracking_carrier),tracking_number=coalesce(p_shipping->>'tracking_number',tracking_number),version=version+1,updated_at=now()
 where invoice_id=p_invoice and route='lotus' and status not in ('shipped','delivered');
 perform commerce_internal.fulfillment_rollup(p_invoice);
end $$;
create function public.commerce_fulfillment_release_lotus(p_invoice uuid,p_lease uuid) returns void language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 perform 1 from public.commerce_supplier_jobs where invoice_id=p_invoice and lease_id=p_lease and lease_until>now() and takeover_requested for update;
 if not found then raise exception 'Manual takeover lease changed' using errcode='40001';end if;
 update public.commerce_fulfillment_items set route='manual',supplier_name='',status='pending',note='Lotus cancellation reconciled; assign a replacement supplier.',version=version+1,updated_at=now() where invoice_id=p_invoice and route='lotus' and status not in ('shipped','delivered');
 update public.commerce_supplier_jobs set status='cancelled',provider_status='cancelled',last_error=null,lease_id=null,lease_until=null,updated_at=now() where invoice_id=p_invoice;
 insert into public.commerce_events(invoice_id,action,actor,details) values(p_invoice,'lotus_manual_takeover','fulfillment-worker','{}');
end $$;
create function public.commerce_fulfillment_admin(p_invoice uuid,p_data jsonb) returns void language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare r public.commerce_invoices%rowtype; j public.commerce_supplier_jobs%rowtype; f public.commerce_fulfillment_items%rowtype; m public.commerce_supplier_mappings%rowtype; a text:=p_data->>'action';
begin
 -- Serialize with worker: no allocation change during an active external request.
 select * into j from public.commerce_supplier_jobs where invoice_id=p_invoice for update;
 if j.lease_until>now() then raise exception 'Supplier request in progress; refresh shortly' using errcode='40001';end if;
 select * into r from public.commerce_invoices where id=p_invoice for update;
 if r.id is null or r.kind<>'goods' or r.status not in ('paid','processing','shipped') then raise exception 'Paid goods order required';end if;
 if length(trim(coalesce(p_data->>'note','')))<8 or length(p_data->>'note')>2000 then raise exception 'Audit note required';end if;
 perform commerce_internal.fulfillment_seed(p_invoice);
 if a='takeover' then
  if j.invoice_id is null or j.status in ('shipped','cancelled') then raise exception 'No cancellable Lotus job';end if;
  update public.commerce_supplier_jobs set takeover_requested=true,status='queued',retry_count=0,next_attempt_at=now(),updated_at=now() where invoice_id=p_invoice;
 elsif a='retry' then
  if j.invoice_id is null or j.status<>'blocked' or j.takeover_requested then raise exception 'Only blocked jobs can be retried';end if;
  update public.commerce_supplier_jobs set status='queued',retry_count=0,next_attempt_at=now(),updated_at=now() where invoice_id=p_invoice;
 else
  select * into f from public.commerce_fulfillment_items where invoice_id=p_invoice and variant_key=p_data->>'variant_key' for update;
  if f.invoice_id is null or f.version is distinct from (p_data->>'version')::integer then raise exception 'Allocation changed' using errcode='40001';end if;
  if a='assign' then
   if f.status in ('shipped','delivered') or (f.route='lotus' and j.payload is not null) then raise exception 'Cancel Lotus before replacing an accepted or uncertain shipment';end if;
   if p_data->>'route'='lotus' then
    if j.payload is not null or j.takeover_requested or r.status not in ('paid','processing') or r.request_data->'address'->>'country'<>'US' then raise exception 'Cannot add to submitted Lotus order';end if;
    select * into m from public.commerce_supplier_mappings where variant_key=f.variant_key;
    if m.product is null or not exists(select 1 from public.commerce_supplier_settings where enabled and verified_at is not null) then raise exception 'Verified active mapping required';end if;
    update public.commerce_fulfillment_items set route='lotus',supplier_name='Lotus',product=m.product,vials=m.vials,status='pending',note=p_data->>'note',version=version+1,updated_at=now() where invoice_id=p_invoice and variant_key=f.variant_key;
    insert into public.commerce_supplier_jobs(invoice_id,reference) values(p_invoice,'ALTA-'||p_invoice::text) on conflict(invoice_id) do update set status='queued',next_attempt_at=now(),retry_count=0;
   elsif p_data->>'route'='manual' and length(trim(coalesce(p_data->>'supplier_name',''))) between 2 and 180 then
    update public.commerce_fulfillment_items set route='manual',supplier_name=trim(p_data->>'supplier_name'),status='pending',note=p_data->>'note',version=version+1,updated_at=now() where invoice_id=p_invoice and variant_key=f.variant_key;
   else raise exception 'Choose supplier and route';end if;
  elsif a='shipment' then
   if p_data->>'status' not in ('ordered','shipped','delivered') or p_data->>'status' is null or (f.route='lotus' and not(f.status='shipped' and p_data->>'status'='delivered'))
    or f.status='delivered' or (f.status='shipped' and p_data->>'status'<>'delivered') then raise exception 'Invalid fulfillment transition';end if;
   if p_data->>'status'='delivered' and f.status<>'shipped' then raise exception 'Confirm dispatch first';end if;
   if length(f.supplier_name)<2 then raise exception 'Assign supplier first';end if;
   if p_data->>'status' in ('shipped','delivered') and (length(trim(coalesce(p_data->>'tracking_carrier','')))<2 or length(trim(coalesce(p_data->>'tracking_number','')))<4) then raise exception 'Carrier and tracking required';end if;
   update public.commerce_fulfillment_items set status=p_data->>'status',tracking_carrier=left(coalesce(p_data->>'tracking_carrier',''),100),tracking_number=left(coalesce(p_data->>'tracking_number',''),160),note=p_data->>'note',version=version+1,updated_at=now() where invoice_id=p_invoice and variant_key=f.variant_key;
  else raise exception 'Unknown fulfillment action';end if;
 end if;
 insert into public.commerce_events(invoice_id,action,actor,details) values(p_invoice,'fulfillment_'||a,'admin',p_data);
 perform commerce_internal.fulfillment_rollup(p_invoice);
end $$;
-- Existing payment/admin tools cannot accidentally mark a partial order complete.
create function commerce_internal.fulfillment_guard() returns trigger language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 if new.status is distinct from old.status and new.status in ('shipped','delivered') and exists(select 1 from public.commerce_fulfillment_items where invoice_id=new.id and (status not in ('shipped','delivered') or (new.status='delivered' and status<>'delivered'))) then raise exception 'Complete every supplier allocation before completing the order';end if;return new;
end $$;
create trigger commerce_fulfillment_guard before update of status on public.commerce_invoices for each row execute function commerce_internal.fulfillment_guard();
revoke all on function commerce_internal.fulfillment_seed(uuid),commerce_internal.fulfillment_rollup(uuid),commerce_internal.fulfillment_guard() from public,anon,authenticated,service_role;
revoke all on function public.commerce_fulfillment_sync(uuid,uuid,jsonb),public.commerce_fulfillment_release_lotus(uuid,uuid),public.commerce_fulfillment_admin(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.commerce_fulfillment_sync(uuid,uuid,jsonb),public.commerce_fulfillment_release_lotus(uuid,uuid),public.commerce_fulfillment_admin(uuid,jsonb) to service_role;
commit;
