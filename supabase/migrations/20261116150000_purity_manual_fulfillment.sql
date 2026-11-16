-- New physical orders are fulfilled manually by 99Purity Peptides.
-- Existing supplier history is retained; this migration makes no external calls.
create or replace function commerce_internal.fulfillment_seed(p_invoice uuid)
returns void language plpgsql security definer set search_path=pg_catalog,pg_temp as $fn$
declare
  r public.commerce_invoices%rowtype;
  eligible_platinum boolean;
begin
  select * into r from public.commerce_invoices where id=p_invoice for update;
  if r.id is null or r.kind<>'goods' or r.status not in ('paid','processing') then return; end if;
  -- Seeding is atomic and idempotent. Never reassign an existing shipment or
  -- attach new manual lines to a historical supplier order on a later retry.
  if exists(select 1 from public.commerce_fulfillment_items where invoice_id=r.id)
     or exists(select 1 from public.commerce_supplier_jobs where invoice_id=r.id) then return; end if;

  insert into public.commerce_fulfillment_items
    (invoice_id,variant_key,item,route,supplier_name,product,vials)
  select r.id,x->>'id'||'|'||(x->>'size'),x,'manual','99Purity Peptides',null,null
  from jsonb_array_elements(coalesce(r.request_data->'items','[]'::jsonb)) x
  on conflict do nothing;

  eligible_platinum:=exists(
    select 1 from public.commerce_memberships m
    where m.customer_id=r.customer_id and m.plan='elite' and m.revoked_at is null
      and m.starts_at<=coalesce(r.paid_at,now())
      and m.expires_at>coalesce(r.paid_at,now())
  );
  if eligible_platinum then
    insert into public.commerce_fulfillment_items
      (invoice_id,variant_key,item,route,supplier_name,product,vials,note)
    values(
      r.id,'gift-bac-3|3 mL',
      jsonb_build_object('id','gift-bac-3','name','Complimentary BAC Water 3mL - ALTA PLATINUM','size','3 mL','qty',1,'unit_price_usd_cents',0,'membership_gift',true),
      'manual','99Purity Peptides',null,null,
      'Membership gift: include with the same shipment; do not split this order'
    ) on conflict do nothing;
  end if;
end $fn$;
revoke all on function commerce_internal.fulfillment_seed(uuid) from public,anon,authenticated,service_role;

-- Keep the installed trigger identity so payment settlement still seeds the
-- dashboard, but never enqueue or restart Lotus submissions/cancellations.
create or replace function commerce_internal.lotus_enqueue()
returns trigger language plpgsql security definer set search_path=pg_catalog,pg_temp as $fn$
begin
  if new.kind='goods' and new.status='paid' and old.status is distinct from new.status then
    perform commerce_internal.fulfillment_seed(new.id);
  end if;
  return new;
end $fn$;
revoke all on function commerce_internal.lotus_enqueue() from public,anon,authenticated,service_role;

-- Defense in depth for old workers and cached admin clients. Credentials and
-- mappings remain intact only for read-only historical reconciliation.
update public.commerce_supplier_settings set enabled=false where id=true;
