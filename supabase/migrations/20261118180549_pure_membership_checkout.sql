-- Restore prepaid PURE WHITE / PURE BLACK benefits on independently validated
-- checkout v8 (USD) and Interac v2 (CAD). No recurring mandate is created.
-- Existing orders, balances, memberships and subscription history are preserved.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

-- Keep the exact deployed goods contracts available during the deployment
-- handoff and a code rollback. These copies are private and never accept a
-- legacy membership or recurring checkout. Their internal validator calls are
-- dispatched by the public compatibility functions below.
do $preserve$
declare source_name text;target_name text;expected_version text;definition text;header text;replacement text;
begin
  for source_name,target_name,expected_version in values
    ('commerce_internal.validate_regular_checkout','commerce_internal.legacy_pure_validate_checkout_v7','checkout-2026-11-v7'),
    ('public.commerce_place_checkout','commerce_internal.legacy_pure_place_checkout_v7','checkout-2026-11-v7'),
    ('commerce_internal.validate_interac_checkout','commerce_internal.legacy_pure_validate_interac_v1','checkout-interac-cad-2026-11-v1'),
    ('public.commerce_place_interac_checkout','commerce_internal.legacy_pure_place_interac_v1','checkout-interac-cad-2026-11-v1')
  loop
    definition:=pg_get_functiondef((source_name||'(jsonb)')::regprocedure);
    header:='CREATE OR REPLACE FUNCTION '||source_name||'(p_data jsonb)';
    replacement:='CREATE OR REPLACE FUNCTION '||target_name||'(p_data jsonb)';
    if position(header in definition)<>1 or position(quote_literal(expected_version) in definition)=0
    then raise exception 'Installed checkout contract changed; review compatibility before migrating' using errcode='P0001';end if;
    execute replace(definition,header,replacement);
    execute 'revoke all on function '||target_name||'(jsonb) from public,anon,authenticated,service_role';
  end loop;
end $preserve$;

alter table public.commerce_invoices
  add column membership_invoice_id uuid references public.commerce_memberships(invoice_id),
  add column priority_fulfillment boolean not null default false;
create index commerce_membership_order_idx on public.commerce_invoices(membership_invoice_id)
  where membership_invoice_id is not null;
create index commerce_priority_paid_order_idx on public.commerce_invoices(priority_fulfillment desc,paid_at,id)
  where kind='goods' and status in ('paid','processing');

create function commerce_internal.active_paid_membership(p_customer uuid,p_at timestamptz)
returns public.commerce_memberships language sql stable security definer
set search_path=pg_catalog,pg_temp as $$
  select m.* from public.commerce_memberships m
  join public.commerce_invoices i on i.id=m.invoice_id and i.customer_id=m.customer_id
    and i.plan=m.plan and i.kind='membership' and i.status='paid'
  where m.customer_id=p_customer and m.revoked_at is null and m.starts_at<=p_at and m.expires_at>p_at
  order by case m.plan when 'elite' then 2 when 'vip' then 1 else 0 end desc,m.expires_at desc,m.invoice_id
  limit 1
$$;

-- Round at order level and distribute cents deterministically, including ties.
create function commerce_internal.checkout_discount_parts(p_amounts jsonb,p_bps integer)
returns jsonb language sql immutable set search_path=pg_catalog,pg_temp as $$
  with amounts as (
    select ordinality,value::numeric as gross from jsonb_array_elements_text(p_amounts) with ordinality
  ), parts as (
    select ordinality,floor(gross*p_bps/10000)::integer as base,
      row_number() over(order by mod(gross*p_bps,10000) desc,ordinality) as rank,
      round(sum(gross) over()*p_bps/10000)::integer-sum(floor(gross*p_bps/10000)::integer) over() as pennies
    from amounts
  ) select coalesce(jsonb_agg(base+case when rank<=pennies then 1 else 0 end order by ordinality),'[]'::jsonb) from parts
$$;

