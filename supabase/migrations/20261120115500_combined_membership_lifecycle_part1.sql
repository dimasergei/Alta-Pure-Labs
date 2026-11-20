-- A combined order is still one goods invoice and one verified payment.
-- Membership entitlement starts after that invoice has a full verified payment receipt.
-- Fees never contribute to merchandise discounts, points, or partner commissions.
create or replace function commerce_internal.valid_combined_membership_invoice(p_invoice uuid)
returns boolean language plpgsql stable security definer set search_path='pg_catalog','pg_temp' as $combo$
declare i public.commerce_invoices%rowtype; a jsonb; r jsonb; usd_fee integer; fee integer; rate integer; name text;
begin
 select * into i from public.commerce_invoices where id=p_invoice;
 if i.id is null or i.kind<>'goods' or i.status not in ('paid','processing','shipped','delivered')
   or i.paid_at is null or i.membership_invoice_id is not null or i.pricing ? 'membership_addon' is false
   or i.request_data->'membership_addon' is null
   or not exists(select 1 from public.commerce_receipts where invoice_id=i.id and method_id=i.method_id and kind='payment'
     and amount_cents=i.total_cents and currency=i.currency)
 then return false;end if;
 r:=i.request_data->'membership_addon';a:=i.pricing->'membership_addon';
 if jsonb_typeof(r) is distinct from 'object' or (r-array['plan','period']) is distinct from '{}'::jsonb
   or r->>'plan' not in ('vip','elite') or r->>'period' not in ('monthly','annual')
 then return false;end if;
 usd_fee:=case r->>'period' when 'monthly' then case r->>'plan' when 'vip' then 1999 when 'elite' then 9999 end
   when 'annual' then case r->>'plan' when 'vip' then 19190 when 'elite' then 95990 end end;
 rate:=(i.pricing->>'fx_ppm')::integer;
 if rate not between 100000 and 10000000 or (i.currency='USD' and rate<>1000000)
   or i.currency not in ('USD','CAD') then return false;end if;
 fee:=round(usd_fee::numeric*rate/1000000)::integer;
 name:=case r->>'plan' when 'vip' then 'PURE WHITE' else 'PURE BLACK' end;
 return a is not distinct from jsonb_build_object('plan',r->>'plan','period',r->>'period',
     'fee_usd_cents',usd_fee,'fee_cents',fee,'name',name,'currency',i.currency)
   and i.subtotal_cents=(i.pricing->>'subtotal_cents')::integer+fee
   and i.total_cents=i.subtotal_cents-i.discount_cents+i.shipping_cents-i.points_redeemed-i.credit_redeemed_cents
   and i.terms_version='launch-2026-11-v1'
   and i.pricing->>'membership_plan'=r->>'plan'
   and i.pricing->>'conversion_version'='conversion-2026-11-v3';
exception when others then return false;
end $combo$;
revoke all on function commerce_internal.valid_combined_membership_invoice(uuid) from public,anon,authenticated;
CREATE OR REPLACE FUNCTION commerce_internal.active_paid_membership(p_customer uuid, p_at timestamp with time zone)
 RETURNS commerce_memberships
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  select m.* from public.commerce_memberships m
  join public.commerce_invoices i on i.id=m.invoice_id and i.customer_id=m.customer_id
    and (i.kind='membership' and i.plan=m.plan and i.status='paid' or i.kind='goods' and i.pricing->'membership_addon'->>'plan'=m.plan and i.status in ('paid','processing','shipped','delivered'))
  where m.customer_id=p_customer and m.revoked_at is null and m.starts_at<=p_at and m.expires_at>p_at
  order by case m.plan when 'elite' then 2 when 'vip' then 1 else 0 end desc,m.expires_at desc,m.invoice_id
  limit 1
