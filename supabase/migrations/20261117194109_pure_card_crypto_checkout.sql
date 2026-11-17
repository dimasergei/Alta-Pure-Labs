-- PURE new checkout: Card through hosted Rampex and configured direct Crypto only.
-- 5% direct-crypto merchandise discount OR the entered BLACKFRIDAY15 coupon, whichever is greater.
-- Existing invoice snapshots, bank/Stripe methods, receipts, callbacks, balances and jobs remain intact.
-- Shipping uses the separately versioned regular_delivery_quote function (including Canada next-day).
-- Apply this migration before deploying checkout v6. No provider link or payment is created here.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create or replace function commerce_internal.validate_regular_checkout(p_data jsonb)
returns void language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare
  request jsonb:=p_data->'request'; pricing jsonb:=p_data->'pricing';
  item jsonb; line jsonb; k text; i integer; quantity integer; unit_cents integer; gross integer; discount integer;
  subtotal integer:=0; discounts integer:=0; code text; expected_delivery jsonb;
  seen text[]:=array[]::text[]; variant_key text; line_discounts jsonb;
  method_provider text; eligible_crypto boolean; bps integer; source_discount text;
  balance_suppressed boolean:=false; candidate_subtotal integer; candidate_discount integer; candidate_delivery jsonb;
begin
  if p_data->>'checkout_version' is distinct from 'checkout-2026-11-v6'
    or p_data->>'kind' is distinct from 'goods' or p_data->>'plan' is not null
    or p_data->>'membership_invoice_id' is not null or p_data->>'earned_points' is distinct from '0'
    or jsonb_typeof(request) is distinct from 'object' or jsonb_typeof(pricing) is distinct from 'object'
    or request->>'research_builder' not in ('false') or request->>'subscription' not in ('false')
    or request->>'billing_period' is not null or request->>'plan' is not null
    or request->'checkout'->>'version' is distinct from 'checkout-2026-11-v6'
    or pricing->>'checkout_version' is distinct from 'checkout-2026-11-v6'
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
  select native_provider into method_provider from public.commerce_payment_methods where id=(p_data->>'method_id')::uuid;
  if method_provider is null or method_provider not in ('rampex','polygon_usdc') then raise exception 'Choose Card or Crypto for a new checkout' using errcode='22023'; end if;
  if method_provider='rampex' and not exists(select 1 from public.commerce_gateway_accounts where method_id=(p_data->>'method_id')::uuid and provider='rampex' and rampex_provider='hosted')
  then raise exception 'The historical card route is unavailable for new checkout' using errcode='22023'; end if;
  eligible_crypto:=method_provider='polygon_usdc';
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
  -- Apply the better single merchandise discount. Card conversion is never direct crypto.
  if eligible_crypto and code='' then
    select sum((value->>'qty')::numeric*(value->>'unit_price_usd_cents')::numeric)::integer into candidate_subtotal from jsonb_array_elements(request->'items');
    candidate_discount:=round(candidate_subtotal::numeric*500/10000)::integer;
    candidate_delivery:=commerce_internal.regular_delivery_quote(request->'checkout'->'delivery',request->'address'->>'country',candidate_subtotal-candidate_discount);
    balance_suppressed:=(p_data->>'points_redeemed')::integer+(p_data->>'credit_redeemed_cents')::integer>=candidate_subtotal-candidate_discount+(candidate_delivery->>'total_cents')::integer;
  end if;
  bps:=case when code='BLACKFRIDAY15' then 1500 when eligible_crypto and not balance_suppressed then 500 else 0 end;
  source_discount:=case when code='BLACKFRIDAY15' then 'coupon' when eligible_crypto and not balance_suppressed then 'crypto' else 'none' end;
  if pricing->>'payment_discount_version' is distinct from 'pure-payments-2026-11-v1'
    or pricing->'crypto_discount_eligible' is distinct from to_jsonb(eligible_crypto)
    or pricing->'crypto_discount_suppressed_for_balance' is distinct from to_jsonb(balance_suppressed)
    or pricing->>'discount_source' is distinct from source_discount
  then raise exception 'Payment discount policy changed' using errcode='22023'; end if;
  -- Order-wide rounded discount, allocated by largest fractional remainder.
  -- Original line order resolves equal remainders deterministically.
  with amounts as (
    select ordinality, (value->>'qty')::numeric*(value->>'unit_price_usd_cents')::numeric as gross
    from jsonb_array_elements(request->'items') with ordinality
  ), parts as (
    select ordinality, floor(amounts.gross*bps/10000)::integer as base,
      row_number() over(order by mod(amounts.gross*bps,10000) desc,ordinality) as rank,
      round(sum(amounts.gross) over()*bps/10000)::integer-sum(floor(amounts.gross*bps/10000)::integer) over() as pennies
    from amounts
  ) select jsonb_agg(base+case when rank<=pennies then 1 else 0 end order by ordinality)
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
      or line->'coupon_discount_cents' is distinct from to_jsonb(case when source_discount='coupon' then discount else 0 end)
      or line->'crypto_discount_cents' is distinct from to_jsonb(case when source_discount='crypto' then discount else 0 end)
      or line->'line_total_cents' is distinct from to_jsonb(gross-discount)
      or line->'discount_bps' is distinct from to_jsonb(bps)
      or line->>'discount_reason' is distinct from (case source_discount when 'coupon' then 'coupon_blackfriday15' when 'crypto' then 'crypto_direct' else 'none' end)
      or line->'bogo_free_units' is distinct from '0'::jsonb
      or line ?| array['membership_gift','free_qty','paid_qty','bank_discount_cents','payment_discount_cents','bulk_tier']
    then raise exception 'Only the best eligible single merchandise discount is available' using errcode='22023'; end if;
    subtotal:=subtotal+gross; discounts:=discounts+discount;
  end loop;
  expected_delivery:=commerce_internal.regular_delivery_quote(request->'checkout'->'delivery',request->'address'->>'country',subtotal-discounts);
  if subtotal>100000000 or p_data->'subtotal_cents' is distinct from to_jsonb(subtotal)
    or p_data->'discount_cents' is distinct from to_jsonb(discounts)
    or pricing->'subtotal_cents' is distinct from to_jsonb(subtotal)
    or pricing->'discount_cents' is distinct from to_jsonb(discounts)
    or pricing->'coupon_discount_cents' is distinct from to_jsonb(case when source_discount='coupon' then discounts else 0 end)
    or pricing->'crypto_discount_cents' is distinct from to_jsonb(case when source_discount='crypto' then discounts else 0 end)
    or pricing->'redeemed_points' is distinct from p_data->'points_redeemed'
    or pricing->'credit_cents' is distinct from p_data->'credit_redeemed_cents'
    or request->'checkout'->'points' is distinct from p_data->'points_redeemed'
    or request->'checkout'->'credit_cents' is distinct from p_data->'credit_redeemed_cents'
    or request->'checkout'->'method_id' is distinct from p_data->'method_id'
    or pricing->'delivery' is distinct from expected_delivery
    or p_data->'shipping_cents' is distinct from expected_delivery->'total_cents'
  then raise exception 'Checkout totals or delivery changed' using errcode='22023'; end if;
