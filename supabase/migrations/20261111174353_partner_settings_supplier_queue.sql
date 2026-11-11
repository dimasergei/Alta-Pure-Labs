begin;
-- Existing codes are retained as aliases. Customer roles never access bank data directly.
alter table public.commerce_partners drop constraint commerce_partners_code_check;
alter table public.commerce_partners add constraint commerce_partners_code_check check(code ~ '^[A-Z0-9][A-Z0-9_-]{2,23}$');
create table public.commerce_partner_codes(code text primary key check(code ~ '^[A-Z0-9][A-Z0-9_-]{2,23}$'),partner_id uuid not null references public.commerce_partners(customer_id),created_at timestamptz not null default now());
create index commerce_partner_codes_owner_idx on public.commerce_partner_codes(partner_id);
insert into public.commerce_partner_codes(code,partner_id) select code,customer_id from public.commerce_partners;
create table public.commerce_partner_banks(partner_id uuid primary key references public.commerce_partners(customer_id),encrypted_details text not null check(length(encrypted_details) between 50 and 8000),bank_name text not null,account_type text not null check(account_type in ('checking','savings')),country text not null check(country='US'),last4 text not null check(last4 ~ '^[0-9]{4}$'),updated_at timestamptz not null default now());
create table public.commerce_partner_settings_audit(id bigint generated always as identity primary key,partner_id uuid not null references public.commerce_partners(customer_id),action text not null,created_at timestamptz not null default now());
alter table public.commerce_partner_codes enable row level security;
alter table public.commerce_partner_banks enable row level security;
alter table public.commerce_partner_settings_audit enable row level security;
revoke all on public.commerce_partner_codes,public.commerce_partner_banks,public.commerce_partner_settings_audit from public,anon,authenticated,service_role;
grant select on public.commerce_partner_codes,public.commerce_partner_banks,public.commerce_partner_settings_audit to service_role;

create or replace function public.commerce_join_partner(p_customer uuid,p_code text,p_terms text) returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare p public.commerce_partners%rowtype;
begin
 if p_customer is null or p_code is null or p_code !~ '^[A-Z0-9][A-Z0-9_-]{2,23}$' or p_code in ('BOGO','ADMIN','ALTAPURE','ALTAPURELABS','SUPPORT','GOLD','PLATINUM') or p_terms is distinct from 'partner-2026-11-v1' then raise exception 'Invalid enrollment' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_customer::text,61));
 select * into p from public.commerce_partners where customer_id=p_customer;
 if not found then
  insert into public.commerce_partners(customer_id,code,terms_version) values(p_customer,p_code,p_terms) returning * into p;
  insert into public.commerce_partner_codes(code,partner_id) values(p_code,p_customer);
 end if;
 return jsonb_build_object('code',p.code,'status',p.status,'created_at',p.created_at);
end $$;
create function public.commerce_partner_add_code(p_customer uuid,p_code text) returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 perform 1 from public.commerce_partners where customer_id=p_customer and status='active' for update;
 if not found then raise exception 'Partner unavailable' using errcode='P0002';end if;
 if p_code is null or p_code !~ '^[A-Z0-9][A-Z0-9_-]{2,23}$' or p_code in ('BOGO','ADMIN','ALTAPURE','ALTAPURELABS','SUPPORT','GOLD','PLATINUM') then raise exception 'Invalid referral code' using errcode='22023';end if;
 if exists(select 1 from public.commerce_partner_codes where code=p_code and partner_id=p_customer) then return jsonb_build_object('code',p_code);end if;
 if (select count(*) from public.commerce_partner_codes where partner_id=p_customer)>=3 then raise exception 'Three-code limit reached' using errcode='P0001';end if;
 insert into public.commerce_partner_codes(code,partner_id) values(p_code,p_customer);
 update public.commerce_partners set code=p_code where customer_id=p_customer;
 insert into public.commerce_partner_settings_audit(partner_id,action) values(p_customer,'referral_code_added');
 return jsonb_build_object('code',p_code);
