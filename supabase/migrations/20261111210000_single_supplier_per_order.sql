begin;

-- Route a new invoice to Lotus only when every order line has a verified
-- supplier mapping and the destination is US. Otherwise keep every line manual.
create or replace function commerce_internal.fulfillment_seed(p_invoice uuid)
returns void language plpgsql security definer
set search_path=pg_catalog,pg_temp as $$
declare
 r public.commerce_invoices%rowtype;
 all_mapped boolean;
 lotus_order boolean;
begin
 select * into r from public.commerce_invoices where id=p_invoice;
 if r.id is null or r.kind<>'goods' or r.status not in ('paid','processing') then return; end if;
 select coalesce(bool_and(m.product is not null),false) into all_mapped
 from jsonb_array_elements(coalesce(r.request_data->'items','[]'::jsonb)) x
 left join public.commerce_supplier_mappings m on m.variant_key=x->>'id'||'|'||(x->>'size');
 lotus_order:=r.request_data->'address'->>'country'='US' and all_mapped;
 insert into public.commerce_fulfillment_items(invoice_id,variant_key,item,route,supplier_name,product,vials)
 select r.id,x->>'id'||'|'||(x->>'size'),x,
   case when lotus_order then 'lotus' else 'manual' end,
   case when lotus_order then 'Lotus' else '' end,
   case when lotus_order then m.product else null end,
   case when lotus_order then m.vials else null end
 from jsonb_array_elements(coalesce(r.request_data->'items','[]'::jsonb)) x
 left join public.commerce_supplier_mappings m on m.variant_key=x->>'id'||'|'||(x->>'size')
 where r.id=p_invoice on conflict do nothing;
end $$;

-- Cancellation releases the complete order to the manual supplier workflow.
create or replace function public.commerce_fulfillment_release_lotus(p_invoice uuid,p_lease uuid)
returns void language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 perform 1 from public.commerce_supplier_jobs
 where invoice_id=p_invoice and lease_id=p_lease and lease_until>now() and takeover_requested for update;
 if not found then raise exception 'Manual takeover lease changed' using errcode='40001'; end if;
 if exists(select 1 from public.commerce_fulfillment_items where invoice_id=p_invoice and status in ('shipped','delivered')) then
  raise exception 'Cannot switch suppliers after any line has shipped';
 end if;
 update public.commerce_fulfillment_items set route='manual',supplier_name='',product=null,vials=null,
   status='pending',note='Lotus cancellation reconciled; assign one replacement supplier for the complete order.',
   version=version+1,updated_at=now() where invoice_id=p_invoice;
 update public.commerce_supplier_jobs set status='cancelled',provider_status='cancelled',last_error=null,
   lease_id=null,lease_until=null,updated_at=now() where invoice_id=p_invoice;
 insert into public.commerce_events(invoice_id,action,actor,details)
 values(p_invoice,'lotus_manual_takeover','fulfillment-worker','{}');
end $$;

-- Admin assignment changes routing for every line in a single transaction.
create or replace function public.commerce_fulfillment_admin(p_invoice uuid,p_data jsonb)
returns void language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare
 r public.commerce_invoices%rowtype;
 j public.commerce_supplier_jobs%rowtype;
 f public.commerce_fulfillment_items%rowtype;
 m public.commerce_supplier_mappings%rowtype;
 a text:=p_data->>'action';
