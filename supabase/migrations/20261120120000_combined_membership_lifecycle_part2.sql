-- The same paid goods invoice can confer the purchased membership term.
-- No additional customer charge, second order, or separately initiated payment.
CREATE OR REPLACE FUNCTION commerce_internal.retired_membership_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
declare r public.commerce_invoices%rowtype;
begin
  select * into r from public.commerce_invoices where id=new.invoice_id;
  if tg_op='INSERT' then
    perform pg_advisory_xact_lock(hashtextextended(new.customer_id::text,0));
    if r.id is null or r.kind not in ('membership','goods') or r.status<>'paid' or r.paid_at is null
      or not (case when r.kind='membership' then commerce_internal.valid_prepaid_membership_invoice(r.id)
        else commerce_internal.valid_combined_membership_invoice(r.id) end)
      or r.checkout_version is null or r.checkout_version not in ('checkout-2026-11-v8','checkout-interac-cad-2026-11-v2')
      or new.customer_id is distinct from r.customer_id or new.plan is distinct from coalesce(r.plan,r.pricing->'membership_addon'->>'plan') or new.revoked_at is not null
      or new.starts_at is distinct from r.paid_at
      or new.expires_at is distinct from r.paid_at+(case when coalesce(r.request_data->>'billing_period',r.request_data->'membership_addon'->>'period')='monthly' then interval '1 month' else interval '1 year' end)
      or not exists(select 1 from public.commerce_receipts where invoice_id=r.id and method_id=r.method_id and kind='payment' and amount_cents=r.total_cents and currency=r.currency)
      or exists(select 1 from public.commerce_memberships where customer_id=new.customer_id and revoked_at is null and expires_at>now())
    then raise exception 'Verified paid membership activation required' using errcode='P0001';end if;
  elsif (to_jsonb(new)-'revoked_at') is distinct from (to_jsonb(old)-'revoked_at')
    or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at)
    or (new.revoked_at is distinct from old.revoked_at and (new.revoked_at is null or r.status is distinct from 'refunded'
      or not exists(select 1 from public.commerce_receipts where invoice_id=r.id and method_id=r.method_id and kind='refund' and amount_cents=r.total_cents and currency=r.currency)))
  then raise exception 'Membership changes require verified refund reconciliation' using errcode='P0001';end if;
  return new;
end $function$
;
create or replace function commerce_internal.activate_combined_member_after_payment()
returns trigger language plpgsql security definer set search_path='pg_catalog','pg_temp' as $activate$
begin
 if new.kind<>'goods' or new.status is distinct from 'paid'
   or old.status is not distinct from new.status or new.request_data->'membership_addon' is null
 then return new;end if;
 perform pg_advisory_xact_lock(hashtextextended(new.customer_id::text,0));
 if not commerce_internal.valid_combined_membership_invoice(new.id)
 then raise exception 'Combined membership payment must be fully verified before activation' using errcode='P0001';end if;
 insert into public.commerce_memberships(invoice_id,customer_id,plan,starts_at,expires_at)
 values(new.id,new.customer_id,new.request_data->'membership_addon'->>'plan',new.paid_at,new.paid_at+interval '1 year')
 on conflict (invoice_id) do nothing;
 return new;
end $activate$;
revoke all on function commerce_internal.activate_combined_member_after_payment() from public,anon,authenticated;
drop trigger if exists pure_combined_member_paid on public.commerce_invoices;
create trigger pure_combined_member_paid after update of status on public.commerce_invoices
 for each row execute function commerce_internal.activate_combined_member_after_payment();