end $$;
create function public.commerce_partner_save_bank(p_customer uuid,p_encrypted text,p_masked jsonb) returns void language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 perform 1 from public.commerce_partners where customer_id=p_customer and status='active' for update;
 if not found then raise exception 'Partner unavailable' using errcode='P0002';end if;
 insert into public.commerce_partner_banks(partner_id,encrypted_details,bank_name,account_type,country,last4)
 values(p_customer,p_encrypted,p_masked->>'bank_name',p_masked->>'account_type',p_masked->>'country',p_masked->>'last4')
 on conflict(partner_id) do update set encrypted_details=excluded.encrypted_details,bank_name=excluded.bank_name,account_type=excluded.account_type,country=excluded.country,last4=excluded.last4,updated_at=now();
 insert into public.commerce_partner_settings_audit(partner_id,action) values(p_customer,'bank_details_updated');
end $$;
create function public.commerce_partner_read_bank(p_customer uuid) returns text language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare encrypted text;
begin
 select encrypted_details into encrypted from public.commerce_partner_banks where partner_id=p_customer;
 if encrypted is not null then insert into public.commerce_partner_settings_audit(partner_id,action) values(p_customer,'admin_bank_details_read');end if;
 return encrypted;
end $$;
revoke all on function public.commerce_join_partner(uuid,text,text),public.commerce_partner_add_code(uuid,text),public.commerce_partner_save_bank(uuid,text,jsonb),public.commerce_partner_read_bank(uuid) from public,anon,authenticated;
grant execute on function public.commerce_join_partner(uuid,text,text),public.commerce_partner_add_code(uuid,text),public.commerce_partner_save_bank(uuid,text,jsonb),public.commerce_partner_read_bank(uuid) to service_role;
create or replace function commerce_internal.validate_referral(p_customer uuid,p_email text,p_ref jsonb) returns void
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare pid uuid:=(p_ref->>'partner_id')::uuid; existing uuid; historical boolean:=false;
begin
 if pid is null or pid=p_customer or not exists(select 1 from public.commerce_partners where customer_id=pid and status='active' and exists(select 1 from public.commerce_partner_codes c where c.partner_id=pid and c.code=p_ref->>'code')) then raise exception 'Referral unavailable' using errcode='P0001'; end if;
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


-- Integration starts disabled; no existing order is automatically submitted.
create table public.commerce_supplier_settings(id boolean primary key default true check(id),enabled boolean not null default false,max_order_cents integer not null default 0 check(max_order_cents>=0),verified_at timestamptz);
insert into public.commerce_supplier_settings(id) values(true);
create table public.commerce_supplier_mappings(variant_key text primary key,product integer not null check(product>0),vials integer not null check(vials>0),supplier_name text not null,verified_at timestamptz not null default now());
create table public.commerce_supplier_jobs(invoice_id uuid primary key references public.commerce_invoices(id),reference text not null unique,mode text check(mode in ('test','live')),status text not null default 'queued' check(status in ('queued','working','retry','submitted','shipped','cancelled','blocked')),supplier_id text,payload jsonb,provider_status text,settlement text,owed_total text,tracking_number text,carrier text,last_error text,attempts integer not null default 0,retry_count integer not null default 0 check(retry_count between 0 and 5),next_attempt_at timestamptz not null default now(),lease_id uuid,lease_until timestamptz,updated_at timestamptz not null default now());
create index commerce_supplier_jobs_pending_idx on public.commerce_supplier_jobs(status,next_attempt_at);
alter table public.commerce_supplier_settings enable row level security;
alter table public.commerce_supplier_mappings enable row level security;
alter table public.commerce_supplier_jobs enable row level security;
revoke all on public.commerce_supplier_settings,public.commerce_supplier_mappings,public.commerce_supplier_jobs from public,anon,authenticated,service_role;
grant select on public.commerce_supplier_settings,public.commerce_supplier_mappings,public.commerce_supplier_jobs to service_role;
grant insert,update on public.commerce_supplier_mappings to service_role;
create function commerce_internal.lotus_enqueue() returns trigger language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 if new.kind='goods' and new.status='paid' and old.status is distinct from new.status and exists(select 1 from public.commerce_supplier_settings where enabled and verified_at is not null and max_order_cents>0) then
  insert into public.commerce_supplier_jobs(invoice_id,reference) values(new.id,'ALTA-'||new.id::text) on conflict do nothing;
 end if;return new;
