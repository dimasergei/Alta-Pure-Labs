-- New storefront checkout only: regular catalog prices, explicit BLACKFRIDAY15,
-- and free US standard shipping on merchandise >= $150 after the coupon.
-- No existing invoice, receipt, balance, subscription, or fulfillment row is changed.
-- Deploy the v5 application after this migration; older quote versions fail closed.

create or replace function commerce_internal.regular_delivery_quote(p_selection jsonb, p_country text, p_merchandise integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare
  shipping_id text:=p_selection->>'shipping';
  ids text[]; extra_id text; option_row public.commerce_delivery_options%rowtype;
  ship integer; extras_total integer:=0; extras jsonb:='[]'::jsonb;
begin
  if jsonb_typeof(p_selection) is distinct from 'object'
    or shipping_id is null or shipping_id not in ('standard','express','next_day')
    or jsonb_typeof(p_selection->'extras') is distinct from 'array'
    or jsonb_array_length(p_selection->'extras')>2
    or p_merchandise is null or p_merchandise<0
    or p_country is null or p_country !~ '^[A-Z]{2}$'
    or p_country in ('RU','BY','IR','KP','CU','SY')
    or not (p_country=any(string_to_array('AF,AX,AL,DZ,AS,AD,AO,AI,AQ,AG,AR,AM,AW,AU,AT,AZ,BS,BH,BD,BB,BE,BZ,BJ,BM,BT,BO,BQ,BA,BW,BV,BR,IO,BN,BG,BF,BI,CV,KH,CM,CA,KY,CF,TD,CL,CN,CX,CC,CO,KM,CG,CD,CK,CR,CI,HR,CW,CY,CZ,DK,DJ,DM,DO,EC,EG,SV,GQ,ER,EE,SZ,ET,FK,FO,FJ,FI,FR,GF,PF,TF,GA,GM,GE,DE,GH,GI,GR,GL,GD,GP,GU,GT,GG,GN,GW,GY,HT,HM,VA,HN,HK,HU,IS,IN,ID,IQ,IE,IM,IL,IT,JM,JP,JE,JO,KZ,KE,KI,KR,KW,KG,LA,LV,LB,LS,LR,LY,LI,LT,LU,MO,MG,MW,MY,MV,ML,MT,MH,MQ,MR,MU,YT,MX,FM,MD,MC,MN,ME,MS,MA,MZ,MM,NA,NR,NP,NL,NC,NZ,NI,NE,NG,NU,NF,MK,MP,NO,OM,PK,PW,PS,PA,PG,PY,PE,PH,PN,PL,PT,PR,QA,RE,RO,RW,BL,SH,KN,LC,MF,PM,VC,WS,SM,ST,SA,SN,RS,SC,SL,SG,SX,SK,SI,SB,SO,ZA,GS,SS,ES,LK,SD,SR,SJ,SE,CH,TW,TJ,TZ,TH,TL,TG,TK,TO,TT,TN,TR,TM,TC,TV,UG,UA,AE,GB,UM,US,UY,UZ,VU,VE,VN,VG,VI,WF,EH,YE,ZM,ZW',',')))
  then raise exception 'Invalid delivery selection' using errcode='22023'; end if;
  if not exists(select 1 from public.commerce_delivery_options where id=shipping_id and kind='shipping' and enabled)
  then raise exception 'Shipping option unavailable' using errcode='P0001'; end if;
  ship:=case p_country
    when 'US' then case shipping_id when 'standard' then case when p_merchandise>=15000 then 0 else 1495 end when 'express' then 3495 when 'next_day' then 6995 end
    when 'CA' then case shipping_id when 'standard' then 3995 when 'express' then 5995 end
    else case shipping_id when 'standard' then 5995 when 'express' then 9995 end end;
  if ship is null then raise exception 'Shipping service unavailable for destination' using errcode='22023'; end if;
  select array_agg(value order by value) into ids from jsonb_array_elements_text(p_selection->'extras');
  if cardinality(ids) is distinct from (select count(distinct value)::integer from unnest(ids) value) and cardinality(ids) is not null
  then raise exception 'Duplicate delivery extra' using errcode='22023'; end if;
  foreach extra_id in array coalesce(ids,array[]::text[]) loop
    if extra_id not in ('priority','protection') then raise exception 'Unsupported delivery extra' using errcode='22023'; end if;
    select * into option_row from public.commerce_delivery_options where id=extra_id and kind='extra' and enabled;
    if not found then raise exception 'Delivery extra unavailable' using errcode='P0001'; end if;
    extras:=extras||jsonb_build_array(jsonb_build_object('id',option_row.id,'label',option_row.label,'amount_cents',option_row.price_cents));
    extras_total:=extras_total+option_row.price_cents;
  end loop;
  return jsonb_build_object('selection',jsonb_build_object('shipping',shipping_id,'extras',to_jsonb(coalesce(ids,array[]::text[]))),
    'shipping_cents',ship,'country',p_country,'rate_version','shipping-2026-11-v1',
    'extras',extras,'extras_cents',extras_total,'total_cents',ship+extras_total);
end $$;

create or replace function commerce_internal.validate_regular_checkout(p_data jsonb)
returns void language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare
  request jsonb:=p_data->'request'; pricing jsonb:=p_data->'pricing';
  item jsonb; line jsonb; k text; i integer; quantity integer; unit_cents integer; gross integer; discount integer;
  subtotal integer:=0; discounts integer:=0; code text; expected_delivery jsonb;
  seen text[]:=array[]::text[]; variant_key text; line_discounts jsonb;
begin
  if p_data->>'checkout_version' is distinct from 'checkout-2026-11-v5'
    or p_data->>'kind' is distinct from 'goods' or p_data->>'plan' is not null
    or p_data->>'membership_invoice_id' is not null or p_data->>'earned_points' is distinct from '0'
    or jsonb_typeof(request) is distinct from 'object' or jsonb_typeof(pricing) is distinct from 'object'
    or request->>'research_builder' not in ('false') or request->>'subscription' not in ('false')
    or request->>'billing_period' is not null or request->>'plan' is not null
    or request->'checkout'->>'version' is distinct from 'checkout-2026-11-v5'
    or pricing->>'checkout_version' is distinct from 'checkout-2026-11-v5'
    or pricing->>'terms_version' is distinct from 'launch-2026-11-v1'
    or pricing->>'conversion_version' is distinct from 'conversion-2026-11-v2'
    or pricing->>'currency' is distinct from 'USD' or pricing->>'fx_ppm' is distinct from '1000000'
    or pricing->>'billing_period' is not null
    or pricing ?| array['referral_discount','payment_discount','bank_discount_cents','payment_discount_cents','membership_gift','bulk_tier']
    or jsonb_typeof(request->'items') is distinct from 'array'
    or jsonb_typeof(pricing->'lines') is distinct from 'array'
  then raise exception 'Only current regular product checkout is available' using errcode='22023'; end if;
  if jsonb_array_length(request->'items') not between 1 and 60
    or jsonb_array_length(request->'items')<>jsonb_array_length(pricing->'lines')
    or (request ? 'bulk_order' and jsonb_typeof(request->'bulk_order')<>'boolean')
  then raise exception 'Invalid checkout items' using errcode='22023'; end if;
  code:=upper(btrim(coalesce(request->'checkout'->>'coupon','')));
  if code not in ('','BLACKFRIDAY15') or pricing->>'coupon_code' is distinct from code
    or pricing->>'promotion_version' is distinct from 'blackfriday15-2026-11-v1'
    or pricing->>'bogo_free_units' is distinct from '0'
  then raise exception 'Coupon unavailable or promotion changed' using errcode='22023'; end if;
  if pricing ? 'referral' and (jsonb_typeof(pricing->'referral') is distinct from 'object'
    or jsonb_typeof(pricing->'referral'->'partner_id') is distinct from 'string'
    or jsonb_typeof(pricing->'referral'->'code') is distinct from 'string'
    or jsonb_typeof(pricing->'referral'->'first_order') is distinct from 'boolean'
    or ((pricing->'referral')-array['partner_id','code','first_order']) is distinct from '{}'::jsonb)
  then raise exception 'Invalid neutral referral attribution' using errcode='22023'; end if;
  -- Order-wide rounded 15%, allocated by largest fractional remainder.
  -- Original line order resolves equal remainders deterministically.
  with amounts as (
    select ordinality, (value->>'qty')::numeric*(value->>'unit_price_usd_cents')::numeric as gross
    from jsonb_array_elements(request->'items') with ordinality
  ), parts as (
    select ordinality, floor(amounts.gross*1500/10000)::integer as base,
      row_number() over(order by mod(amounts.gross*1500,10000) desc,ordinality) as rank,
      round(sum(amounts.gross) over()*1500/10000)::integer-sum(floor(amounts.gross*1500/10000)::integer) over() as pennies
    from amounts
  ) select jsonb_agg(case when code='' then 0 else base+case when rank<=pennies then 1 else 0 end end order by ordinality)
    into line_discounts from parts;
  for i in 0..jsonb_array_length(request->'items')-1 loop
    item:=request->'items'->i; line:=pricing->'lines'->i;
    foreach k in array array['qty','unit_price_usd_cents'] loop
      if jsonb_typeof(item->k) is distinct from 'number' or item->>k !~ '^[0-9]+$'
      then raise exception 'Invalid catalog item amount' using errcode='22023'; end if;
    end loop;
    quantity:=(item->>'qty')::integer; unit_cents:=(item->>'unit_price_usd_cents')::integer;
    variant_key:=(item->>'id')||'|'||(item->>'size');
    if quantity not between 1 and 100 or unit_cents not between 1 and 1000000
      or nullif(item->>'id','') is null or nullif(item->>'name','') is null or nullif(item->>'size','') is null
      or variant_key=any(seen) or item ?| array['membership_gift','bogo_free_units','free_qty','paid_qty']
    then raise exception 'Invalid or promotional fulfillment item' using errcode='22023'; end if;
    seen:=array_append(seen,variant_key); gross:=quantity*unit_cents;
    discount:=(line_discounts->>i)::integer;
    foreach k in array array['id','name','size','qty','unit_price_usd_cents'] loop
      if line->k is distinct from item->k then raise exception 'Quoted item differs from purchased item' using errcode='22023'; end if;
    end loop;
    if line->'unit_price_cents' is distinct from to_jsonb(unit_cents)
      or line->'gross_cents' is distinct from to_jsonb(gross)
      or line->'discount_cents' is distinct from to_jsonb(discount)
      or line->'coupon_discount_cents' is distinct from to_jsonb(discount)
      or line->'line_total_cents' is distinct from to_jsonb(gross-discount)
      or line->'discount_bps' is distinct from to_jsonb(case when code='' then 0 else 1500 end)
      or line->>'discount_reason' is distinct from (case when code='' then 'none' else 'coupon_blackfriday15' end)
      or line->'bogo_free_units' is distinct from '0'::jsonb
      or line ?| array['membership_gift','free_qty','paid_qty','bank_discount_cents','payment_discount_cents','bulk_tier']
    then raise exception 'Only the explicit 15 percent coupon is available' using errcode='22023'; end if;
    subtotal:=subtotal+gross; discounts:=discounts+discount;
  end loop;
  expected_delivery:=commerce_internal.regular_delivery_quote(request->'checkout'->'delivery',request->'address'->>'country',subtotal-discounts);
  if subtotal>100000000 or p_data->'subtotal_cents' is distinct from to_jsonb(subtotal)
    or p_data->'discount_cents' is distinct from to_jsonb(discounts)
    or pricing->'subtotal_cents' is distinct from to_jsonb(subtotal)
    or pricing->'discount_cents' is distinct from to_jsonb(discounts)
    or pricing->'coupon_discount_cents' is distinct from to_jsonb(discounts)
    or pricing->'redeemed_points' is distinct from p_data->'points_redeemed'
    or pricing->'credit_cents' is distinct from p_data->'credit_redeemed_cents'
    or request->'checkout'->'points' is distinct from p_data->'points_redeemed'
    or request->'checkout'->'credit_cents' is distinct from p_data->'credit_redeemed_cents'
    or request->'checkout'->'method_id' is distinct from p_data->'method_id'
    or pricing->'delivery' is distinct from expected_delivery
    or p_data->'shipping_cents' is distinct from expected_delivery->'total_cents'
  then raise exception 'Checkout totals or delivery changed' using errcode='22023'; end if;
end $$;

revoke all on function commerce_internal.regular_delivery_quote(jsonb,text,integer) from public,anon,authenticated,service_role;
revoke all on function commerce_internal.validate_regular_checkout(jsonb) from public,anon,authenticated,service_role;

-- Retire new program writes without deleting or rewriting program history.
create or replace function commerce_internal.regular_invoice_only()
returns trigger language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
  if new.kind<>'goods' or new.plan is not null
    or new.request_data->>'research_builder'='true' or new.request_data->>'subscription'='true'
    or new.request_data->>'billing_period' is not null or new.request_data->>'plan' is not null
  then raise exception 'Memberships and subscriptions are unavailable' using errcode='P0001'; end if;
  return new;
end $$;
create trigger commerce_regular_invoice_only before insert on public.commerce_invoices
  for each row execute function commerce_internal.regular_invoice_only();

create or replace function commerce_internal.retired_membership_write()
returns trigger language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
  if tg_op='INSERT' then raise exception 'Membership activation is unavailable' using errcode='P0001'; end if;
  -- A verified historical refund can still revoke an existing membership.
  if (to_jsonb(new)-'revoked_at') is distinct from (to_jsonb(old)-'revoked_at')
    or (old.revoked_at is not null and new.revoked_at is null)
  then raise exception 'Membership changes are unavailable' using errcode='P0001'; end if;
  return new;
end $$;
create trigger commerce_retired_membership_write before insert or update on public.commerce_memberships
  for each row execute function commerce_internal.retired_membership_write();

create or replace function commerce_internal.retired_subscription_write()
returns trigger language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
  if tg_op='INSERT' then raise exception 'Subscription creation and recurrence are unavailable' using errcode='P0001'; end if;
  if tg_table_name='research_subscriptions' then
    -- Preserve historical shipment tracking and permit cancellation, never renewal.
    if (to_jsonb(new)-array['status','canceled_at','next_billing_at','first_delivery_shipped_at','updated_at'])
        is distinct from (to_jsonb(old)-array['status','canceled_at','next_billing_at','first_delivery_shipped_at','updated_at'])
      or (new.status is distinct from old.status and new.status not in ('cancel_pending','canceled'))
      or (new.next_billing_at is distinct from old.next_billing_at and new.next_billing_at is not null)
    then raise exception 'Subscription changes and renewal are unavailable' using errcode='P0001'; end if;
  else
    -- Existing paid cycles retain their refund and shipment history paths.
    if (to_jsonb(new)-array['status','shipped_at','tracking_number'])
        is distinct from (to_jsonb(old)-array['status','shipped_at','tracking_number'])
      or (new.status is distinct from old.status and new.status<>'refunded')
    then raise exception 'New subscription billing is unavailable' using errcode='P0001'; end if;
  end if;
  return new;
end $$;
create trigger research_subscriptions_retired before insert or update on public.research_subscriptions
  for each row execute function commerce_internal.retired_subscription_write();
create trigger research_subscription_cycles_retired before insert or update on public.research_subscription_cycles
  for each row execute function commerce_internal.retired_subscription_write();

revoke all on function commerce_internal.regular_invoice_only() from public,anon,authenticated,service_role;
revoke all on function commerce_internal.retired_membership_write() from public,anon,authenticated,service_role;
revoke all on function commerce_internal.retired_subscription_write() from public,anon,authenticated,service_role;


CREATE OR REPLACE FUNCTION public.commerce_place_checkout(p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
declare r public.commerce_invoices%rowtype; m public.commerce_payment_methods%rowtype; b public.commerce_balance_accounts%rowtype;
 uid uuid:=(p_data->>'customer_id')::uuid; oid uuid:=(p_data->>'id')::uuid;
 points integer:=(p_data->>'points_redeemed')::integer; credit integer:=(p_data->>'credit_redeemed_cents')::integer;
 sub integer:=(p_data->>'subtotal_cents')::integer; disc integer:=(p_data->>'discount_cents')::integer;
 ship integer:=(p_data->>'shipping_cents')::integer; tax integer:=(p_data->>'tax_cents')::integer; total integer:=(p_data->>'total_cents')::integer;
 earned integer:=(p_data->>'earned_points')::integer; n integer;
begin
 if uid is null or oid is null or jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>50000
 or p_data->>'checkout_version' is distinct from 'checkout-2026-11-v5' or p_data->>'consent' is distinct from 'true'
 or p_data->>'currency' is distinct from 'USD' or p_data->>'terms_version' is distinct from 'launch-2026-11-v1'
 or p_data->>'kind' is distinct from 'goods' then raise exception 'Invalid checkout' using errcode='22023'; end if;
 perform commerce_internal.validate_regular_checkout(p_data);
 -- Order lock precedes account lock, matching existing payment/refund transitions.
 perform pg_advisory_xact_lock(hashtextextended(oid::text,23));
 select * into r from public.commerce_invoices where id=oid for update;
 if found then
  if r.customer_id<>uid or r.request_digest<>p_data->>'digest' or r.checkout_version is distinct from p_data->>'checkout_version' then raise exception 'Checkout reference conflict' using errcode='23505'; end if;
  return jsonb_build_object('id',r.id,'status',r.status,'replayed',true);
 end if;
 -- Preserve the account lock shared with concurrent redemptions and refunds.
 perform pg_advisory_xact_lock(hashtextextended(uid::text,0));
 insert into public.commerce_balance_accounts(customer_id) values(uid) on conflict do nothing;
 select * into b from public.commerce_balance_accounts where customer_id=uid for update;
 select count(*) into n from public.commerce_invoices where customer_id=uid and status in ('requested','issued','accepted');
 if n>=10 then raise exception 'Cancel unpaid orders before creating more' using errcode='P0001'; end if;
 select * into m from public.commerce_payment_methods where id=(p_data->>'method_id')::uuid and active and currency='USD' for share;
 if not found or m.version is distinct from (p_data->>'method_version')::integer or m.sale_scope not in ('both',p_data->>'kind')
 or (m.native_provider is null and m.kind<>'bank_transfer') then raise exception 'Payment method changed' using errcode='P0001'; end if;
 if m.native_provider is not null and not exists(select 1 from public.commerce_gateway_accounts where method_id=m.id and mode='live'
  and (p_data->'request'->'address'->>'country')=any(countries)) then raise exception 'Live gateway scope unavailable' using errcode='P0001'; end if;
 if sub is null or disc is null or ship is null or tax is null or total is null or points is null or credit is null or earned is null
 or points<0 or credit<0 or points>greatest(0,b.points) or credit>b.credit_cents or (points>0 and points<100)
 or points>sub-disc or total<>sub-disc+ship+tax-points-credit or total<0 or tax<>0 or earned<>0
 then raise exception 'Invalid checkout amount or balance' using errcode='P0001'; end if;
 if p_data->'pricing'->'referral' is not null then perform commerce_internal.validate_referral(uid,p_data->>'customer_email',p_data->'pricing'->'referral'); end if;
 insert into public.commerce_invoices(id,customer_id,customer_email,customer_name,kind,plan,request_digest,request_data,terms_version,status,currency,
 pricing,subtotal_cents,discount_cents,shipping_cents,tax_cents,total_cents,method_id,payment_snapshot,expires_at,accepted_at,checkout_version,points_redeemed,credit_redeemed_cents,earned_points)
 values(oid,uid,lower(trim(p_data->>'customer_email')),p_data->>'customer_name',p_data->>'kind',p_data->>'plan',p_data->>'digest',p_data->'request',p_data->>'terms_version','accepted','USD',
 p_data->'pricing',sub,disc,ship,tax,total,m.id,jsonb_build_object('kind',m.kind,'label',m.label,'payee',m.payee,'instructions',m.instructions,'method_version',m.version,
 'payment_url',case when m.native_provider is not null then 'https://getpurelabs.com/pay.html?invoice='||oid::text else null end),
 now()+interval '24 hours',now(),p_data->>'checkout_version',points,credit,earned);
 perform commerce_internal.balance_event(uid,oid,'points',-points,'Checkout redemption',oid||':redeem-points','customer:'||uid);
 perform commerce_internal.balance_event(uid,oid,'credit',-credit,'Checkout credit',oid||':redeem-credit','customer:'||uid);
 insert into public.commerce_events(invoice_id,action,actor,details) values(oid,'checkout_placed','customer:'||uid,jsonb_build_object('amount_cents',total,'currency','USD','version',p_data->>'checkout_version'));
 if total=0 then
  update public.commerce_invoices set status='paid',paid_at=now(),version=version+1 where id=oid;
  insert into public.commerce_events(invoice_id,action,actor,details) values(oid,'payment_recorded','account-balance',jsonb_build_object('amount_cents',0,'balance_only',true));
 end if;
 return jsonb_build_object('id',oid,'status',case when total=0 then 'paid' else 'accepted' end,'created',true);
end $function$
;
revoke all on function public.commerce_place_checkout(jsonb) from public,anon,authenticated;
grant execute on function public.commerce_place_checkout(jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.commerce_request_invoice(p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
declare r public.commerce_invoices%rowtype; n integer; uid uuid; kind text;
begin
 if p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>30000 then raise exception 'Invalid invoice request' using errcode='22023'; end if;
 uid:=(p_data->>'customer_id')::uuid; kind:=p_data->>'kind';
 if uid is null or kind is distinct from 'goods' or p_data->>'plan' is not null or p_data->'request'->>'research_builder'='true' or p_data->'request'->>'subscription'='true' or p_data->'request'->>'billing_period' is not null or p_data->>'terms_version' is distinct from 'launch-2026-11-v1'
  or p_data->>'consent' is distinct from 'true' then raise exception 'Invoice consent required' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text,0));
 select count(*) into n from public.commerce_invoices where customer_id=uid and status in ('requested','issued','accepted');
 if n>=10 and not exists(select 1 from public.commerce_invoices where id=(p_data->>'id')::uuid) then raise exception 'Too many open invoices' using errcode='P0001'; end if;
 insert into public.commerce_invoices(id,customer_id,customer_email,customer_name,kind,plan,request_digest,request_data)
 values((p_data->>'id')::uuid,uid,lower(trim(p_data->>'customer_email')),p_data->>'customer_name',kind,p_data->>'plan',p_data->>'digest',p_data->'request') on conflict(id) do nothing;
 get diagnostics n=row_count;
 select * into r from public.commerce_invoices where id=(p_data->>'id')::uuid for update;
 if r.customer_id<>uid or r.request_digest<>p_data->>'digest' then raise exception 'Request ID conflict' using errcode='23505'; end if;
 if n=1 then insert into public.commerce_events(invoice_id,action,actor,details) values(r.id,'requested','customer:'||uid::text,jsonb_build_object('terms_version',r.terms_version)); end if;
 return jsonb_build_object('id',r.id,'status',r.status,'created',n=1);
end $function$
;
revoke all on function public.commerce_request_invoice(jsonb) from public,anon,authenticated;
grant execute on function public.commerce_request_invoice(jsonb) to service_role;

CREATE OR REPLACE FUNCTION commerce_internal.fulfillment_seed(p_invoice uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
declare
  r public.commerce_invoices%rowtype;
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

  -- New paid orders fulfill exactly their purchased catalog quantities.
end $function$
;
revoke all on function commerce_internal.fulfillment_seed(uuid) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION commerce_internal.platinum_monthly_reward()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
declare
  oldref text;
  credit_balance integer;
begin
  if new.kind<>'goods' or new.customer_id is null or new.status=old.status then return new; end if;
  -- Preserve reversal of credits issued before the storefront reset.
  if new.status='refunded' then
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
end $function$
;
revoke all on function commerce_internal.platinum_monthly_reward() from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.commerce_accept_invoice(p_id uuid, p_customer uuid, p_version integer, p_terms text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
declare r public.commerce_invoices%rowtype;
begin
 select * into r from public.commerce_invoices where id=p_id and customer_id=p_customer for update;
 if not found then raise exception 'Invoice not found' using errcode='P0002'; end if;
 if r.kind<>'goods' then raise exception 'Membership purchases are unavailable' using errcode='P0001'; end if;
 if r.status='accepted' then return jsonb_build_object('id',r.id,'status',r.status); end if;
 if r.status<>'issued' or r.version<>p_version or r.expires_at<=now() or p_terms is distinct from r.terms_version
  or not exists(select 1 from public.commerce_payment_methods where id=r.method_id and active) then
  raise exception 'Invoice changed, expired, or payment method unavailable' using errcode='P0001'; end if;
 update public.commerce_invoices set status='accepted',accepted_at=now(),version=version+1,updated_at=now() where id=p_id;
 insert into public.commerce_events(invoice_id,action,actor,details) values(p_id,'accepted','customer:'||p_customer::text,jsonb_build_object('terms_version',r.terms_version,'total_cents',r.total_cents,'currency',r.currency));
 return jsonb_build_object('id',p_id,'status','accepted');
end $function$
;
revoke all on function public.commerce_accept_invoice(uuid,uuid,integer,text) from public,anon,authenticated;
grant execute on function public.commerce_accept_invoice(uuid,uuid,integer,text) to service_role;

CREATE OR REPLACE FUNCTION public.commerce_begin_gateway_attempt(p_id uuid, p_invoice uuid, p_customer uuid, p_operation text, p_account_tag text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
declare i public.commerce_invoices%rowtype; a public.commerce_gateway_accounts%rowtype; m public.commerce_payment_methods%rowtype; old public.commerce_gateway_attempts%rowtype;
begin
 if p_id is null or p_customer is null or p_operation is null or p_operation not in ('sale','refund') then raise exception 'Invalid payment command' using errcode='22023'; end if;
 select * into i from public.commerce_invoices where id=p_invoice and customer_id=p_customer for update;
 if not found then raise exception 'Invoice not found' using errcode='P0002'; end if;
 if p_operation='sale' and i.kind<>'goods' then raise exception 'Membership payments are unavailable' using errcode='P0001'; end if;
 select * into old from public.commerce_gateway_attempts where id=p_id;
 if found then
  if old.invoice_id<>i.id or old.operation<>p_operation or old.account_tag<>p_account_tag then raise exception 'Attempt ID conflict' using errcode='23505'; end if;
  return to_jsonb(old)||jsonb_build_object('claimed',false);
 end if;
 select * into a from public.commerce_gateway_accounts where method_id=i.method_id;
 select * into m from public.commerce_payment_methods where id=i.method_id for share;
 if a.method_id is null or a.account_tag is distinct from p_account_tag or not m.active then raise exception 'Gateway unavailable' using errcode='P0001'; end if;
 if p_operation='sale' then
  if i.status<>'accepted' or i.expires_at<=now() or (m.sale_scope<>'both' and m.sale_scope<>i.kind)
   or (i.kind='goods' and not ((i.request_data->'address'->>'country')=any(a.countries))) then raise exception 'Invoice not payable on this route' using errcode='P0001'; end if;
  select * into old from public.commerce_gateway_attempts where invoice_id=i.id and operation='sale' and state<>'declined';
  if found then return to_jsonb(old)||jsonb_build_object('claimed',false); end if;
 else
  if a.provider<>'nmi' or i.status not in ('paid','processing','shipped','delivered') then raise exception 'Refund not available' using errcode='P0001'; end if;
  select * into old from public.commerce_gateway_attempts where invoice_id=i.id and operation='refund';
  if found then return to_jsonb(old)||jsonb_build_object('claimed',false); end if;
  if not exists(select 1 from public.commerce_gateway_attempts where invoice_id=i.id and operation='sale' and state='paid' and provider='nmi') then raise exception 'Native payment not found' using errcode='P0001'; end if;
 end if;
 insert into public.commerce_gateway_attempts(id,invoice_id,method_id,provider,mode,account_tag,operation,amount_cents,currency)
 values(p_id,i.id,m.id,a.provider,a.mode,a.account_tag,p_operation,i.total_cents,i.currency) returning * into old;
 return to_jsonb(old)||jsonb_build_object('claimed',true);
end $function$
;
revoke all on function public.commerce_begin_gateway_attempt(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.commerce_begin_gateway_attempt(uuid,uuid,uuid,text,text) to service_role;

-- Preserve the existing partner program, without a customer referral discount.
CREATE OR REPLACE FUNCTION commerce_internal.partner_order_transition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
declare pid uuid; first_id uuid; basis integer; rate integer;
begin
 if new.kind<>'goods' or old.status=new.status then return new; end if;
 perform 1 from public.commerce_partners where customer_id in (select partner_id from public.commerce_partner_commissions where invoice_id=new.id) for update;
 if new.status='paid' and old.status='accepted' and new.checkout_version in ('checkout-2026-11-v3','checkout-2026-11-v4','checkout-2026-11-v5') then
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
end $function$
;
revoke all on function commerce_internal.partner_order_transition() from public,anon,authenticated,service_role;