create function commerce_internal.membership_delivery_quote(p_selection jsonb,p_country text,p_merchandise integer,p_plan text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare q jsonb; free boolean; included_extras jsonb; extras_total integer;
begin
  q:=commerce_internal.regular_delivery_quote(p_selection,p_country,p_merchandise);
  free:=coalesce(p_plan in ('vip','elite') and p_country='US' and p_selection->>'shipping' in ('standard','express'),false);
  q:=q||jsonb_build_object('membership_shipping',free);
  if free then q:=q||jsonb_build_object('shipping_cents',0,'total_cents',(q->>'extras_cents')::integer);end if;
  if p_plan='elite' then
    select coalesce(jsonb_agg(case when value->>'id'='priority' then value||jsonb_build_object('amount_cents',0,'included_by_membership',true) else value end order by ordinality),'[]'::jsonb),
      coalesce(sum(case when value->>'id'='priority' then 0 else (value->>'amount_cents')::integer end),0)::integer
      into included_extras,extras_total from jsonb_array_elements(q->'extras') with ordinality;
    q:=q||jsonb_build_object('extras',included_extras,'extras_cents',extras_total,'total_cents',(q->>'shipping_cents')::integer+extras_total);
  end if;
  return q;
end $$;

create function commerce_internal.validate_membership_checkout(p_data jsonb)
returns void language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare
  request jsonb:=p_data->'request'; pricing jsonb:=p_data->'pricing'; fx jsonb:=pricing->'fx';
  item jsonb; line jsonb; key text; n integer; quantity integer; unit_usd integer; unit integer; gross integer;
  is_cad boolean:=p_data->>'currency'='CAD'; is_goods boolean:=p_data->>'kind'='goods';
  version text; method public.commerce_payment_methods%rowtype; member public.commerce_memberships%rowtype;
  member_rate integer:=0; earning_rate integer:=0; coupon_rate integer:=0; base_rate integer:=0; crypto_rate integer:=0;
  member_applied boolean:=false; usd_member_applied boolean:=false; crypto_eligible boolean:=false; suppressed boolean:=false;
  code text; base_source text; source text; reason text; variant text; seen text[]:=array[]::text[]; product_ids text[]:=array[]::text[];
  rate integer:=1000000; quoted timestamptz; expiry timestamptz; rate_date date;
  amounts jsonb:='[]'::jsonb; usd_amounts jsonb:='[]'::jsonb; net_amounts jsonb:='[]'::jsonb; base_parts jsonb; crypto_parts jsonb;
  subtotal integer:=0; usd_subtotal integer:=0; base_discount integer:=0; usd_base_discount integer:=0;
  discounts integer:=0; member_discount integer:=0; coupon_discount integer:=0; crypto_discount integer:=0;
  line_base integer; line_member integer; line_coupon integer; line_crypto integer; usd_net integer; earning_basis integer; expected_earned integer;
  points integer:=(p_data->>'points_redeemed')::integer; credit integer:=(p_data->>'credit_redeemed_cents')::integer;
  expected_delivery jsonb; usd_delivery jsonb; delivery_extras jsonb; shipping integer:=0; extras integer:=0;
  fee integer; period text:=request->>'billing_period';
begin
  version:=case when is_cad then 'checkout-interac-cad-2026-11-v2' else 'checkout-2026-11-v8' end;
  if p_data->>'currency' is null or p_data->>'currency' not in ('USD','CAD')
    or p_data->>'kind' is null or p_data->>'kind' not in ('goods','membership')
    or p_data->>'checkout_version' is distinct from version
    or jsonb_typeof(request) is distinct from 'object' or jsonb_typeof(pricing) is distinct from 'object'
    or request->'checkout'->>'version' is distinct from 'checkout-2026-11-v8'
    or pricing->>'checkout_version' is distinct from version
    or pricing->>'conversion_version' is distinct from 'conversion-2026-11-v3'
    or pricing->>'terms_version' is distinct from 'launch-2026-11-v1'
    or pricing->>'currency' is distinct from p_data->>'currency'
    or coalesce(request->>'subscription','false')<>'false' or coalesce(request->>'research_builder','false')<>'false'
    or (request ? 'research_builder_mode' and request->>'research_builder_mode' is distinct from 'one_time')
    or pricing ?| array['referral_discount','payment_discount','bank_discount_cents','payment_discount_cents','membership_gift','bulk_tier','delivery_tax']
    or jsonb_typeof(request->'items') is distinct from 'array' or jsonb_typeof(pricing->'lines') is distinct from 'array'
    or request->'checkout'->'method_id' is distinct from p_data->'method_id'
    or points is null or credit is null or points<0 or credit<0
    or pricing->'redeemed_points' is distinct from p_data->'points_redeemed'
    or pricing->'credit_cents' is distinct from p_data->'credit_redeemed_cents'
    or request->'checkout'->'points' is distinct from p_data->'points_redeemed'
    or request->'checkout'->'credit_cents' is distinct from p_data->'credit_redeemed_cents'
    or p_data->'tax_cents' is distinct from '0'::jsonb
  then raise exception 'Current PURE checkout details required' using errcode='22023';end if;
  if jsonb_array_length(request->'items') not between 1 and 60
    or jsonb_array_length(request->'items')<>jsonb_array_length(pricing->'lines')
    or (request ? 'bulk_order' and jsonb_typeof(request->'bulk_order') is distinct from 'boolean')
  then raise exception 'Invalid checkout items' using errcode='22023';end if;
  select * into method from public.commerce_payment_methods where id=(p_data->>'method_id')::uuid;
  if is_cad then
    if method.kind is distinct from 'interac' or method.provider_key is distinct from 'interac' or method.currency is distinct from 'CAD' or method.native_provider is not null
      or p_data->>'payment_currency' is distinct from 'CAD' or p_data->'manual_transfer' is distinct from 'true'::jsonb or p_data ? 'request_only'
      or request->'address'->>'country' is distinct from 'CA' or request->'checkout'->>'payment_kind' is distinct from 'interac'
      or request->'checkout' ?| array['request_only','usd_estimate']
      or coalesce(request->'checkout'->>'input_digest','') !~ '^[a-f0-9]{64}$'
      or request->'checkout'->'payment_method_version' is distinct from p_data->'method_version'
      or request->'preferred_payment'->'method_id' is distinct from p_data->'method_id'
      or request->'preferred_payment'->>'provider_key' is distinct from 'interac'
      or request->'preferred_payment'->>'currency' is distinct from 'CAD'
      or points<>0 or credit<>0
    then raise exception 'Invalid CAD Interac checkout or USD balance redemption' using errcode='22023';end if;
    if jsonb_typeof(fx) is distinct from 'object' or jsonb_typeof(fx->'fx_ppm') is distinct from 'number'
      or coalesce(fx->>'fx_ppm','') !~ '^[0-9]+$' or fx->'fx_ppm' is distinct from pricing->'fx_ppm'
      or fx->>'source' is distinct from 'Bank of Canada' or fx->>'series' is distinct from 'FXUSDCAD'
      or coalesce(fx->>'rate_date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or jsonb_typeof(fx->'quoted_at') is distinct from 'string' or jsonb_typeof(fx->'expires_at') is distinct from 'string'
      or (fx-array['fx_ppm','source','series','rate_date','quoted_at','expires_at']) is distinct from '{}'::jsonb
    then raise exception 'Invalid CAD exchange-rate quote' using errcode='22023';end if;
    rate:=(fx->>'fx_ppm')::integer;quoted:=(fx->>'quoted_at')::timestamptz;expiry:=(fx->>'expires_at')::timestamptz;rate_date:=(fx->>'rate_date')::date;
    if rate not between 100000 and 10000000 or quoted>now()+interval '2 minutes' or expiry<=now() or expiry<=quoted or expiry>quoted+interval '30 minutes'
      or rate_date>(now() at time zone 'America/Toronto')::date or rate_date<(now() at time zone 'America/Toronto')::date-7
    then raise exception 'CAD exchange-rate quote changed or expired' using errcode='P0001';end if;
  else
    if pricing->'fx_ppm' is distinct from '1000000'::jsonb or method.currency is distinct from 'USD'
      or method.native_provider is null or method.native_provider not in ('rampex','polygon_usdc')
      or (method.native_provider='rampex' and not exists(select 1 from public.commerce_gateway_accounts where method_id=method.id and provider='rampex' and rampex_provider='hosted'))
    then raise exception 'Choose the current Card or Crypto checkout route' using errcode='22023';end if;
    crypto_eligible:=method.native_provider='polygon_usdc' and is_goods;
  end if;
  member:=commerce_internal.active_paid_membership((p_data->>'customer_id')::uuid,now());
  if member.invoice_id is distinct from (p_data->>'membership_invoice_id')::uuid
  then raise exception 'Membership changed; refresh checkout' using errcode='40001';end if;

  if not is_goods then
    period:=request->>'billing_period';
    fee:=case period when 'monthly' then case p_data->>'plan' when 'vip' then 1999 when 'elite' then 9999 end
      when 'annual' then case p_data->>'plan' when 'vip' then 19190 when 'elite' then 95990 end end;
    item:=request->'items'->0;line:=pricing->'lines'->0;unit:=round(fee::numeric*rate/1000000)::integer;
    if member.invoice_id is not null or fee is null or p_data->>'plan' not in ('vip','elite')
      or jsonb_array_length(request->'items')<>1 or item->>'id' is distinct from 'membership-'||(p_data->>'plan')
      or item->>'size' is distinct from period or item->'qty' is distinct from '1'::jsonb
      or item->'unit_price_usd_cents' is distinct from to_jsonb(fee)
      or coalesce(item->>'name','')='' or item ?| array['membership_gift','bogo_free_units','free_qty','paid_qty']
      or pricing->>'billing_period' is distinct from period or coalesce(request->'checkout'->>'coupon','')<>''
      or pricing->>'billing_mode' is distinct from 'prepaid' or pricing->'automatic_renewal' is distinct from 'false'::jsonb
      or coalesce(request->>'automatic_renewal','false')<>'false'
      or points<>0 or credit<>0 or p_data->'earned_points' is distinct from '0'::jsonb
      or p_data->'discount_cents' is distinct from '0'::jsonb or pricing->'discount_cents' is distinct from '0'::jsonb
      or p_data->'shipping_cents' is distinct from '0'::jsonb
      or p_data->'subtotal_cents' is distinct from to_jsonb(unit) or pricing->'subtotal_cents' is distinct from to_jsonb(unit)
      or p_data->'total_cents' is distinct from to_jsonb(unit)
      or request ? 'research_builder_mode' or request->'bulk_order'='true'::jsonb
      or (request ? 'plan' and request->>'plan' is distinct from p_data->>'plan')
      or pricing ? 'referral'
    then raise exception 'Invalid or existing prepaid membership purchase' using errcode='22023';end if;
    foreach key in array array['id','name','size','qty','unit_price_usd_cents'] loop
      if line->key is distinct from item->key then raise exception 'Membership item changed' using errcode='22023';end if;
    end loop;
    if line->'unit_price_cents' is distinct from to_jsonb(unit) or line->'gross_cents' is distinct from to_jsonb(unit)
      or line->'line_total_cents' is distinct from to_jsonb(unit) or line->'discount_cents' is distinct from '0'::jsonb
      or coalesce((line->>'discount_bps')::integer,0)<>0
    then raise exception 'Membership fee changed' using errcode='22023';end if;
    foreach key in array array['coupon_discount_cents','membership_discount_cents','crypto_discount_cents','bogo_free_units'] loop
      if coalesce((pricing->>key)::integer,0)<>0 or coalesce((line->>key)::integer,0)<>0 then raise exception 'Membership fees cannot be discounted' using errcode='22023';end if;
    end loop;
    return;
  end if;

  if p_data->>'plan' is not null or period is not null or request->>'plan' is not null or pricing->>'billing_period' is not null
    or request->'research_use_confirmed' is distinct from 'true'::jsonb
  then raise exception 'Invalid goods checkout' using errcode='22023';end if;
  member_rate:=case member.plan when 'vip' then 500 when 'elite' then 1000 else 0 end;
  earning_rate:=case member.plan when 'vip' then 5 when 'elite' then 10 else 0 end;
  if pricing->>'membership_plan' is distinct from member.plan
    or pricing->'membership_discount_bps' is distinct from to_jsonb(member_rate)
    or pricing->'membership_benefits' is distinct from jsonb_build_object('free_shipping',member.invoice_id is not null,'priority_fulfillment',coalesce(member.plan='elite',false),'free_bac_water_3ml',coalesce(member.plan='elite',false))
  then raise exception 'Membership benefits changed' using errcode='40001';end if;
  code:=upper(btrim(coalesce(request->'checkout'->>'coupon','')));coupon_rate:=case when code='BLACKFRIDAY15' then 1500 else 0 end;
  if code not in ('','BLACKFRIDAY15') or request->'checkout'->>'coupon' is distinct from code
    or pricing->>'coupon_code' is distinct from code or pricing->>'promotion_version' is distinct from 'blackfriday15-2026-11-v1'
    or pricing->'bogo_free_units' is distinct from '0'::jsonb
  then raise exception 'Coupon or promotion changed' using errcode='22023';end if;
  if pricing ? 'referral' and (jsonb_typeof(pricing->'referral') is distinct from 'object'
    or jsonb_typeof(pricing->'referral'->'partner_id') is distinct from 'string'
    or jsonb_typeof(pricing->'referral'->'code') is distinct from 'string'
    or jsonb_typeof(pricing->'referral'->'first_order') is distinct from 'boolean'
    or ((pricing->'referral')-array['partner_id','code','first_order']) is distinct from '{}'::jsonb)
  then raise exception 'Invalid neutral referral attribution' using errcode='22023';end if;
  for n in 0..jsonb_array_length(request->'items')-1 loop
    item:=request->'items'->n;
    foreach key in array array['qty','unit_price_usd_cents'] loop
      if jsonb_typeof(item->key) is distinct from 'number' or item->>key !~ '^[0-9]+$' then raise exception 'Invalid catalog amount' using errcode='22023';end if;
    end loop;
    quantity:=(item->>'qty')::integer;unit_usd:=(item->>'unit_price_usd_cents')::integer;variant:=(item->>'id')||'|'||(item->>'size');
    if quantity not between 1 and 100 or unit_usd not between 1 and 1000000 or nullif(item->>'id','') is null or nullif(item->>'name','') is null or nullif(item->>'size','') is null
      or variant=any(seen) or item ?| array['membership_gift','bogo_free_units','free_qty','paid_qty']
    then raise exception 'Invalid purchased product' using errcode='22023';end if;
    if request->>'research_builder_mode'='one_time' and (jsonb_array_length(request->'items')<>4 or quantity<>1 or item->>'id'=any(product_ids)
      or item->>'id' ~ '^(bac-|needle|syringe|supply|gift-)')
    then raise exception 'Research Builder requires four different compounds' using errcode='22023';end if;
    seen:=array_append(seen,variant);product_ids:=array_append(product_ids,item->>'id');unit:=round(unit_usd::numeric*rate/1000000)::integer;
    if unit<1 then raise exception 'Converted product amount is too small' using errcode='22023';end if;
    gross:=unit*quantity;subtotal:=subtotal+gross;usd_subtotal:=usd_subtotal+unit_usd*quantity;
    if subtotal>100000000 or usd_subtotal>100000000 then raise exception 'Checkout amount exceeds supported range' using errcode='22023';end if;
    amounts:=amounts||to_jsonb(gross);usd_amounts:=usd_amounts||to_jsonb(unit_usd*quantity);
  end loop;
  member_applied:=round(subtotal::numeric*member_rate/10000)>round(subtotal::numeric*coupon_rate/10000);
  base_rate:=case when member_applied then member_rate else coupon_rate end;
  base_discount:=round(subtotal::numeric*base_rate/10000)::integer;
  base_parts:=commerce_internal.checkout_discount_parts(amounts,base_rate);
  for n in 0..jsonb_array_length(amounts)-1 loop net_amounts:=net_amounts||to_jsonb((amounts->>n)::integer-(base_parts->>n)::integer);end loop;
  if crypto_eligible then
    expected_delivery:=commerce_internal.membership_delivery_quote(request->'checkout'->'delivery',request->'address'->>'country',subtotal-base_discount-round((subtotal-base_discount)::numeric*500/10000)::integer,member.plan);
    suppressed:=points+credit>=subtotal-base_discount-round((subtotal-base_discount)::numeric*500/10000)::integer+(expected_delivery->>'total_cents')::integer;
  end if;
  crypto_rate:=case when crypto_eligible and not suppressed then 500 else 0 end;
  crypto_parts:=commerce_internal.checkout_discount_parts(net_amounts,crypto_rate);
  member_discount:=case when member_applied then base_discount else 0 end;coupon_discount:=case when member_applied then 0 else base_discount end;
  crypto_discount:=round((subtotal-base_discount)::numeric*crypto_rate/10000)::integer;discounts:=base_discount+crypto_discount;
  base_source:=case when member_discount>0 then 'membership' when coupon_discount>0 then 'coupon' else 'none' end;
  source:=case when crypto_rate>0 then case when base_source='none' then 'crypto' else base_source||'_crypto' end else base_source end;
  if pricing->>'payment_discount_version' is distinct from 'pure-payments-2026-11-v2'
    or pricing->'crypto_discount_eligible' is distinct from to_jsonb(crypto_eligible)
    or pricing->'crypto_discount_suppressed_for_balance' is distinct from to_jsonb(suppressed)
    or pricing->>'discount_source' is distinct from source
  then raise exception 'Payment discount policy changed' using errcode='22023';end if;
  for n in 0..jsonb_array_length(request->'items')-1 loop
    item:=request->'items'->n;line:=pricing->'lines'->n;gross:=(amounts->>n)::integer;
    unit:=round((item->>'unit_price_usd_cents')::numeric*rate/1000000)::integer;line_base:=(base_parts->>n)::integer;line_crypto:=(crypto_parts->>n)::integer;
    line_member:=case when member_applied then line_base else 0 end;line_coupon:=case when member_applied then 0 else line_base end;
    reason:=case when member_applied then 'membership_'||member.plan when code<>'' then 'coupon_blackfriday15' else 'none' end;
    if crypto_rate>0 then reason:=case when line_member>0 then reason||'_crypto_direct' when line_coupon>0 then 'coupon_blackfriday15_crypto_direct' else 'crypto_direct' end;end if;
    foreach key in array array['id','name','size','qty','unit_price_usd_cents'] loop
      if line->key is distinct from item->key then raise exception 'Quoted item differs from purchased item' using errcode='22023';end if;
    end loop;
    if line->'unit_price_cents' is distinct from to_jsonb(unit) or line->'gross_cents' is distinct from to_jsonb(gross)
      or line->'discount_cents' is distinct from to_jsonb(line_base+line_crypto)
      or line->'membership_discount_cents' is distinct from to_jsonb(line_member)
      or line->'coupon_discount_cents' is distinct from to_jsonb(line_coupon)
      or line->'crypto_discount_cents' is distinct from to_jsonb(line_crypto)
      or line->'line_total_cents' is distinct from to_jsonb(gross-line_base-line_crypto)
      or line->'discount_bps' is distinct from to_jsonb(base_rate+(10000-base_rate)*crypto_rate/10000)
      or line->>'discount_reason' is distinct from reason or line->'bogo_free_units' is distinct from '0'::jsonb
      or line ?| array['membership_gift','free_qty','paid_qty','bank_discount_cents','payment_discount_cents','bulk_tier']
    then raise exception 'Membership, coupon or Crypto arithmetic changed' using errcode='22023';end if;
  end loop;
  usd_member_applied:=round(usd_subtotal::numeric*member_rate/10000)>round(usd_subtotal::numeric*coupon_rate/10000);
  usd_base_discount:=round(usd_subtotal::numeric*(case when usd_member_applied then member_rate else coupon_rate end)/10000)::integer;
  usd_net:=case when is_cad then usd_subtotal-usd_base_discount else subtotal-discounts end;
  earning_basis:=greatest(0,usd_net-points-credit);expected_earned:=floor(earning_basis::numeric*earning_rate/100)::integer;
  if pricing->'usd_earned_points_basis_cents' is distinct from to_jsonb(earning_basis) or p_data->'earned_points' is distinct from to_jsonb(expected_earned)
  then raise exception 'USD points earning basis changed' using errcode='22023';end if;
  if is_cad and pricing->'usd_basis' is distinct from jsonb_build_object('currency','USD','subtotal_cents',usd_subtotal,
    'coupon_discount_cents',case when usd_member_applied then 0 else usd_base_discount end,'membership_discount_cents',case when usd_member_applied then usd_base_discount else 0 end,'merchandise_cents',usd_net)
  then raise exception 'Canonical USD merchandise basis changed' using errcode='22023';end if;
  usd_delivery:=commerce_internal.membership_delivery_quote(request->'checkout'->'delivery',request->'address'->>'country',usd_net,member.plan);
  expected_delivery:=usd_delivery;
  if is_cad then
    shipping:=round((usd_delivery->>'shipping_cents')::numeric*rate/1000000)::integer;
    select coalesce(jsonb_agg(value||jsonb_build_object('amount_cents',round((value->>'amount_cents')::numeric*rate/1000000)::integer) order by ordinality),'[]'::jsonb),coalesce(sum(round((value->>'amount_cents')::numeric*rate/1000000)::integer),0)::integer
      into delivery_extras,extras from jsonb_array_elements(usd_delivery->'extras') with ordinality;
    expected_delivery:=usd_delivery||jsonb_build_object('currency','CAD','shipping_cents',shipping,'extras',delivery_extras,'extras_cents',extras,'total_cents',shipping+extras);
  end if;
  shipping:=(expected_delivery->>'total_cents')::integer;
  if p_data->'subtotal_cents' is distinct from to_jsonb(subtotal) or pricing->'subtotal_cents' is distinct from to_jsonb(subtotal)
    or p_data->'discount_cents' is distinct from to_jsonb(discounts) or pricing->'discount_cents' is distinct from to_jsonb(discounts)
    or pricing->'membership_discount_cents' is distinct from to_jsonb(member_discount) or pricing->'coupon_discount_cents' is distinct from to_jsonb(coupon_discount)
    or pricing->'crypto_discount_cents' is distinct from to_jsonb(crypto_discount)
    or pricing->'delivery' is distinct from expected_delivery or p_data->'shipping_cents' is distinct from to_jsonb(shipping)
    or p_data->'total_cents' is distinct from to_jsonb(subtotal-discounts+shipping-points-credit)
    or points>subtotal-discounts or points+credit>subtotal-discounts+shipping
  then raise exception 'Checkout totals or delivery changed' using errcode='22023';end if;
end $$;

create or replace function commerce_internal.validate_regular_checkout(p_data jsonb)
returns void language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
  if p_data->>'currency' is distinct from 'USD' then raise exception 'USD checkout required' using errcode='22023';end if;
  if p_data->>'checkout_version'='checkout-2026-11-v7' then
    if p_data->>'kind' is distinct from 'goods' then raise exception 'Legacy checkout supports goods only' using errcode='22023';end if;
    perform commerce_internal.legacy_pure_validate_checkout_v7(p_data);return;
  end if;
  perform commerce_internal.validate_membership_checkout(p_data);
end $$;
create or replace function commerce_internal.validate_interac_checkout(p_data jsonb)
returns void language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
  if p_data->>'currency' is distinct from 'CAD' then raise exception 'CAD checkout required' using errcode='22023';end if;
  if p_data->>'checkout_version'='checkout-interac-cad-2026-11-v1' then
    if p_data->>'kind' is distinct from 'goods' then raise exception 'Legacy checkout supports goods only' using errcode='22023';end if;
    perform commerce_internal.legacy_pure_validate_interac_v1(p_data);return;
  end if;
  perform commerce_internal.validate_membership_checkout(p_data);
end $$;

create function commerce_internal.place_membership_checkout(p_data jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
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
  if p_data->>'kind'='membership' and exists(select 1 from public.commerce_invoices where customer_id=uid and kind='membership' and status in ('requested','issued','accepted'))
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
end $$;

create or replace function public.commerce_place_checkout(p_data jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
  if p_data->>'currency' is distinct from 'USD' then raise exception 'USD checkout required' using errcode='22023';end if;
  if p_data->>'checkout_version'='checkout-2026-11-v7' then
    if p_data->>'kind' is distinct from 'goods' then raise exception 'Legacy checkout supports goods only' using errcode='22023';end if;
    return commerce_internal.legacy_pure_place_checkout_v7(p_data);
  end if;
  return commerce_internal.place_membership_checkout(p_data);
end $$;
create or replace function public.commerce_place_interac_checkout(p_data jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
  if p_data->>'currency' is distinct from 'CAD' then raise exception 'CAD checkout required' using errcode='22023';end if;
  if p_data->>'checkout_version'='checkout-interac-cad-2026-11-v1' then
    if p_data->>'kind' is distinct from 'goods' then raise exception 'Legacy checkout supports goods only' using errcode='22023';end if;
    return commerce_internal.legacy_pure_place_interac_v1(p_data);
  end if;
  return commerce_internal.place_membership_checkout(p_data);
end $$;

-- Preserve the guards' identities and reopen only the new prepaid contract.
-- Subscription tables and their retirement triggers remain closed.
create or replace function commerce_internal.regular_invoice_only()
returns trigger language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
  if new.request_data->>'research_builder'='true' or new.request_data->>'subscription'='true'
    or (new.request_data ? 'research_builder_mode' and new.request_data->>'research_builder_mode' is distinct from 'one_time')
  then raise exception 'Recurring subscriptions are unavailable' using errcode='P0001';end if;
  if new.kind='membership' then
    if new.checkout_version is null or new.checkout_version not in ('checkout-2026-11-v8','checkout-interac-cad-2026-11-v2')
      or new.status<>'accepted' or new.plan is null or new.plan not in ('vip','elite')
      or new.request_data->>'billing_period' is null or new.request_data->>'billing_period' not in ('monthly','annual')
      or new.membership_invoice_id is not null or new.priority_fulfillment
    then raise exception 'Current prepaid membership checkout required' using errcode='P0001';end if;
  elsif new.plan is not null or new.request_data->>'billing_period' is not null or new.request_data->>'plan' is not null or new.priority_fulfillment then
    raise exception 'Invalid goods membership details' using errcode='P0001';
  end if;
  return new;
end $$;

-- Validate the immutable saved fee without expiring its original FX quote.
-- Payment is still matched to the exact accepted amount and currency.
create function commerce_internal.valid_prepaid_membership_invoice(p_invoice uuid)
returns boolean language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare r public.commerce_invoices%rowtype;item jsonb;line jsonb;period text;fee integer;rate integer;amount integer;key text;
begin
  select * into r from public.commerce_invoices where id=p_invoice;
  period:=r.request_data->>'billing_period';
  fee:=case period when 'monthly' then case r.plan when 'vip' then 1999 when 'elite' then 9999 end when 'annual' then case r.plan when 'vip' then 19190 when 'elite' then 95990 end end;
  rate:=(r.pricing->>'fx_ppm')::integer;amount:=round(fee::numeric*rate/1000000)::integer;
  if r.id is null or r.kind<>'membership' or fee is null or rate is null or rate not between 100000 and 10000000
    or r.currency not in ('USD','CAD') or (r.currency='USD' and rate<>1000000)
    or r.checkout_version is distinct from (case when r.currency='USD' then 'checkout-2026-11-v8' else 'checkout-interac-cad-2026-11-v2' end)
    or r.pricing->>'checkout_version' is distinct from r.checkout_version or r.pricing->>'currency' is distinct from r.currency
    or r.pricing->>'conversion_version' is distinct from 'conversion-2026-11-v3'
    or r.request_data->'checkout'->>'version' is distinct from 'checkout-2026-11-v8'
    or r.pricing->>'billing_period' is distinct from period or r.pricing->>'billing_mode' is distinct from 'prepaid'
    or r.pricing->'automatic_renewal' is distinct from 'false'::jsonb or coalesce(r.request_data->>'automatic_renewal','false')<>'false'
    or coalesce(r.request_data->>'subscription','false')<>'false' or coalesce(r.request_data->>'research_builder','false')<>'false'
    or r.request_data ? 'research_builder_mode' or r.request_data->'bulk_order'='true'::jsonb
    or r.membership_invoice_id is not null or r.discount_cents<>0 or r.shipping_cents<>0 or r.tax_cents<>0
    or r.points_redeemed<>0 or r.credit_redeemed_cents<>0 or r.earned_points<>0
    or r.subtotal_cents is distinct from amount or r.total_cents is distinct from amount
    or r.pricing->'subtotal_cents' is distinct from to_jsonb(amount) or r.pricing->'discount_cents' is distinct from '0'::jsonb
    or r.pricing->'redeemed_points' is distinct from '0'::jsonb or r.pricing->'credit_cents' is distinct from '0'::jsonb
    or coalesce(r.pricing->>'coupon_code','')<>'' or coalesce(r.request_data->'checkout'->>'coupon','')<>''
    or r.request_data->'checkout'->'points' is distinct from '0'::jsonb or r.request_data->'checkout'->'credit_cents' is distinct from '0'::jsonb
    or jsonb_typeof(r.request_data->'items') is distinct from 'array' or jsonb_array_length(r.request_data->'items')<>1
    or jsonb_typeof(r.pricing->'lines') is distinct from 'array' or jsonb_array_length(r.pricing->'lines')<>1
    or r.pricing ?| array['membership_gift','referral','referral_discount','bulk_tier','delivery_tax']
  then return false;end if;
  if r.currency='CAD' and (r.request_data->'address'->>'country' is distinct from 'CA'
    or r.pricing->'fx'->'fx_ppm' is distinct from r.pricing->'fx_ppm'
    or r.pricing->'fx'->>'source' is distinct from 'Bank of Canada' or r.pricing->'fx'->>'series' is distinct from 'FXUSDCAD') then return false;end if;
  item:=r.request_data->'items'->0;line:=r.pricing->'lines'->0;
  if item->>'id' is distinct from 'membership-'||r.plan or item->>'size' is distinct from period or item->'qty' is distinct from '1'::jsonb
    or item->'unit_price_usd_cents' is distinct from to_jsonb(fee) or item ?| array['membership_gift','free_qty','paid_qty']
    or line->'unit_price_cents' is distinct from to_jsonb(amount) or line->'gross_cents' is distinct from to_jsonb(amount)
    or line->'line_total_cents' is distinct from to_jsonb(amount) or line->'discount_cents' is distinct from '0'::jsonb
    or line->'discount_bps' is distinct from '0'::jsonb or line->>'discount_reason' is distinct from 'none'
  then return false;end if;
  foreach key in array array['id','name','size','qty','unit_price_usd_cents'] loop if item->key is distinct from line->key then return false;end if;end loop;
  foreach key in array array['coupon_discount_cents','membership_discount_cents','crypto_discount_cents','payment_discount_cents','bank_discount_cents','bogo_free_units','free_qty','paid_qty','earned_points'] loop
    if coalesce((r.pricing->>key)::integer,0)<>0 or coalesce((line->>key)::integer,0)<>0 then return false;end if;
  end loop;
  return true;
end $$;

create or replace function commerce_internal.membership_term()
returns trigger language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare r public.commerce_invoices%rowtype;
begin
  select * into r from public.commerce_invoices where id=new.invoice_id;
  if r.checkout_version in ('checkout-2026-11-v3','checkout-2026-11-v4','checkout-2026-11-v8','checkout-interac-cad-2026-11-v2') then
    if r.request_data->>'billing_period' is null or r.request_data->>'billing_period' not in ('monthly','annual') then raise exception 'Membership term missing' using errcode='22023';end if;
    if r.checkout_version in ('checkout-2026-11-v8','checkout-interac-cad-2026-11-v2') then new.starts_at:=r.paid_at;end if;
    new.expires_at:=new.starts_at+case when r.request_data->>'billing_period'='monthly' then interval '1 month' else interval '1 year' end;
  end if;
  return new;
end $$;

create or replace function commerce_internal.retired_membership_write()
returns trigger language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare r public.commerce_invoices%rowtype;
begin
  select * into r from public.commerce_invoices where id=new.invoice_id;
  if tg_op='INSERT' then
    perform pg_advisory_xact_lock(hashtextextended(new.customer_id::text,0));
    if r.id is null or r.kind<>'membership' or r.status<>'paid' or r.paid_at is null or not commerce_internal.valid_prepaid_membership_invoice(r.id)
      or r.checkout_version is null or r.checkout_version not in ('checkout-2026-11-v8','checkout-interac-cad-2026-11-v2')
      or new.customer_id is distinct from r.customer_id or new.plan is distinct from r.plan or new.revoked_at is not null
      or new.starts_at is distinct from r.paid_at
      or new.expires_at is distinct from r.paid_at+(case when r.request_data->>'billing_period'='monthly' then interval '1 month' else interval '1 year' end)
      or not exists(select 1 from public.commerce_receipts where invoice_id=r.id and method_id=r.method_id and kind='payment' and amount_cents=r.total_cents and currency=r.currency)
      or exists(select 1 from public.commerce_memberships where customer_id=new.customer_id and revoked_at is null and expires_at>now())
    then raise exception 'Verified paid membership activation required' using errcode='P0001';end if;
  elsif (to_jsonb(new)-'revoked_at') is distinct from (to_jsonb(old)-'revoked_at')
    or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at)
    or (new.revoked_at is distinct from old.revoked_at and (new.revoked_at is null or r.status is distinct from 'refunded'
      or not exists(select 1 from public.commerce_receipts where invoice_id=r.id and method_id=r.method_id and kind='refund' and amount_cents=r.total_cents and currency=r.currency)))
  then raise exception 'Membership changes require verified refund reconciliation' using errcode='P0001';end if;
  return new;
end $$;

-- Only verified payment may set a priority entitlement. The snapshot reference
-- prevents later membership upgrades from changing already accepted order terms.
create function commerce_internal.membership_order_payment_guard()
returns trigger language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
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
    new.priority_fulfillment:=coalesce(m.plan='elite',false);
  elsif new.priority_fulfillment is distinct from old.priority_fulfillment then
    raise exception 'Priority fulfillment requires verified payment' using errcode='P0001';
  end if;
  return new;
end $$;
create trigger commerce_membership_order_payment_guard before update of status,membership_invoice_id,priority_fulfillment on public.commerce_invoices
  for each row execute function commerce_internal.membership_order_payment_guard();

create or replace function commerce_internal.fulfillment_seed(p_invoice uuid)
returns void language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare r public.commerce_invoices%rowtype; gift boolean;
begin
  select * into r from public.commerce_invoices where id=p_invoice for update;
  if r.id is null or r.kind<>'goods' or r.status not in ('paid','processing') then return;end if;
  -- Preserve existing assignments, parcels and any historical supplier request.
  if exists(select 1 from public.commerce_fulfillment_items where invoice_id=r.id)
    or exists(select 1 from public.commerce_supplier_jobs where invoice_id=r.id) then return;end if;
  insert into public.commerce_fulfillment_items(invoice_id,variant_key,item,route,supplier_name,product,vials)
    select r.id,x->>'id'||'|'||(x->>'size'),x,'manual','',null,null from jsonb_array_elements(coalesce(r.request_data->'items','[]'::jsonb)) x on conflict do nothing;
  gift:=r.checkout_version in ('checkout-2026-11-v8','checkout-interac-cad-2026-11-v2') and exists(
    select 1 from public.commerce_memberships where invoice_id=r.membership_invoice_id and customer_id=r.customer_id and plan='elite' and revoked_at is null
      and starts_at<=r.accepted_at and expires_at>r.accepted_at);
  if gift then
    insert into public.commerce_fulfillment_items(invoice_id,variant_key,item,route,supplier_name,product,vials,note)
    values(r.id,'gift-bac-3|3 mL',jsonb_build_object('id','gift-bac-3','name','Complimentary BAC Water 3mL — PURE BLACK','size','3 mL','qty',1,'unit_price_usd_cents',0,'membership_gift',true),
      'manual','',null,null,'PURE BLACK membership gift: include with the same shipment; do not split this order') on conflict do nothing;
  end if;
end $$;

create or replace function commerce_internal.platinum_monthly_reward()
returns trigger language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare ref text;oldref text;credit_balance integer;usd_merchandise integer;
begin
  if new.kind<>'goods' or new.customer_id is null or new.status=old.status then return new;end if;
  if new.status='paid' and old.status='accepted' and new.checkout_version in ('checkout-2026-11-v8','checkout-interac-cad-2026-11-v2') then
    usd_merchandise:=case when new.currency='CAD' then (new.pricing->'usd_basis'->>'merchandise_cents')::integer else new.subtotal_cents-new.discount_cents end;
    if usd_merchandise>=15000 and exists(select 1 from public.commerce_memberships where invoice_id=new.membership_invoice_id and customer_id=new.customer_id
      and plan='elite' and revoked_at is null and starts_at<=new.accepted_at and expires_at>new.accepted_at) then
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
end $$;

-- Permit only validated prepaid memberships on existing verified live rails.
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
 if p_operation='sale' and i.kind<>'goods' and not (i.kind='membership' and i.checkout_version='checkout-2026-11-v8' and commerce_internal.valid_prepaid_membership_invoice(i.id)) then raise exception 'Current prepaid membership required' using errcode='P0001'; end if;
 select * into old from public.commerce_gateway_attempts where id=p_id;
 if found then
  if old.invoice_id<>i.id or old.operation<>p_operation or old.account_tag<>p_account_tag then raise exception 'Attempt ID conflict' using errcode='23505'; end if;
  return to_jsonb(old)||jsonb_build_object('claimed',false);
 end if;
 select * into a from public.commerce_gateway_accounts where method_id=i.method_id;
 select * into m from public.commerce_payment_methods where id=i.method_id for share;
 if a.method_id is null or a.account_tag is distinct from p_account_tag or not m.active then raise exception 'Gateway unavailable' using errcode='P0001'; end if;
 if p_operation='sale' and i.kind='membership' and (a.mode<>'live' or a.provider not in ('rampex','polygon_usdc') or (a.provider='rampex' and a.rampex_provider is distinct from 'hosted')) then raise exception 'Membership payment route unavailable' using errcode='P0001'; end if;
 if p_operation='sale' then
  if i.status<>'accepted' or i.expires_at<=now() or (m.sale_scope<>'both' and m.sale_scope<>i.kind)
   or (not ((i.request_data->'address'->>'country')=any(a.countries))) then raise exception 'Invoice not payable on this route' using errcode='P0001'; end if;
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


create or replace function public.commerce_create_polygon_usdc_intent(p_id uuid,p_invoice uuid,p_customer uuid,p_account_tag text,p_intent jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare i public.commerce_invoices%rowtype; a public.commerce_gateway_accounts%rowtype; prior public.commerce_polygon_usdc_intents%rowtype; attempt jsonb;
begin
 select * into i from public.commerce_invoices where id=p_invoice and customer_id=p_customer for update;
 if not found then raise exception 'Order not found' using errcode='P0002'; end if;
 if i.cancellation_requested_at is not null then raise exception 'Cancellation requested; do not authorize payment' using errcode='P0001'; end if;
 select * into a from public.commerce_gateway_accounts where method_id=i.method_id;
 if i.currency<>'USD' or (i.kind<>'goods' and not (i.kind='membership' and i.checkout_version='checkout-2026-11-v8' and commerce_internal.valid_prepaid_membership_invoice(i.id))) or i.total_cents<1 or a.provider is distinct from 'polygon_usdc' or a.account_tag is distinct from p_account_tag
 then raise exception 'Invalid native USDC order route' using errcode='22023'; end if;
 select * into prior from public.commerce_polygon_usdc_intents where invoice_id=i.id order by created_at desc limit 1;
 if found then return to_jsonb(prior); end if;
 if p_intent->>'chain_id' is distinct from '137' or p_intent->>'token' is distinct from '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359'
  or p_intent->>'recipient' is distinct from a.polygon_recipient or (p_intent->>'amount_units')::numeric is distinct from i.total_cents::numeric*10000
  or p_intent->>'payer' is null or p_intent->>'payer' !~ '^0x[0-9a-f]{40}$' or p_intent->>'payer'='0x0000000000000000000000000000000000000000'
  or p_intent->>'nonce' is null or p_intent->>'nonce' !~ '^0x[0-9a-f]{64}$'
  or (p_intent->>'valid_after')::bigint is null or (p_intent->>'valid_after')::bigint>extract(epoch from now())
  or (p_intent->>'valid_before')::bigint is null or (p_intent->>'valid_before')::bigint<=extract(epoch from now())
  or (p_intent->>'valid_before')::bigint>extract(epoch from least(i.expires_at,now()+interval '1 hour'))
  or (p_intent->>'start_block')::bigint is null then raise exception 'Invalid immutable USDC authorization' using errcode='22023'; end if;
 attempt:=public.commerce_begin_gateway_attempt(p_id,p_invoice,p_customer,'sale',p_account_tag);
 if attempt->>'provider' is distinct from 'polygon_usdc' or attempt->>'state' is distinct from 'started' then raise exception 'Existing payment requires reconciliation' using errcode='P0001'; end if;
 insert into public.commerce_polygon_usdc_intents(attempt_id,invoice_id,account_tag,chain_id,token,recipient,payer,amount_units,nonce,valid_after,valid_before,start_block)
 values((attempt->>'id')::uuid,i.id,p_account_tag,137,p_intent->>'token',a.polygon_recipient,p_intent->>'payer',(p_intent->>'amount_units')::numeric,p_intent->>'nonce',(p_intent->>'valid_after')::bigint,(p_intent->>'valid_before')::bigint,(p_intent->>'start_block')::bigint) returning * into prior;
 return to_jsonb(prior);
end $$;


create or replace function commerce_internal.partner_order_transition()
returns trigger language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
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
    basis:=greatest(0,new.subtotal_cents-new.discount_cents-new.points_redeemed-new.credit_redeemed_cents);
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
end $$;
revoke all on function commerce_internal.partner_order_transition() from public,anon,authenticated,service_role;

-- Administrative saves preserve the explicitly approved goods/both scope on
-- these two live rails. The original account and receiving-wallet locks remain.
create or replace function public.commerce_configure_rampex_gateway(p_data jsonb,p_actor text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare mid uuid; current_method public.commerce_payment_methods%rowtype; a public.commerce_gateway_accounts%rowtype; country text; codes text[]; rail text;
begin
 if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'Invalid Rampex configuration' using errcode='22023'; end if;
 mid:=(p_data->>'id')::uuid;rail:=p_data->>'rampex_provider';
 if mid is null or p_data->>'provider' is distinct from 'rampex' or p_data->>'mode' is distinct from 'live'
  or p_data->>'currency' is distinct from 'USD' or coalesce(p_data->>'sale_scope','') not in ('goods','both')
  or coalesce(p_data->>'account_tag','') !~ '^[a-f0-9]{64}$' or p_data->>'confirmed' is distinct from 'true'
  or jsonb_typeof(p_data->'active') is distinct from 'boolean' or (p_data->>'version')::integer is null or (p_data->>'version')::integer<0
  or length(coalesce(p_actor,''))<8 or length(coalesce(p_data->>'label','')) not between 3 and 80
  or length(coalesce(p_data->>'payee','')) not between 2 and 180 or length(coalesce(p_data->>'approval_reference','')) not between 8 and 400
  or rail is distinct from 'hosted'
  or jsonb_typeof(p_data->'countries') is distinct from 'array' then raise exception 'Invalid Rampex configuration' using errcode='22023'; end if;
 select array_agg(value) into codes from jsonb_array_elements_text(p_data->'countries');
 if codes is null or cardinality(codes) not between 1 and 60 then raise exception 'Approved destinations required' using errcode='22023'; end if;
 foreach country in array codes loop if country is null or country !~ '^[A-Z]{2}$' then raise exception 'Invalid country' using errcode='22023'; end if; end loop;
 select * into current_method from public.commerce_payment_methods where id=mid for update;
 if found then
  select * into a from public.commerce_gateway_accounts where method_id=mid for update;
  if current_method.version is distinct from (p_data->>'version')::integer then raise exception 'Gateway changed' using errcode='40001'; end if;
  if current_method.native_provider is distinct from 'rampex' or current_method.currency is distinct from 'USD'
   or a.provider is distinct from 'rampex' or a.account_tag is distinct from p_data->>'account_tag' or a.rampex_provider is distinct from rail then
   raise exception 'Use a new route for a different Rampex account or provider' using errcode='22023'; end if;
  update public.commerce_payment_methods set label=p_data->>'label',payee=p_data->>'payee',acceptance_reference=p_data->>'approval_reference',
   active=(p_data->>'active')::boolean,sale_scope=p_data->>'sale_scope',version=version+1,updated_at=now() where id=mid;
  update public.commerce_gateway_accounts set countries=codes where method_id=mid;
 else
  if (p_data->>'version')::integer is distinct from 0 then raise exception 'Unknown gateway' using errcode='P0002'; end if;
  insert into public.commerce_payment_methods(id,kind,label,currency,payee,instructions,allowed_host,acceptance_reference,active,provider_key,display_order,sale_scope,native_provider)
  values(mid,'hosted_link',p_data->>'label','USD',p_data->>'payee','Card-to-crypto payment. Review conversion, identity checks and provider fees before paying.','getpurelabs.com',p_data->>'approval_reference',(p_data->>'active')::boolean,'custom',4,p_data->>'sale_scope','rampex');
  insert into public.commerce_gateway_accounts(method_id,provider,mode,account_tag,countries,rampex_provider) values(mid,'rampex','live',p_data->>'account_tag',codes,rail);
 end if;
 insert into public.commerce_events(method_id,action,actor,details) values(mid,'native_gateway_configured',p_actor,jsonb_build_object('provider','rampex','mode','live','active',p_data->'active','countries',codes,'rampex_provider',rail,'sale_scope',p_data->>'sale_scope'));
 return jsonb_build_object('id',mid,'saved',true);
end $$;



create or replace function public.commerce_configure_polygon_usdc_gateway(p_data jsonb,p_actor text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare mid uuid:=(p_data->>'id')::uuid; m public.commerce_payment_methods%rowtype; codes text[]; country text; recipient text:=lower(p_data->>'polygon_recipient'); tag text;
begin
 tag:=encode(sha256(convert_to('polygon_usdc:live:137:0x3c499c542cef5e3811e1192ce70d8cc03d5c3359:'||recipient,'UTF8')),'hex');
 if mid is null or p_data->>'provider' is distinct from 'polygon_usdc' or p_data->>'mode' is distinct from 'live'
  or p_data->>'currency' is distinct from 'USD' or coalesce(p_data->>'sale_scope','') not in ('goods','both')
  or p_data->>'confirmed' is distinct from 'true' or p_data->>'account_tag' is distinct from tag
  or recipient is null or recipient !~ '^0x[0-9a-f]{40}$' or recipient='0x0000000000000000000000000000000000000000'
  or length(coalesce(p_actor,''))<8 then raise exception 'Invalid Polygon USDC route' using errcode='22023'; end if;
 select array_agg(value) into codes from jsonb_array_elements_text(p_data->'countries');
 if codes is null or cardinality(codes) not between 1 and 250 or cardinality(codes)<>(select count(distinct value) from unnest(codes) value) then raise exception 'Supported destinations required' using errcode='22023'; end if;
 foreach country in array codes loop if country is null or country !~ '^[A-Z]{2}$' then raise exception 'Invalid country' using errcode='22023'; end if; end loop;
 select * into m from public.commerce_payment_methods where id=mid for update;
 if found then
  if m.version is distinct from (p_data->>'version')::integer then raise exception 'Gateway changed' using errcode='40001'; end if;
  if m.native_provider is distinct from 'polygon_usdc' or m.currency is distinct from 'USD'
   or not exists(select 1 from public.commerce_gateway_accounts where method_id=mid and account_tag=tag and polygon_recipient=recipient and provider='polygon_usdc')
  then raise exception 'Use a new route for a different receiving wallet' using errcode='22023'; end if;
  update public.commerce_payment_methods set label=p_data->>'label',payee=p_data->>'payee',acceptance_reference=p_data->>'approval_reference',active=(p_data->>'active')::boolean,sale_scope=p_data->>'sale_scope',version=version+1,updated_at=now() where id=mid;
  update public.commerce_gateway_accounts set countries=codes where method_id=mid;
 else
  if (p_data->>'version')::integer is distinct from 0 then raise exception 'Unknown gateway' using errcode='P0002'; end if;
  insert into public.commerce_payment_methods(id,kind,label,currency,payee,instructions,allowed_host,acceptance_reference,active,provider_key,display_order,sale_scope,native_provider)
  values(mid,'hosted_link',p_data->>'label','USD',p_data->>'payee','Pay native USDC on Polygon from a compatible wallet. Exact order authorization and finalized receipt are required.','getpurelabs.com',p_data->>'approval_reference',(p_data->>'active')::boolean,'custom',5,p_data->>'sale_scope','polygon_usdc');
  insert into public.commerce_gateway_accounts(method_id,provider,mode,account_tag,countries,polygon_recipient) values(mid,'polygon_usdc','live',tag,codes,recipient);
 end if;
 insert into public.commerce_events(method_id,action,actor,details) values(mid,'polygon_usdc_gateway_configured',p_actor,jsonb_build_object('provider','polygon_usdc','active',p_data->'active','chain_id',137,'recipient_tail',right(recipient,6),'sale_scope',p_data->>'sale_scope'));
 return jsonb_build_object('id',mid,'saved',true);
end $$;


-- Extend only the currently active, verified receiving methods. Never enable a
-- dormant method, change its destination, or reactivate the old Stripe route.
update public.commerce_payment_methods m set sale_scope='both',version=m.version+1,updated_at=now()
where m.active and m.sale_scope<>'both' and (
  (m.currency='CAD' and m.kind='interac' and m.provider_key='interac' and m.native_provider is null)
  or (m.currency='USD' and m.native_provider in ('rampex','polygon_usdc') and exists(
    select 1 from public.commerce_gateway_accounts a where a.method_id=m.id and a.provider=m.native_provider and a.mode='live'
      and (a.provider='polygon_usdc' or a.rampex_provider='hosted')))
);

revoke all on function commerce_internal.active_paid_membership(uuid,timestamptz),
  commerce_internal.checkout_discount_parts(jsonb,integer),
  commerce_internal.membership_delivery_quote(jsonb,text,integer,text),
  commerce_internal.validate_membership_checkout(jsonb),
  commerce_internal.validate_regular_checkout(jsonb),commerce_internal.validate_interac_checkout(jsonb),
  commerce_internal.place_membership_checkout(jsonb),commerce_internal.regular_invoice_only(),
  commerce_internal.valid_prepaid_membership_invoice(uuid),
  commerce_internal.membership_term(),commerce_internal.retired_membership_write(),
  commerce_internal.membership_order_payment_guard(),commerce_internal.fulfillment_seed(uuid),
  commerce_internal.platinum_monthly_reward(),commerce_internal.partner_order_transition()
  from public,anon,authenticated,service_role;
revoke all on function public.commerce_configure_rampex_gateway(jsonb,text),public.commerce_configure_polygon_usdc_gateway(jsonb,text),
  public.commerce_place_checkout(jsonb),public.commerce_place_interac_checkout(jsonb),
  public.commerce_create_polygon_usdc_intent(uuid,uuid,uuid,text,jsonb),public.commerce_begin_gateway_attempt(uuid,uuid,uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.commerce_configure_rampex_gateway(jsonb,text),public.commerce_configure_polygon_usdc_gateway(jsonb,text),
  public.commerce_place_checkout(jsonb),public.commerce_place_interac_checkout(jsonb),
  public.commerce_create_polygon_usdc_intent(uuid,uuid,uuid,text,jsonb),public.commerce_begin_gateway_attempt(uuid,uuid,uuid,text,text)
  to service_role;
commit;
