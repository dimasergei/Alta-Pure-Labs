-- AltaPure Platinum entitlement fulfillment. No customer grants are trusted from the browser.
-- Gift allocation and monthly credit are created only after verified paid goods orders.
create or replace function commerce_internal.fulfillment_seed(p_invoice uuid)
returns void language plpgsql security definer set search_path=pg_catalog,pg_temp as $fn$
declare
  r public.commerce_invoices%rowtype;
  all_mapped boolean;
  lotus_order boolean;
  eligible_platinum boolean;
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

  eligible_platinum:=exists(
    select 1 from public.commerce_memberships m
    where m.customer_id=r.customer_id and m.plan='elite' and m.revoked_at is null
      and m.starts_at<=coalesce(r.paid_at,now())
      and m.expires_at>coalesce(r.paid_at,now())
  );
  if eligible_platinum then
    -- Distinct gift key ensures customers buying BAC Water still receive one bonus vial.
    -- The verified Lotus mapping is the same exact supplier SKU as bac-3|3 mL.
    insert into public.commerce_fulfillment_items
      (invoice_id,variant_key,item,route,supplier_name,product,vials,note)
    values(
      r.id,'gift-bac-3|3 mL',
      jsonb_build_object('id','gift-bac-3','name','Complimentary BAC Water 3mL - ALTA PLATINUM','size','3 mL','qty',1,'unit_price_usd_cents',0,'membership_gift',true),
      case when lotus_order then 'lotus' else 'manual' end,
      case when lotus_order then 'Lotus' else '' end,
      case when lotus_order then 45 else null end,
      case when lotus_order then 1 else null end,
      'Membership gift: include with the same shipment; do not split this order'
    ) on conflict do nothing;
  end if;
end $fn$;
revoke all on function commerce_internal.fulfillment_seed(uuid) from public,anon,authenticated,service_role;

-- Once per UTC calendar month, on the first qualifying $150+ paid goods order.
-- The $50 is credited for use on a subsequent order; never added during quote.
create or replace function commerce_internal.platinum_monthly_reward()
returns trigger language plpgsql security definer set search_path=pg_catalog,pg_temp as $fn$
declare
  eligible boolean;
  ref text;
  oldref text;
  credit_balance integer;
begin
  if new.kind<>'goods' or new.customer_id is null or new.status=old.status then return new; end if;
  if new.status='paid' and old.status<>'paid'
     and greatest(0,new.subtotal_cents-new.discount_cents)>=15000 then
    eligible:=exists(
      select 1 from public.commerce_memberships m
      where m.customer_id=new.customer_id and m.plan='elite' and m.revoked_at is null
        and m.starts_at<=coalesce(new.paid_at,now())
        and m.expires_at>coalesce(new.paid_at,now())
    );
    if eligible then
      ref:='platinum-monthly-credit:'||new.customer_id::text||':'||to_char(coalesce(new.paid_at,now()) at time zone 'UTC','YYYYMM');
      perform pg_advisory_xact_lock(hashtextextended(ref,7281));
      if not exists(select 1 from public.commerce_balance_events where reference=ref) then
        perform commerce_internal.balance_event(new.customer_id,new.id,'credit',5000,
          'ALTA PLATINUM monthly $50 reward for qualifying paid $150+ merchandise order',ref,'membership-benefits');
        insert into public.commerce_events(invoice_id,action,actor,details)
        values(new.id,'platinum_monthly_credit_granted','membership-benefits',jsonb_build_object('amount_cents',5000,'reference',ref));
      end if;
    end if;
  elsif new.status='refunded' then
    select e.reference into oldref from public.commerce_balance_events e
     where e.invoice_id=new.id and e.asset='credit' and e.delta=5000
       and e.reference like 'platinum-monthly-credit:%' limit 1;
    if oldref is not null then
      perform pg_advisory_xact_lock(hashtextextended(oldref,7281));
      if not exists(select 1 from public.commerce_balance_events where reference=oldref||':refund') then
        select b.credit_cents into credit_balance from public.commerce_balance_accounts b
         where b.customer_id=new.customer_id for update;
        if credit_balance>=5000 then
          perform commerce_internal.balance_event(new.customer_id,new.id,'credit',-5000,
            'Reversed Platinum monthly credit on refunded qualifying order',oldref||':refund','verified-refund');
        else
          insert into public.commerce_events(invoice_id,action,actor,details)
          values(new.id,'platinum_credit_reconciliation_required','membership-benefits',jsonb_build_object('credit_reference',oldref,'unrecovered_cents',5000));
        end if;
      end if;
    end if;
  end if;
  return new;
end $fn$;
revoke all on function commerce_internal.platinum_monthly_reward() from public,anon,authenticated,service_role;
create trigger commerce_platinum_monthly_reward
after update of status on public.commerce_invoices
for each row execute function commerce_internal.platinum_monthly_reward();

-- Eligible paid Platinum orders are claimed ahead of standard queued work.
create or replace function public.commerce_supplier_claim(p_lease uuid)
returns setof public.commerce_supplier_jobs
language plpgsql security definer set search_path=pg_catalog,pg_temp as $fn$
begin
  return query update public.commerce_supplier_jobs j
   set lease_id=p_lease,lease_until=now()+interval '5 minutes',
       attempts=j.attempts+1,updated_at=now()
   where j.invoice_id in (
     select q.invoice_id
     from public.commerce_supplier_jobs q
     join public.commerce_invoices i on i.id=q.invoice_id
     where q.status in ('queued','retry','working','submitted')
       and q.next_attempt_at<=now()
       and (q.lease_until is null or q.lease_until<now())
     order by case when exists(
       select 1 from public.commerce_memberships m
       where m.customer_id=i.customer_id and m.plan='elite' and m.revoked_at is null
         and m.starts_at<=coalesce(i.paid_at,now())
         and m.expires_at>coalesce(i.paid_at,now())
     ) then 0 else 1 end, q.next_attempt_at
     for update of q skip locked limit 1
   ) returning j.*;
end $fn$;
revoke all on function public.commerce_supplier_claim(uuid) from public,anon,authenticated;
grant execute on function public.commerce_supplier_claim(uuid) to service_role;
