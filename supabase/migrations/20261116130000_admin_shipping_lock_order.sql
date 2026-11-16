begin;

-- An address change must never race a submitted or leased supplier order.
-- Keep the destination country fixed so fulfillment routing does not change.
create or replace function public.commerce_admin_edit_shipping(
  p_invoice uuid, p_version integer, p_address jsonb, p_note text
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,pg_temp as $$
declare
  r public.commerce_invoices%rowtype;
  old_address jsonb;
  address_key text;
begin
  -- Match fulfillment worker/admin lock order: supplier job, then invoice.
  perform 1 from public.commerce_supplier_jobs
    where invoice_id=p_invoice for update;
  select * into r from public.commerce_invoices where id=p_invoice for update;
  if r.id is null or r.kind<>'goods' or r.status not in ('paid','processing')
     or r.version is distinct from p_version then
    raise exception 'Paid goods order changed or is unavailable' using errcode='40001';
  end if;
  if p_note is null or length(trim(p_note))<8 or length(p_note)>1000
     or p_address is null or jsonb_typeof(p_address)<>'object' then
    raise exception 'A complete address and audit note are required';
  end if;
  old_address:=r.request_data->'address';
  if old_address is null or p_address->>'country' is distinct from old_address->>'country'
     or length(p_address->>'country')<>2
     or jsonb_typeof(p_address->'line1') is distinct from 'string'
     or jsonb_typeof(p_address->'city') is distinct from 'string'
     or jsonb_typeof(p_address->'region') is distinct from 'string'
     or jsonb_typeof(p_address->'postal_code') is distinct from 'string'
     or (p_address ? 'line2' and jsonb_typeof(p_address->'line2') is distinct from 'string')
     or length(p_address->>'line1') not between 3 and 180
     or length(coalesce(p_address->>'line2',''))>180
     or length(p_address->>'city') not between 2 and 80
     or length(p_address->>'region') not between 1 and 80
     or length(p_address->>'postal_code') not between 2 and 20 then
    raise exception 'Address is incomplete or changes the fulfillment country';
  end if;
  for address_key in select jsonb_object_keys(p_address) loop
    if address_key not in ('line1','line2','city','region','postal_code','country') then
      raise exception 'Unexpected address field';
    end if;
  end loop;
  if exists (
    select 1 from public.commerce_supplier_jobs
    where invoice_id=p_invoice and (
      supplier_id is not null or payload is not null or lease_until>now()
      or status in ('submitted','shipped','working')
    )
  ) or exists (
    select 1 from public.commerce_fulfillment_items
    where invoice_id=p_invoice and status in ('ordered','shipped','delivered')
  ) then
    raise exception 'Supplier processing started; reconcile address with supplier' using errcode='40001';
  end if;
  if old_address=p_address then return jsonb_build_object('version',r.version,'unchanged',true); end if;
  update public.commerce_invoices set
    request_data=jsonb_set(request_data,'{address}',p_address),
    version=version+1, updated_at=now()
  where id=p_invoice;
  insert into public.commerce_events(invoice_id,action,actor,details)
  values(p_invoice,'admin_shipping_address_edit','admin:unified-orders',
    jsonb_build_object('before',old_address,'after',p_address,'note',trim(p_note)));
  return jsonb_build_object('version',r.version+1);
end $$;

revoke all on function public.commerce_admin_edit_shipping(uuid,integer,jsonb,text)
  from public,anon,authenticated;
grant execute on function public.commerce_admin_edit_shipping(uuid,integer,jsonb,text)
  to service_role;
commit;