end $$;
create trigger commerce_lotus_enqueue after update of status on public.commerce_invoices for each row execute function commerce_internal.lotus_enqueue();
create function public.commerce_supplier_claim(p_lease uuid) returns setof public.commerce_supplier_jobs language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 return query update public.commerce_supplier_jobs j set lease_id=p_lease,lease_until=now()+interval '5 minutes',attempts=j.attempts+1,updated_at=now()
 where j.invoice_id in(select q.invoice_id from public.commerce_supplier_jobs q where q.status in ('queued','retry','working','submitted') and q.next_attempt_at<=now() and (q.lease_until is null or q.lease_until<now()) order by q.next_attempt_at for update skip locked limit 1) returning j.*;
end $$;
create function public.commerce_supplier_save(p_invoice uuid,p_lease uuid,p_data jsonb) returns void language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 update public.commerce_supplier_jobs set retry_count=coalesce((p_data->>'retry_count')::integer,retry_count),status=coalesce(p_data->>'status',status),mode=coalesce(p_data->>'mode',mode),supplier_id=coalesce(p_data->>'supplier_id',supplier_id),payload=coalesce(p_data->'payload',payload),provider_status=coalesce(p_data->>'provider_status',provider_status),settlement=coalesce(p_data->>'settlement',settlement),owed_total=coalesce(p_data->>'owed_total',owed_total),tracking_number=coalesce(p_data->>'tracking_number',tracking_number),carrier=coalesce(p_data->>'carrier',carrier),last_error=p_data->>'last_error',next_attempt_at=coalesce((p_data->>'next_attempt_at')::timestamptz,now()+interval '15 minutes'),lease_id=case when p_data->>'release'='true' then null else lease_id end,lease_until=case when p_data->>'release'='true' then null else lease_until end,updated_at=now() where invoice_id=p_invoice and lease_id=p_lease;
 if not found then raise exception 'Supplier job lease changed' using errcode='40001';end if;