end $$;

revoke all on function commerce_internal.validate_regular_checkout(jsonb) from public,anon,authenticated,service_role;

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
 or p_data->>'checkout_version' is distinct from 'checkout-2026-11-v6' or p_data->>'consent' is distinct from 'true'
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
 or m.native_provider is null or m.native_provider not in ('rampex','polygon_usdc') then raise exception 'Payment method changed' using errcode='P0001'; end if;
 if not exists(select 1 from public.commerce_gateway_accounts where method_id=m.id and provider=m.native_provider and mode='live'
  and (m.native_provider<>'rampex' or rampex_provider='hosted')
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
 if new.status='paid' and old.status='accepted' and new.checkout_version in ('checkout-2026-11-v3','checkout-2026-11-v4','checkout-2026-11-v5','checkout-2026-11-v6') then
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

-- The owner selected the existing hosted Card route for US and Canada.
-- Provider-hosted country/device/account eligibility and fees remain part of the hosted checkout.
-- Crypto activation is separate: the direct Polygon USDC migration, verified owner recipient and RPC readiness are required.
-- Legacy PayerURL remains available only for historical invoices; no new PayerURL method is activated.
do $$
declare hosted uuid; routes uuid[];
begin
 select array_agg(m.id) into routes from public.commerce_payment_methods m join public.commerce_gateway_accounts a on a.method_id=m.id
   where m.native_provider='rampex' and m.currency='USD' and a.provider='rampex' and a.mode='live' and a.rampex_provider='hosted'
     and a.account_tag ~ '^[a-f0-9]{64}$';
 if cardinality(routes) is distinct from 1 then
  raise exception 'Expected one existing Rampex hosted account; review activation before applying' using errcode='P0001';
 end if;
 hosted:=routes[1];
 update public.commerce_payment_methods set active=true,label='Card',display_order=1,sale_scope='goods',version=version+1,updated_at=now()
  where id=hosted;
 update public.commerce_gateway_accounts set countries=array['US','CA'] where method_id=hosted;
 insert into public.commerce_events(method_id,action,actor,details) values(hosted,'native_gateway_configured','owner-request:pure-payments-v6',
  jsonb_build_object('provider','rampex','mode','live','active',true,'countries',jsonb_build_array('US','CA'),'rampex_provider','hosted','new_checkout_only',true));
end $$;

commit;
