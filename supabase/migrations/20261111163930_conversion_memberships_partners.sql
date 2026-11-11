begin;
-- Included in the versioned migration before the v3 checkout function.
create table public.commerce_partners (
 customer_id uuid primary key, code text not null unique check(code ~ '^AP-[A-Z2-9]{12}$'),
 status text not null default 'active' check(status in ('active','suspended')),
 terms_version text not null, created_at timestamptz not null default now()
);
create table public.commerce_referrals (
 customer_id uuid primary key, partner_id uuid not null references public.commerce_partners(customer_id),
 first_invoice_id uuid not null references public.commerce_invoices(id), created_at timestamptz not null default now(),
 check(customer_id<>partner_id)
);
create index commerce_referrals_partner_idx on public.commerce_referrals(partner_id);
create table public.commerce_partner_commissions (
 id uuid primary key default gen_random_uuid(), invoice_id uuid not null unique references public.commerce_invoices(id),
 partner_id uuid not null references public.commerce_partners(customer_id), basis_cents integer not null check(basis_cents>=0),
 rate_bps integer not null check(rate_bps in (1000,2000)), amount_cents integer not null check(amount_cents>=0),
 status text not null default 'pending' check(status in ('pending','eligible','paid','reversed')),
 eligible_at timestamptz, payout_reference text, offset_payout_reference text, created_at timestamptz not null default now()
);
create index commerce_partner_commissions_partner_idx on public.commerce_partner_commissions(partner_id,created_at desc);
create table public.commerce_partner_payouts (
 id uuid primary key, partner_id uuid not null references public.commerce_partners(customer_id),
 amount_cents integer not null check(amount_cents>=10000), reference text not null unique,
 actor text not null, created_at timestamptz not null default now()
);
alter table public.commerce_partners enable row level security;
alter table public.commerce_referrals enable row level security;
alter table public.commerce_partner_commissions enable row level security;
alter table public.commerce_partner_payouts enable row level security;
revoke all on public.commerce_partners,public.commerce_referrals,public.commerce_partner_commissions,public.commerce_partner_payouts from public,anon,authenticated,service_role;
grant select on public.commerce_partners,public.commerce_referrals,public.commerce_partner_commissions,public.commerce_partner_payouts to service_role;