begin
 select * into j from public.commerce_supplier_jobs where invoice_id=p_invoice for update;
 if j.lease_until>now() then raise exception 'Supplier request in progress; refresh shortly' using errcode='40001'; end if;
 select * into r from public.commerce_invoices where id=p_invoice for update;
 if r.id is null or r.kind<>'goods' or r.status not in ('paid','processing','shipped') then raise exception 'Paid goods order required'; end if;
 if length(trim(coalesce(p_data->>'note','')))<8 or length(p_data->>'note')>2000 then raise exception 'Audit note required'; end if;
 perform commerce_internal.fulfillment_seed(p_invoice);
 if a='takeover' then
  if j.invoice_id is null or j.status in ('shipped','cancelled') then raise exception 'No cancellable Lotus job'; end if;
  update public.commerce_supplier_jobs set takeover_requested=true,status='queued',retry_count=0,next_attempt_at=now(),updated_at=now() where invoice_id=p_invoice;
 elsif a='retry' then
  if j.invoice_id is null or j.status<>'blocked' or j.takeover_requested then raise exception 'Only blocked jobs can be retried'; end if;
  update public.commerce_supplier_jobs set status='queued',retry_count=0,next_attempt_at=now(),updated_at=now() where invoice_id=p_invoice;
 else
  select * into f from public.commerce_fulfillment_items where invoice_id=p_invoice and variant_key=p_data->>'variant_key' for update;
  if f.invoice_id is null or f.version is distinct from (p_data->>'version')::integer then raise exception 'Allocation changed' using errcode='40001'; end if;
  if a='assign' then
   if exists(select 1 from public.commerce_fulfillment_items where invoice_id=p_invoice and status in ('shipped','delivered')) then raise exception 'Cannot reassign an order after any line shipped'; end if;
   if p_data->>'route'='manual' and length(trim(coalesce(p_data->>'supplier_name',''))) between 2 and 180 then
    if (j.payload is not null or j.supplier_id is not null) and not (j.status='cancelled' and j.provider_status='cancelled') then
     raise exception 'Cancel Lotus and confirm cancellation before assigning a manual supplier';
    end if;
    update public.commerce_fulfillment_items set route='manual',supplier_name=trim(p_data->>'supplier_name'),product=null,vials=null,
      status='pending',note=p_data->>'note',version=version+1,updated_at=now() where invoice_id=p_invoice;
    update public.commerce_supplier_jobs set status='cancelled',provider_status='cancelled',last_error=null,updated_at=now()
      where invoice_id=p_invoice and payload is null and supplier_id is null;
   elsif p_data->>'route'='lotus' then
    if j.payload is not null or j.supplier_id is not null or j.takeover_requested or r.status not in ('paid','processing')
      or r.request_data->'address'->>'country'<>'US' then raise exception 'Cannot add to submitted Lotus order'; end if;
    if exists(
      select 1 from jsonb_array_elements(coalesce(r.request_data->'items','[]'::jsonb)) x
      left join public.commerce_supplier_mappings mm on mm.variant_key=x->>'id'||'|'||(x->>'size')
      where mm.product is null
    ) then raise exception 'Lotus must map every line before the complete order can be assigned'; end if;
    if not exists(select 1 from public.commerce_supplier_settings where enabled and verified_at is not null) then raise exception 'Verified active Lotus mapping required'; end if;
    update public.commerce_fulfillment_items fi set route='lotus',supplier_name='Lotus',product=mm.product,vials=mm.vials,
      status='pending',note=p_data->>'note',version=fi.version+1,updated_at=now()
    from public.commerce_supplier_mappings mm where fi.invoice_id=p_invoice and mm.variant_key=fi.variant_key;
    insert into public.commerce_supplier_jobs(invoice_id,reference) values(p_invoice,'ALTA-'||p_invoice::text)
      on conflict(invoice_id) do update set status='queued',next_attempt_at=now(),retry_count=0,takeover_requested=false,updated_at=now();
   else raise exception 'Choose one supplier route for the complete order'; end if;
  elsif a='shipment' then
   if p_data->>'status' not in ('ordered','shipped','delivered') or p_data->>'status' is null
    or (f.route='lotus' and not(f.status='shipped' and p_data->>'status'='delivered'))
    or f.status='delivered' or (f.status='shipped' and p_data->>'status'<>'delivered') then raise exception 'Invalid fulfillment transition'; end if;
   if p_data->>'status'='delivered' and f.status<>'shipped' then raise exception 'Confirm dispatch first'; end if;
   if length(f.supplier_name)<2 then raise exception 'Assign supplier first'; end if;
   if p_data->>'status' in ('shipped','delivered') and (length(trim(coalesce(p_data->>'tracking_carrier','')))<2 or length(trim(coalesce(p_data->>'tracking_number','')))<4) then raise exception 'Carrier and tracking required'; end if;
   update public.commerce_fulfillment_items set status=p_data->>'status',tracking_carrier=left(coalesce(p_data->>'tracking_carrier',''),100),
    tracking_number=left(coalesce(p_data->>'tracking_number',''),160),note=p_data->>'note',version=version+1
   where invoice_id=p_invoice and variant_key=p_data->>'variant_key';
  else raise exception 'Unknown fulfillment action'; end if;
 end if;
 insert into public.commerce_events(invoice_id,action,actor,details) values(p_invoice,'fulfillment_'||a,'admin',p_data);
 perform commerce_internal.fulfillment_rollup(p_invoice);
end $$;

-- Defense in depth: no transaction may commit mixed routes or suppliers.
create or replace function commerce_internal.fulfillment_single_supplier_guard()
returns trigger language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 if exists(select 1 from public.commerce_fulfillment_items where invoice_id=new.invoice_id
   group by invoice_id having count(distinct route)>1 or count(distinct supplier_name)>1) then
  raise exception 'All lines in an order must use one supplier and one route';
 end if;
 return null;
end $$;
create constraint trigger commerce_fulfillment_single_supplier_guard
after insert or update on public.commerce_fulfillment_items
deferrable initially deferred for each row execute function commerce_internal.fulfillment_single_supplier_guard();

revoke all on function commerce_internal.fulfillment_seed(uuid),commerce_internal.fulfillment_single_supplier_guard() from public,anon,authenticated,service_role;
revoke all on function public.commerce_fulfillment_release_lotus(uuid,uuid),public.commerce_fulfillment_admin(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.commerce_fulfillment_release_lotus(uuid,uuid),public.commerce_fulfillment_admin(uuid,jsonb) to service_role;
commit;