end $$;
revoke all on function commerce_internal.lotus_enqueue(),public.commerce_supplier_claim(uuid),public.commerce_supplier_save(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.commerce_supplier_claim(uuid),public.commerce_supplier_save(uuid,uuid,jsonb) to service_role;

create table public.commerce_delivery_options(id text primary key,kind text not null check(kind in ('shipping','extra')),label text not null,price_cents integer not null check(price_cents between 0 and 100000),enabled boolean not null default false,description text not null);
alter table public.commerce_delivery_options enable row level security;
revoke all on public.commerce_delivery_options from public,anon,authenticated,service_role;
grant select on public.commerce_delivery_options to service_role;
insert into public.commerce_delivery_options values('standard','shipping','Standard delivery',2500,true,'Estimated 3–7 business days in transit after 1–3 business days of processing. Free for paid members or $250+ after discounts.');
insert into public.commerce_delivery_options values('express','shipping','Express UPS',3495,false,'Not available until express dispatch and label service are confirmed.');
insert into public.commerce_delivery_options values('next_day','shipping','UPS Next Day',6995,false,'Not available until next-day service and dispatch cutoffs are confirmed.');
insert into public.commerce_delivery_options values('priority','extra','Priority Processing',999,false,'Moves an eligible order ahead in the fulfillment queue. Availability requires supplier confirmation.');
insert into public.commerce_delivery_options values('cold_chain','extra','Cold Chain Shipping',999,false,'Available only when temperature-controlled packaging and handling are confirmed.');
insert into public.commerce_delivery_options values('protection','extra','Shipping Protection',500,false,'Optional protection is not available until its coverage and claims terms are published.');
create function commerce_internal.delivery_total(p_selection jsonb,p_free boolean) returns integer language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare ship text:=p_selection->>'shipping'; extras jsonb:=p_selection->'extras'; total integer; selected integer; expected integer;
begin
 if ship is null or ship not in ('standard','express','next_day') or jsonb_typeof(extras) is distinct from 'array' or jsonb_array_length(extras)>3 then raise exception 'Invalid delivery selection' using errcode='22023';end if;
 select price_cents into total from public.commerce_delivery_options where id=ship and kind='shipping' and enabled for share;
 if total is null then raise exception 'Delivery unavailable' using errcode='22023';end if;
 if p_free and ship='standard' then total:=0;end if;
 select count(distinct value) into expected from jsonb_array_elements_text(extras);
 if expected<>jsonb_array_length(extras) then raise exception 'Duplicate option' using errcode='22023';end if;
 select count(*),total+coalesce(sum(price_cents),0)::integer into selected,total from public.commerce_delivery_options where kind='extra' and enabled and id in(select jsonb_array_elements_text(extras));
 if selected<>expected then raise exception 'Delivery extra unavailable' using errcode='22023';end if;return total;
end $$;
revoke all on function commerce_internal.delivery_total(jsonb,boolean) from public,anon,authenticated,service_role;
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
 or (p_data->>'checkout_version' is null or p_data->>'checkout_version' not in ('checkout-2026-11-v1','checkout-2026-11-v2','checkout-2026-11-v3','checkout-2026-11-v4')) or p_data->>'consent' is distinct from 'true'
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
  or sub is distinct from (case when p_data->>'checkout_version' in ('checkout-2026-11-v3','checkout-2026-11-v4') then case when p_data->'request'->>'billing_period'='monthly' then case p_data->>'plan' when 'vip' then 1999 when 'elite' then 9999 end when p_data->'request'->>'billing_period'='annual' then case p_data->>'plan' when 'vip' then 19190 when 'elite' then 95990 end end else case p_data->>'plan' when 'vip' then 4900 when 'elite' then 9900 end end)
  or exists(select 1 from public.commerce_invoices where customer_id=uid and kind='membership' and status in ('requested','issued','accepted'))
  then raise exception 'Invalid or existing membership purchase' using errcode='P0001'; end if;
 else
  if p_data->'request'->'address'->>'country' is distinct from 'US' or ship<>(case when p_data->>'checkout_version'='checkout-2026-11-v4' then commerce_internal.delivery_total(p_data->'request'->'checkout'->'delivery',member_id is not null or sub-disc>=25000) when p_data->>'checkout_version'='checkout-2026-11-v3' and (member_id is not null or sub-disc>=25000) then 0 else 2500 end)
  or earned<>(case when p_data->>'checkout_version' in ('checkout-2026-11-v3','checkout-2026-11-v4') then floor(greatest(0,sub-disc-points-credit)::numeric*case member_plan when 'vip' then 5 when 'elite' then 10 else 2.5 end/100)::integer else greatest(0,(sub-disc-points-credit)/100) end) then raise exception 'Invalid goods checkout' using errcode='22023'; end if;
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

create or replace function commerce_internal.partner_order_transition() returns trigger
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare pid uuid; first_id uuid; basis integer; rate integer;
begin
 if new.kind<>'goods' or old.status=new.status then return new; end if;
 perform 1 from public.commerce_partners where customer_id in (select partner_id from public.commerce_partner_commissions where invoice_id=new.id) for update;
 if new.status='paid' and old.status='accepted' and new.checkout_version in ('checkout-2026-11-v3','checkout-2026-11-v4') then
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
create or replace function commerce_internal.membership_term() returns trigger
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare r public.commerce_invoices%rowtype;
begin
 select * into r from public.commerce_invoices where id=new.invoice_id;
 if r.checkout_version in ('checkout-2026-11-v3','checkout-2026-11-v4') then
  if r.request_data->>'billing_period' not in ('monthly','annual') or r.request_data->>'billing_period' is null then raise exception 'Membership term missing'; end if;
  new.expires_at:=new.starts_at+case when r.request_data->>'billing_period'='monthly' then interval '1 month' else interval '1 year' end;
 end if;
 return new;
end $$;
revoke all on function commerce_internal.membership_term() from public,anon,authenticated,service_role;

commit;