$function$
;
CREATE OR REPLACE FUNCTION commerce_internal.membership_term()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
declare r public.commerce_invoices%rowtype;
begin
  select * into r from public.commerce_invoices where id=new.invoice_id;
  if r.checkout_version in ('checkout-2026-11-v3','checkout-2026-11-v4','checkout-2026-11-v8','checkout-interac-cad-2026-11-v2') then
    if coalesce(r.request_data->>'billing_period',r.request_data->'membership_addon'->>'period') is null or coalesce(r.request_data->>'billing_period',r.request_data->'membership_addon'->>'period') not in ('monthly','annual') then raise exception 'Membership term missing' using errcode='22023';end if;
    if r.checkout_version in ('checkout-2026-11-v8','checkout-interac-cad-2026-11-v2') then new.starts_at:=r.paid_at;end if;
    new.expires_at:=new.starts_at+case when coalesce(r.request_data->>'billing_period',r.request_data->'membership_addon'->>'period')='monthly' then interval '1 month' else interval '1 year' end;
  end if;
  return new;
end $function$
;
CREATE OR REPLACE FUNCTION commerce_internal.membership_order_payment_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
declare m public.commerce_memberships%rowtype;
begin
  if new.membership_invoice_id is distinct from old.membership_invoice_id then raise exception 'Order membership snapshot is immutable' using errcode='P0001';end if;
  if new.checkout_version in ('checkout-2026-11-v8','checkout-interac-cad-2026-11-v2') and new.kind='goods' and old.status='accepted' and new.status='paid' then
    perform pg_advisory_xact_lock(hashtextextended(new.customer_id::text,0));
    if new.membership_invoice_id is not null then
      select membership.* into m from public.commerce_memberships membership
        join public.commerce_invoices source on source.id=membership.invoice_id and source.customer_id=membership.customer_id
          and source.plan=membership.plan and source.kind='membership' and source.status='paid'
        where membership.invoice_id=new.membership_invoice_id and membership.customer_id=new.customer_id
          and membership.revoked_at is null and membership.starts_at<=new.accepted_at and membership.expires_at>new.accepted_at;
      if not found or m.plan is distinct from new.pricing->>'membership_plan' or coalesce(new.paid_at,now())>new.expires_at
      then raise exception 'Membership revoked or payment deadline passed; reconcile this order' using errcode='P0001';end if;
    end if;
    new.priority_fulfillment:=coalesce(m.plan='elite',false) or (new.request_data->'membership_addon'->>'plan'='elite');
  elsif new.priority_fulfillment is distinct from old.priority_fulfillment then
    raise exception 'Priority fulfillment requires verified payment' using errcode='P0001';
  end if;
  return new;