create function public.commerce_join_partner(p_customer uuid,p_code text,p_terms text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare p public.commerce_partners%rowtype;
begin
 if p_customer is null or p_code !~ '^AP-[A-Z2-9]{12}$' or p_terms is distinct from 'partner-2026-11-v1' then raise exception 'Invalid enrollment' using errcode='22023'; end if;
 insert into public.commerce_partners(customer_id,code,terms_version) values(p_customer,p_code,p_terms) on conflict(customer_id) do nothing;
 select * into p from public.commerce_partners where customer_id=p_customer;
 return jsonb_build_object('code',p.code,'status',p.status,'created_at',p.created_at);
end $$;
revoke all on function public.commerce_join_partner(uuid,text,text) from public,anon,authenticated;
grant execute on function public.commerce_join_partner(uuid,text,text) to service_role;

create function commerce_internal.validate_referral(p_customer uuid,p_email text,p_ref jsonb) returns void
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare pid uuid:=(p_ref->>'partner_id')::uuid; existing uuid; historical boolean:=false;
begin
 if pid is null or pid=p_customer or not exists(select 1 from public.commerce_partners where customer_id=pid and status='active' and code=p_ref->>'code') then raise exception 'Referral unavailable' using errcode='P0001'; end if;
 if to_regclass('public.store_orders') is not null then execute 'select exists(select 1 from public.store_orders where lower(customer_email)=lower($1) and payment_status in (''paid'',''partially_refunded'',''refunded''))' into historical using p_email; end if;
 if historical then raise exception 'Referral requires a new customer' using errcode='40001'; end if;
 select partner_id into existing from public.commerce_referrals where customer_id=p_customer;
 if existing is not null and existing<>pid then raise exception 'Existing referral differs' using errcode='40001'; end if;
 if p_ref->>'first_order'='true' and (existing is not null or exists(select 1 from public.commerce_invoices where customer_id=p_customer and kind='goods' and status in ('paid','processing','shipped','delivered','refunded')))
 then raise exception 'First-order discount already used' using errcode='40001'; end if;
 -- Reserve a first-order discount against concurrent unpaid checkout attempts.
 if p_ref->>'first_order'='true' and exists(select 1 from public.commerce_invoices where customer_id=p_customer and status='accepted' and pricing->'referral'->>'first_order'='true') then raise exception 'Finish or cancel the pending referred order first' using errcode='P0001'; end if;
end $$;
revoke all on function commerce_internal.validate_referral(uuid,text,jsonb) from public,anon,authenticated,service_role;

create function commerce_internal.partner_order_transition() returns trigger
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare pid uuid; first_id uuid; basis integer; rate integer;
begin
 if new.kind<>'goods' or old.status=new.status then return new; end if;
 perform 1 from public.commerce_partners where customer_id in (select partner_id from public.commerce_partner_commissions where invoice_id=new.id) for update;
 if new.status='paid' and old.status='accepted' and new.checkout_version='checkout-2026-11-v3' then
  perform pg_advisory_xact_lock(hashtextextended(new.customer_id::text,0));
  select partner_id,first_invoice_id into pid,first_id from public.commerce_referrals where customer_id=new.customer_id;
  if pid is null and new.pricing->'referral' is not null then
   pid:=(new.pricing->'referral'->>'partner_id')::uuid;
   if exists(select 1 from public.commerce_invoices where customer_id=new.customer_id and id<>new.id and kind='goods' and status in ('paid','processing','shipped','delivered','refunded')) then pid:=null;
   elsif pid<>new.customer_id and exists(select 1 from public.commerce_partners where customer_id=pid and status='active') then
    insert into public.commerce_referrals(customer_id,partner_id,first_invoice_id) values(new.customer_id,pid,new.id) on conflict(customer_id) do nothing;
    select partner_id,first_invoice_id into pid,first_id from public.commerce_referrals where customer_id=new.customer_id;
   else pid:=null; end if;
  end if;
  if pid is not null and exists(select 1 from public.commerce_partners where customer_id=pid and status='active') then
   basis:=greatest(0,new.subtotal_cents-new.discount_cents-new.points_redeemed-new.credit_redeemed_cents);
   rate:=case when first_id=new.id then 2000 else 1000 end;
   insert into public.commerce_partner_commissions(invoice_id,partner_id,basis_cents,rate_bps,amount_cents)
   values(new.id,pid,basis,rate,floor(basis::numeric*rate/10000)::integer) on conflict(invoice_id) do nothing;
  end if;
 elsif new.status='delivered' then
  update public.commerce_partner_commissions set eligible_at=now()+interval '30 days' where invoice_id=new.id and status='pending';
 elsif new.status in ('refunded','void') then
  update public.commerce_partner_commissions set status='reversed' where invoice_id=new.id;
 end if;
 return new;
end $$;
revoke all on function commerce_internal.partner_order_transition() from public,anon,authenticated,service_role;
create trigger commerce_partner_order_transition after update of status on public.commerce_invoices for each row execute function commerce_internal.partner_order_transition();

create function public.commerce_refresh_partner(p_customer uuid) returns void
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 update public.commerce_partner_commissions c set status='eligible' where partner_id=p_customer and status='pending' and eligible_at<=now()
 and exists(select 1 from public.commerce_invoices i where i.id=c.invoice_id and i.status='delivered');
end $$;
revoke all on function public.commerce_refresh_partner(uuid) from public,anon,authenticated;
grant execute on function public.commerce_refresh_partner(uuid) to service_role;

create function commerce_internal.membership_term() returns trigger
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare r public.commerce_invoices%rowtype;
begin
 select * into r from public.commerce_invoices where id=new.invoice_id;
 if r.checkout_version='checkout-2026-11-v3' then
  if r.request_data->>'billing_period' not in ('monthly','annual') or r.request_data->>'billing_period' is null then raise exception 'Membership term missing'; end if;
  new.expires_at:=new.starts_at+case when r.request_data->>'billing_period'='monthly' then interval '1 month' else interval '1 year' end;
 end if;
 return new;
end $$;
revoke all on function commerce_internal.membership_term() from public,anon,authenticated,service_role;
create trigger commerce_membership_term before insert on public.commerce_memberships for each row execute function commerce_internal.membership_term();

create or replace function public.commerce_place_checkout(p_data jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare r public.commerce_invoices%rowtype; m public.commerce_payment_methods%rowtype; b public.commerce_balance_accounts%rowtype;
 uid uuid:=(p_data->>'customer_id')::uuid; oid uuid:=(p_data->>'id')::uuid; member_id uuid; member_plan text; expiry timestamptz;
 points integer:=(p_data->>'points_redeemed')::integer; credit integer:=(p_data->>'credit_redeemed_cents')::integer;
 sub integer:=(p_data->>'subtotal_cents')::integer; disc integer:=(p_data->>'discount_cents')::integer;
 ship integer:=(p_data->>'shipping_cents')::integer; tax integer:=(p_data->>'tax_cents')::integer; total integer:=(p_data->>'total_cents')::integer;
 earned integer:=(p_data->>'earned_points')::integer; n integer;
begin
 if uid is null or oid is null or jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>50000
 or (p_data->>'checkout_version' is null or p_data->>'checkout_version' not in ('checkout-2026-11-v1','checkout-2026-11-v2','checkout-2026-11-v3')) or p_data->>'consent' is distinct from 'true'
 or p_data->>'currency' is distinct from 'USD' or p_data->>'terms_version' is distinct from 'launch-2026-11-v1'
 or p_data->>'kind' is null or p_data->>'kind' not in ('goods','membership') then raise exception 'Invalid checkout' using errcode='22023'; end if;
 -- Order lock precedes account lock, matching existing payment/refund transitions.
 perform pg_advisory_xact_lock(hashtextextended(oid::text,23));
 select * into r from public.commerce_invoices where id=oid for update;
 if found then
  if r.customer_id<>uid or r.request_digest<>p_data->>'digest' or r.checkout_version is distinct from p_data->>'checkout_version' then raise exception 'Checkout reference conflict' using errcode='23505'; end if;
  return jsonb_build_object('id',r.id,'status',r.status,'replayed',true);
 end if;
 -- Serialize with legacy membership creation as well as concurrent checkout.
 perform pg_advisory_xact_lock(hashtextextended(uid::text,0));
 insert into public.commerce_balance_accounts(customer_id) values(uid) on conflict do nothing;
 select * into b from public.commerce_balance_accounts where customer_id=uid for update;
 select count(*) into n from public.commerce_invoices where customer_id=uid and status in ('requested','issued','accepted');
 if n>=10 then raise exception 'Cancel unpaid orders before creating more' using errcode='P0001'; end if;
 select * into m from public.commerce_payment_methods where id=(p_data->>'method_id')::uuid and active and currency='USD' for share;
 if not found or m.version is distinct from (p_data->>'method_version')::integer or m.sale_scope not in ('both',p_data->>'kind')
 or (m.native_provider is null and m.kind<>'bank_transfer') then raise exception 'Payment method changed' using errcode='P0001'; end if;
 if m.native_provider is not null and not exists(select 1 from public.commerce_gateway_accounts where method_id=m.id and mode='live'
  and (p_data->>'kind'='membership' or (p_data->'request'->'address'->>'country')=any(countries))) then raise exception 'Live gateway scope unavailable' using errcode='P0001'; end if;
 select invoice_id,plan,expires_at into member_id,member_plan,expiry from public.commerce_memberships
 where customer_id=uid and revoked_at is null and starts_at<=now() and expires_at>now() order by case when plan='elite' then 2 else 1 end desc,expires_at desc limit 1;
 if member_id is distinct from (p_data->>'membership_invoice_id')::uuid then raise exception 'Membership changed' using errcode='40001'; end if;
 if sub is null or disc is null or ship is null or tax is null or total is null or points is null or credit is null or earned is null
 or points<0 or credit<0 or points>greatest(0,b.points) or credit>b.credit_cents or (points>0 and points<100)
 or points>sub-disc or total<>sub-disc+ship+tax-points-credit or total<0 or tax<>0
 then raise exception 'Invalid checkout amount or balance' using errcode='P0001'; end if;
 if p_data->>'kind'='membership' then
  if member_id is not null or points<>0 or credit<>0 or disc<>0 or ship<>0 or earned<>0
  or sub is distinct from (case when p_data->>'checkout_version'='checkout-2026-11-v3' then case when p_data->'request'->>'billing_period'='monthly' then case p_data->>'plan' when 'vip' then 1999 when 'elite' then 9999 end when p_data->'request'->>'billing_period'='annual' then case p_data->>'plan' when 'vip' then 19190 when 'elite' then 95990 end end else case p_data->>'plan' when 'vip' then 4900 when 'elite' then 9900 end end)
  or exists(select 1 from public.commerce_invoices where customer_id=uid and kind='membership' and status in ('requested','issued','accepted'))
  then raise exception 'Invalid or existing membership purchase' using errcode='P0001'; end if;
 else
  if p_data->'request'->'address'->>'country' is distinct from 'US' or ship<>(case when p_data->>'checkout_version'='checkout-2026-11-v3' and (member_id is not null or sub-disc>=25000) then 0 else 2500 end)
  or earned<>(case when p_data->>'checkout_version'='checkout-2026-11-v3' then floor(greatest(0,sub-disc-points-credit)::numeric*case member_plan when 'vip' then 5 when 'elite' then 10 else 2.5 end/100)::integer else greatest(0,(sub-disc-points-credit)/100) end) then raise exception 'Invalid goods checkout' using errcode='22023'; end if;
 end if;
 if p_data->'pricing'->'referral' is not null then perform commerce_internal.validate_referral(uid,p_data->>'customer_email',p_data->'pricing'->'referral'); end if;
 insert into public.commerce_invoices(id,customer_id,customer_email,customer_name,kind,plan,request_digest,request_data,terms_version,status,currency,
 pricing,subtotal_cents,discount_cents,shipping_cents,tax_cents,total_cents,method_id,payment_snapshot,expires_at,accepted_at,checkout_version,points_redeemed,credit_redeemed_cents,earned_points)
 values(oid,uid,lower(trim(p_data->>'customer_email')),p_data->>'customer_name',p_data->>'kind',p_data->>'plan',p_data->>'digest',p_data->'request',p_data->>'terms_version','accepted','USD',
 p_data->'pricing',sub,disc,ship,tax,total,m.id,jsonb_build_object('kind',m.kind,'label',m.label,'payee',m.payee,'instructions',m.instructions,'method_version',m.version,
 'payment_url',case when m.native_provider is not null then 'https://altapurelabs.com/pay.html?invoice='||oid::text else null end),
 least(now()+interval '24 hours',coalesce(expiry,now()+interval '24 hours')),now(),p_data->>'checkout_version',points,credit,earned);
 perform commerce_internal.balance_event(uid,oid,'points',-points,'Checkout redemption',oid||':redeem-points','customer:'||uid);
 perform commerce_internal.balance_event(uid,oid,'credit',-credit,'Checkout credit',oid||':redeem-credit','customer:'||uid);
 insert into public.commerce_events(invoice_id,action,actor,details) values(oid,'checkout_placed','customer:'||uid,jsonb_build_object('amount_cents',total,'currency','USD','version',p_data->>'checkout_version'));
 if total=0 then
  update public.commerce_invoices set status='paid',paid_at=now(),version=version+1 where id=oid;
  insert into public.commerce_events(invoice_id,action,actor,details) values(oid,'payment_recorded','account-balance',jsonb_build_object('amount_cents',0,'balance_only',true));
 end if;
 return jsonb_build_object('id',oid,'status',case when total=0 then 'paid' else 'accepted' end,'created',true);
end $$;

revoke all on function public.commerce_place_checkout(jsonb) from public,anon,authenticated;
grant execute on function public.commerce_place_checkout(jsonb) to service_role,postgres;

create function public.commerce_partner_summary(p_customer uuid) returns jsonb
language sql security definer set search_path=pg_catalog,pg_temp as $$
 select jsonb_build_object(
 'earned_cents',coalesce(sum(amount_cents) filter(where status<>'reversed'),0),
 'pending_cents',coalesce(sum(amount_cents) filter(where status='pending'),0),
 'eligible_cents',greatest(0,coalesce(sum(amount_cents) filter(where status='eligible'),0)-coalesce(sum(amount_cents) filter(where status='reversed' and payout_reference is not null and offset_payout_reference is null),0)),
 'paid_cents',(select coalesce(sum(amount_cents),0) from public.commerce_partner_payouts where partner_id=p_customer),
 'orders',count(*)) from public.commerce_partner_commissions where partner_id=p_customer;
$$;
revoke all on function public.commerce_partner_summary(uuid) from public,anon,authenticated;
grant execute on function public.commerce_partner_summary(uuid) to service_role;

-- Records an external payment already made by the owner; never sends money.
create function public.commerce_record_partner_payout(p_id uuid,p_partner uuid,p_amount integer,p_reference text,p_actor text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare prior public.commerce_partner_payouts%rowtype; available integer;
begin
 if p_id is null or p_partner is null or p_amount is null or p_amount<10000 or length(trim(p_reference))<8 or length(p_reference)>180 or length(p_actor)<8 then raise exception 'Invalid payout record' using errcode='22023'; end if;
 perform 1 from public.commerce_partners where customer_id=p_partner and status='active' for update;
 if not found then raise exception 'Partner unavailable' using errcode='P0002'; end if;
 select * into prior from public.commerce_partner_payouts where id=p_id;
 if found then
  if prior.partner_id<>p_partner or prior.amount_cents<>p_amount or prior.reference<>p_reference then raise exception 'Payout reference conflict' using errcode='23505'; end if;
  return jsonb_build_object('id',prior.id,'replayed',true);
 end if;
 perform public.commerce_refresh_partner(p_partner);
 select (public.commerce_partner_summary(p_partner)->>'eligible_cents')::integer into available;
 if available<>p_amount then raise exception 'Payout balance changed' using errcode='40001'; end if;
 insert into public.commerce_partner_payouts(id,partner_id,amount_cents,reference,actor) values(p_id,p_partner,p_amount,p_reference,p_actor);
 update public.commerce_partner_commissions set status='paid',payout_reference=p_reference where partner_id=p_partner and status='eligible';
 update public.commerce_partner_commissions set offset_payout_reference=p_reference where partner_id=p_partner and status='reversed' and payout_reference is not null and offset_payout_reference is null;
 return jsonb_build_object('id',p_id,'replayed',false,'amount_cents',p_amount);
end $$;
revoke all on function public.commerce_record_partner_payout(uuid,uuid,integer,text,text) from public,anon,authenticated;
grant execute on function public.commerce_record_partner_payout(uuid,uuid,integer,text,text) to service_role;

commit;