end $function$
;
CREATE OR REPLACE FUNCTION commerce_internal.fulfillment_seed(p_invoice uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
declare r public.commerce_invoices%rowtype; gift boolean;
begin
  select * into r from public.commerce_invoices where id=p_invoice for update;
  if r.id is null or r.kind<>'goods' or r.status not in ('paid','processing') then return;end if;
  -- Preserve existing assignments, parcels and any historical supplier request.
  if exists(select 1 from public.commerce_fulfillment_items where invoice_id=r.id)
    or exists(select 1 from public.commerce_supplier_jobs where invoice_id=r.id) then return;end if;
  insert into public.commerce_fulfillment_items(invoice_id,variant_key,item,route,supplier_name,product,vials)
    select r.id,x->>'id'||'|'||(x->>'size'),x,'manual','',null,null from jsonb_array_elements(coalesce(r.request_data->'items','[]'::jsonb)) x on conflict do nothing;
  gift:=(r.request_data->'membership_addon'->>'plan'='elite') or r.checkout_version in ('checkout-2026-11-v8','checkout-interac-cad-2026-11-v2') and exists(
    select 1 from public.commerce_memberships where invoice_id=r.membership_invoice_id and customer_id=r.customer_id and plan='elite' and revoked_at is null
      and starts_at<=r.accepted_at and expires_at>r.accepted_at);
  if gift then
    insert into public.commerce_fulfillment_items(invoice_id,variant_key,item,route,supplier_name,product,vials,note)
    values(r.id,'gift-bac-3|3 mL',jsonb_build_object('id','gift-bac-3','name','Complimentary BAC Water 3mL — PURE BLACK','size','3 mL','qty',1,'unit_price_usd_cents',0,'membership_gift',true),
      'manual','',null,null,'PURE BLACK membership gift: include with the same shipment; do not split this order') on conflict do nothing;
  end if;
  if r.request_data->>'research_builder_mode'='member_stack' then
    insert into public.commerce_fulfillment_items(invoice_id,variant_key,item,route,supplier_name,product,vials,note)
    values(r.id,'gift-bac-3|3 mL',jsonb_build_object('id','gift-bac-3','name','Included BAC Water 3mL — AUTO-STACK',
      'size','3 mL','qty',1,'unit_price_usd_cents',0,'research_stack_included',true),
      'manual','',null,null,'Member Stack included BAC Water: ship with four compounds; no split shipment')
    on conflict do nothing;
  end if;
end $function$
;
CREATE OR REPLACE FUNCTION commerce_internal.platinum_monthly_reward()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
declare ref text;oldref text;credit_balance integer;usd_merchandise integer;
begin
  if new.kind<>'goods' or new.customer_id is null or new.status=old.status then return new;end if;
  if new.status='paid' and old.status='accepted' and new.checkout_version in ('checkout-2026-11-v8','checkout-interac-cad-2026-11-v2') then
    usd_merchandise:=case when new.currency='CAD' then (new.pricing->'usd_basis'->>'merchandise_cents')::integer else new.subtotal_cents-new.discount_cents-coalesce((new.pricing->'membership_addon'->>'fee_cents')::integer,0) end;
    if usd_merchandise>=15000 and ((new.request_data->'membership_addon'->>'plan'='elite') or exists(select 1 from public.commerce_memberships where invoice_id=new.membership_invoice_id and customer_id=new.customer_id
      and plan='elite' and revoked_at is null and starts_at<=new.accepted_at and expires_at>new.accepted_at)) then
      -- Keep the historical key so a customer cannot collect a second reward
      -- in the same UTC month simply because the storefront was restored.
      ref:='platinum-monthly-credit:'||new.customer_id::text||':'||to_char(new.paid_at at time zone 'UTC','YYYYMM');
      perform pg_advisory_xact_lock(hashtextextended(ref,7281));
      if not exists(select 1 from public.commerce_balance_events where reference=ref) then
        perform commerce_internal.balance_event(new.customer_id,new.id,'credit',5000,'PURE BLACK monthly reward for qualifying US$150+ merchandise order',ref,'membership-benefits');
        insert into public.commerce_events(invoice_id,action,actor,details) values(new.id,'platinum_monthly_credit_granted','membership-benefits',jsonb_build_object('amount_cents',5000,'currency','USD','reference',ref));
      end if;
    end if;
  elsif new.status='refunded' then
    select reference into oldref from public.commerce_balance_events where invoice_id=new.id and asset='credit' and delta=5000 and reference like 'platinum-monthly-credit:%' limit 1;
    if oldref is not null then
      perform pg_advisory_xact_lock(hashtextextended(oldref,7281));
      if not exists(select 1 from public.commerce_balance_events where reference=oldref||':refund') then
        select credit_cents into credit_balance from public.commerce_balance_accounts where customer_id=new.customer_id for update;
        if credit_balance>=5000 then
          perform commerce_internal.balance_event(new.customer_id,new.id,'credit',-5000,'Reversed PURE BLACK monthly reward on refunded qualifying order',oldref||':refund','verified-refund');
        else
          insert into public.commerce_events(invoice_id,action,actor,details) values(new.id,'platinum_credit_reconciliation_required','membership-benefits',jsonb_build_object('credit_reference',oldref,'unrecovered_cents',5000));
        end if;
      end if;
    end if;
  end if;
  return new;
end $function$
;
CREATE OR REPLACE FUNCTION commerce_internal.partner_order_transition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
declare pid uuid;first_id uuid;basis integer;rate integer;
begin
 if new.kind<>'goods' or old.status=new.status then return new; end if;
 perform 1 from public.commerce_partners where customer_id in (select partner_id from public.commerce_partner_commissions where invoice_id=new.id) for update;
 if new.status='paid' and old.status='accepted' and new.checkout_version in ('checkout-2026-11-v3','checkout-2026-11-v4','checkout-2026-11-v5','checkout-2026-11-v6','checkout-2026-11-v7','checkout-2026-11-v8','checkout-interac-cad-2026-11-v1','checkout-interac-cad-2026-11-v2') then
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
   if new.checkout_version in ('checkout-interac-cad-2026-11-v1','checkout-interac-cad-2026-11-v2') then
    if new.currency is distinct from 'CAD' or new.pricing->'usd_basis'->>'currency' is distinct from 'USD'
     or jsonb_typeof(new.pricing->'usd_basis'->'merchandise_cents') is distinct from 'number'
     or coalesce(new.pricing->'usd_basis'->>'merchandise_cents','') !~ '^[0-9]+$'
    then raise exception 'Validated USD commission basis unavailable' using errcode='P0001'; end if;
    basis:=(new.pricing->'usd_basis'->>'merchandise_cents')::integer;
    if basis not between 0 and 100000000 then raise exception 'Invalid USD commission basis' using errcode='P0001'; end if;
   else
    basis:=greatest(0,new.subtotal_cents-new.discount_cents-new.points_redeemed-new.credit_redeemed_cents-coalesce((new.pricing->'membership_addon'->>'fee_cents')::integer,0));
   end if;
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
end $function$
;
CREATE OR REPLACE FUNCTION commerce_internal.place_membership_checkout(p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
declare
  r public.commerce_invoices%rowtype; method public.commerce_payment_methods%rowtype;
  balance public.commerce_balance_accounts%rowtype; member public.commerce_memberships%rowtype;
  uid uuid:=(p_data->>'customer_id')::uuid; oid uuid:=(p_data->>'id')::uuid;
  is_cad boolean:=p_data->>'currency'='CAD'; version text; n integer; snapshot jsonb;
  sub integer:=(p_data->>'subtotal_cents')::integer; disc integer:=(p_data->>'discount_cents')::integer;
  ship integer:=(p_data->>'shipping_cents')::integer; total integer:=(p_data->>'total_cents')::integer;
  points integer:=(p_data->>'points_redeemed')::integer; credit integer:=(p_data->>'credit_redeemed_cents')::integer;
  earned integer:=(p_data->>'earned_points')::integer;
begin
  version:=case when is_cad then 'checkout-interac-cad-2026-11-v2' else 'checkout-2026-11-v8' end;
  if uid is null or oid is null or jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>50000
    or p_data->>'checkout_version' is distinct from version or p_data->'consent' is distinct from 'true'::jsonb
    or p_data->>'terms_version' is distinct from 'launch-2026-11-v1'
    or p_data->>'kind' is null or p_data->>'kind' not in ('goods','membership')
    or p_data->>'currency' is null or p_data->>'currency' not in ('USD','CAD')
    or coalesce(p_data->>'digest','') !~ '^[a-f0-9]{64}$'
  then raise exception 'Invalid current PURE checkout' using errcode='22023';end if;
  -- Use the established order -> account lock sequence. Replays read the saved
  -- amount even after their original FX quote or membership has expired.
  perform pg_advisory_xact_lock(hashtextextended(oid::text,23));
  select * into r from public.commerce_invoices where id=oid for update;
  if found then
    if r.customer_id is distinct from uid or r.request_digest is distinct from p_data->>'digest'
      or r.checkout_version is distinct from version or r.currency is distinct from p_data->>'currency'
    then raise exception 'Checkout reference conflict' using errcode='23505';end if;
    return jsonb_build_object('id',r.id,'status',r.status,'currency',r.currency,'total_cents',r.total_cents,'manual_transfer',is_cad,'replayed',true);
  end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text,0));
  insert into public.commerce_balance_accounts(customer_id) values(uid) on conflict do nothing;
  select * into balance from public.commerce_balance_accounts where customer_id=uid for update;
  select count(*) into n from public.commerce_invoices where customer_id=uid and status in ('requested','issued','accepted');
  if n>=10 then raise exception 'Cancel unpaid orders before creating more' using errcode='P0001';end if;
  select * into method from public.commerce_payment_methods where id=(p_data->>'method_id')::uuid for share;
  if not found or not method.active or method.currency is distinct from p_data->>'currency'
    or method.version is distinct from (p_data->>'method_version')::integer or method.sale_scope not in ('both',p_data->>'kind')
  then raise exception 'Payment method changed' using errcode='P0001';end if;
  if is_cad then
    if method.kind is distinct from 'interac' or method.provider_key is distinct from 'interac' or method.native_provider is not null
      or p_data->'request'->'preferred_payment'->>'label' is distinct from method.label
    then raise exception 'Interac receiving method changed' using errcode='P0001';end if;
  elsif not exists(select 1 from public.commerce_gateway_accounts where method_id=method.id and provider=method.native_provider and mode='live'
    and provider in ('rampex','polygon_usdc') and (provider<>'rampex' or rampex_provider='hosted')
    and (p_data->'request'->'address'->>'country')=any(countries))
  then raise exception 'Live gateway scope unavailable' using errcode='P0001';end if;
  perform commerce_internal.validate_membership_checkout(p_data);
  member:=commerce_internal.active_paid_membership(uid,now());
  if (p_data->>'kind'='membership' or p_data->'request' ? 'membership_addon') and exists(select 1 from public.commerce_invoices where customer_id=uid and (kind='membership' or request_data ? 'membership_addon') and status in ('requested','issued','accepted'))
  then raise exception 'An unpaid membership checkout already exists' using errcode='P0001';end if;
  if sub is null or disc is null or ship is null or total is null or points is null or credit is null or earned is null
    or sub<1 or disc<0 or disc>sub or ship<0 or earned<0 or points<0 or credit<0
    or points>greatest(0,balance.points) or credit>balance.credit_cents or (points>0 and points<100)
    or points>sub-disc or total<>sub-disc+ship-points-credit or total not between 0 and 100000000
    or (is_cad and (points<>0 or credit<>0 or total=0))
  then raise exception 'Invalid checkout amount or balance' using errcode='P0001';end if;
  if p_data->'pricing' ? 'referral' then perform commerce_internal.validate_referral(uid,p_data->>'customer_email',p_data->'pricing'->'referral');end if;
  if is_cad then
    snapshot:=jsonb_build_object('kind','interac','provider_key','interac','currency','CAD','label',method.label,'payee',method.payee,'instructions',method.instructions,'method_version',method.version,
      'payment_reference','AP'||upper(substr(replace(oid::text,'-',''),1,10)),'payment_url',null);
  else
    snapshot:=jsonb_build_object('kind',method.kind,'label',method.label,'payee',method.payee,'instructions',method.instructions,'method_version',method.version,
      'payment_url','https://getpurelabs.com/pay.html?invoice='||oid::text);
  end if;
  insert into public.commerce_invoices(id,customer_id,customer_email,customer_name,kind,plan,request_digest,request_data,terms_version,status,currency,
    pricing,subtotal_cents,discount_cents,shipping_cents,tax_cents,total_cents,method_id,payment_snapshot,expires_at,accepted_at,checkout_version,points_redeemed,credit_redeemed_cents,earned_points,membership_invoice_id)
  values(oid,uid,lower(trim(p_data->>'customer_email')),p_data->>'customer_name',p_data->>'kind',p_data->>'plan',p_data->>'digest',p_data->'request','launch-2026-11-v1','accepted',p_data->>'currency',
    p_data->'pricing',sub,disc,ship,0,total,method.id,snapshot,now()+interval '24 hours',now(),version,points,credit,earned,member.invoice_id);
  perform commerce_internal.balance_event(uid,oid,'points',-points,'Checkout redemption',oid||':redeem-points','customer:'||uid);
  perform commerce_internal.balance_event(uid,oid,'credit',-credit,'Checkout credit',oid||':redeem-credit','customer:'||uid);
  insert into public.commerce_events(invoice_id,action,actor,details) values(oid,'checkout_placed','customer:'||uid,jsonb_build_object('amount_cents',total,'currency',p_data->>'currency','version',version));
  if total=0 then
    update public.commerce_invoices set status='paid',paid_at=now(),version=commerce_invoices.version+1 where id=oid;
    insert into public.commerce_events(invoice_id,action,actor,details) values(oid,'payment_recorded','account-balance',jsonb_build_object('amount_cents',0,'balance_only',true));
  end if;
  return jsonb_build_object('id',oid,'status',case when total=0 then 'paid' else 'accepted' end,'currency',p_data->>'currency','total_cents',total,'manual_transfer',is_cad,'created',true);
end $function$
;
