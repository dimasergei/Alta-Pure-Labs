-- Direct Interac checkout: a fixed CAD total is accepted at checkout, remains
-- unpaid, and uses the existing verified bank receipt/fulfillment lifecycle.
-- Native USD checkout and every historical invoice/payment snapshot are unchanged.
-- The application verifies the signed Bank of Canada quote; this backend-only
-- transaction independently validates its lifetime and all monetary arithmetic.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create or replace function commerce_internal.validate_interac_checkout(p_data jsonb)
returns void language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare
 request jsonb:=p_data->'request'; pricing jsonb:=p_data->'pricing'; fx jsonb:=pricing->'fx';
 item jsonb; line jsonb; k text; i integer; quantity integer; unit_usd integer; unit_cad integer; gross integer; discount integer;
 subtotal integer:=0; usd_subtotal integer:=0; discounts integer:=0; usd_discount integer; coupon_bps integer; code text;
 rate integer; quoted timestamptz; expiry timestamptz; rate_date date;
 seen text[]:=array[]::text[]; variant_key text; line_discounts jsonb;
 delivery_usd jsonb; expected_delivery jsonb; delivery_extras jsonb; shipping integer; extras_total integer;
begin
 if p_data->>'checkout_version' is distinct from 'checkout-interac-cad-2026-11-v1'
  or p_data->>'kind' is distinct from 'goods' or p_data->>'plan' is not null
  or p_data->>'currency' is distinct from 'CAD' or p_data->>'payment_currency' is distinct from 'CAD'
  or p_data->'manual_transfer' is distinct from 'true'::jsonb or p_data ? 'request_only'
  or p_data->>'membership_invoice_id' is not null
  or jsonb_typeof(request) is distinct from 'object' or jsonb_typeof(pricing) is distinct from 'object'
  or coalesce(request->>'research_builder','false')<>'false' or coalesce(request->>'subscription','false')<>'false'
  or request->>'billing_period' is not null or request->>'plan' is not null
  or request->'research_use_confirmed' is distinct from 'true'::jsonb
  or request->'address'->>'country' is distinct from 'CA'
  or request->'checkout'->>'version' is distinct from 'checkout-2026-11-v7'
  or request->'checkout'->>'payment_kind' is distinct from 'interac'
  or request->'checkout' ?| array['request_only','usd_estimate']
  or coalesce(request->'checkout'->>'input_digest','') !~ '^[a-f0-9]{64}$'
  or request->'checkout'->'method_id' is distinct from p_data->'method_id'
  or request->'checkout'->'payment_method_version' is distinct from p_data->'method_version'
  or request->'preferred_payment'->'method_id' is distinct from p_data->'method_id'
  or request->'preferred_payment'->>'provider_key' is distinct from 'interac'
  or request->'preferred_payment'->>'currency' is distinct from 'CAD'
  or pricing->>'checkout_version' is distinct from 'checkout-interac-cad-2026-11-v1'
  or pricing->>'terms_version' is distinct from 'launch-2026-11-v1'
  or pricing->>'conversion_version' is distinct from 'conversion-2026-11-v2'
  or pricing->>'currency' is distinct from 'CAD' or pricing->>'billing_period' is not null
  or pricing ?| array['referral_discount','payment_discount','bank_discount_cents','payment_discount_cents','membership_gift','bulk_tier','delivery_tax']
  or jsonb_typeof(request->'items') is distinct from 'array' or jsonb_typeof(pricing->'lines') is distinct from 'array'
 then raise exception 'Invalid direct CAD Interac checkout' using errcode='22023'; end if;
 -- USD account value cannot enter, leave, or accrue through this CAD route.
 foreach k in array array['points_redeemed','credit_redeemed_cents','earned_points','tax_cents'] loop
  if p_data->k is distinct from '0'::jsonb then raise exception 'CAD checkout cannot use USD balances or change current tax policy' using errcode='22023'; end if;
 end loop;
 if request->'checkout'->'points' is distinct from '0'::jsonb or request->'checkout'->'credit_cents' is distinct from '0'::jsonb
  or pricing->'redeemed_points' is distinct from '0'::jsonb or pricing->'credit_cents' is distinct from '0'::jsonb
 then raise exception 'CAD checkout cannot use USD account balances' using errcode='22023'; end if;
 if jsonb_array_length(request->'items') not between 1 and 60
  or jsonb_array_length(request->'items')<>jsonb_array_length(pricing->'lines')
  or (request ? 'bulk_order' and jsonb_typeof(request->'bulk_order')<>'boolean')
 then raise exception 'Invalid CAD checkout items' using errcode='22023'; end if;
 if jsonb_typeof(fx) is distinct from 'object' or jsonb_typeof(fx->'fx_ppm') is distinct from 'number'
  or coalesce(fx->>'fx_ppm','') !~ '^[0-9]+$' or fx->'fx_ppm' is distinct from pricing->'fx_ppm'
  or fx->>'source' is distinct from 'Bank of Canada' or fx->>'series' is distinct from 'FXUSDCAD'
  or coalesce(fx->>'rate_date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  or jsonb_typeof(fx->'quoted_at') is distinct from 'string' or jsonb_typeof(fx->'expires_at') is distinct from 'string'
  or (fx-array['fx_ppm','source','series','rate_date','quoted_at','expires_at']) is distinct from '{}'::jsonb
 then raise exception 'Invalid CAD exchange-rate quote' using errcode='22023'; end if;
 rate:=(fx->>'fx_ppm')::integer; quoted:=(fx->>'quoted_at')::timestamptz; expiry:=(fx->>'expires_at')::timestamptz; rate_date:=(fx->>'rate_date')::date;
 if rate not between 100000 and 10000000 or quoted>now()+interval '2 minutes' or expiry<=now() or expiry<=quoted
  or expiry>quoted+interval '30 minutes'
  or rate_date>(now() at time zone 'America/Toronto')::date or rate_date<(now() at time zone 'America/Toronto')::date-7
 then raise exception 'CAD exchange-rate quote changed or expired' using errcode='P0001'; end if;
 code:=upper(btrim(coalesce(request->'checkout'->>'coupon',''))); coupon_bps:=case when code='BLACKFRIDAY15' then 1500 else 0 end;
 if code not in ('','BLACKFRIDAY15') or request->'checkout'->>'coupon' is distinct from code
  or pricing->>'coupon_code' is distinct from code or pricing->>'promotion_version' is distinct from 'blackfriday15-2026-11-v1'
  or pricing->>'payment_discount_version' is distinct from 'pure-payments-2026-11-v2'
  or pricing->'bogo_free_units' is distinct from '0'::jsonb or pricing->'crypto_discount_cents' is distinct from '0'::jsonb
  or pricing->'crypto_discount_eligible' is distinct from 'false'::jsonb
  or pricing->'crypto_discount_suppressed_for_balance' is distinct from 'false'::jsonb
  or pricing->>'discount_source' is distinct from (case when code='' then 'none' else 'coupon' end)
 then raise exception 'CAD coupon or payment discount changed' using errcode='22023'; end if;
 if pricing ? 'referral' and (jsonb_typeof(pricing->'referral') is distinct from 'object'
  or jsonb_typeof(pricing->'referral'->'partner_id') is distinct from 'string'
  or jsonb_typeof(pricing->'referral'->'code') is distinct from 'string'
  or jsonb_typeof(pricing->'referral'->'first_order') is distinct from 'boolean'
  or ((pricing->'referral')-array['partner_id','code','first_order']) is distinct from '{}'::jsonb)
 then raise exception 'Invalid neutral referral attribution' using errcode='22023'; end if;
 -- Validate and convert purchased units before calculating the order coupon.
 for i in 0..jsonb_array_length(request->'items')-1 loop
  item:=request->'items'->i;
  foreach k in array array['qty','unit_price_usd_cents'] loop
   if jsonb_typeof(item->k) is distinct from 'number' or item->>k !~ '^[0-9]+$'
   then raise exception 'Invalid catalog item amount' using errcode='22023'; end if;
  end loop;
  quantity:=(item->>'qty')::integer; unit_usd:=(item->>'unit_price_usd_cents')::integer; variant_key:=(item->>'id')||'|'||(item->>'size');
  if quantity not between 1 and 100 or unit_usd not between 1 and 1000000
   or nullif(item->>'id','') is null or nullif(item->>'name','') is null or nullif(item->>'size','') is null
   or variant_key=any(seen) or item ?| array['membership_gift','bogo_free_units','free_qty','paid_qty']
  then raise exception 'Invalid purchased product' using errcode='22023'; end if;
  seen:=array_append(seen,variant_key);
  unit_cad:=round(unit_usd::numeric*rate/1000000)::integer;
  if unit_cad<1 then raise exception 'Converted product amount is too small' using errcode='22023'; end if;
  subtotal:=subtotal+quantity*unit_cad;usd_subtotal:=usd_subtotal+quantity*unit_usd;
  if subtotal>100000000 or usd_subtotal>100000000 then raise exception 'Checkout amount exceeds supported range' using errcode='22023'; end if;
 end loop;
 with amounts as (
  select ordinality,(value->>'qty')::numeric*round((value->>'unit_price_usd_cents')::numeric*rate/1000000) as gross
  from jsonb_array_elements(request->'items') with ordinality
 ), parts as (
  select ordinality,floor(amounts.gross*coupon_bps/10000)::integer as base,
   row_number() over(order by mod(amounts.gross*coupon_bps,10000) desc,ordinality) as rank,
   round(sum(amounts.gross) over()*coupon_bps/10000)::integer-sum(floor(amounts.gross*coupon_bps/10000)::integer) over() as pennies
  from amounts
 ) select jsonb_agg(base+case when rank<=pennies then 1 else 0 end order by ordinality) into line_discounts from parts;
 for i in 0..jsonb_array_length(request->'items')-1 loop
  item:=request->'items'->i;line:=pricing->'lines'->i;quantity:=(item->>'qty')::integer;
  unit_cad:=round((item->>'unit_price_usd_cents')::numeric*rate/1000000)::integer;gross:=unit_cad*quantity;discount:=(line_discounts->>i)::integer;
  foreach k in array array['id','name','size','qty','unit_price_usd_cents'] loop
   if line->k is distinct from item->k then raise exception 'Quoted item differs from purchased item' using errcode='22023'; end if;
  end loop;
  if line->'unit_price_cents' is distinct from to_jsonb(unit_cad) or line->'gross_cents' is distinct from to_jsonb(gross)
   or line->'discount_cents' is distinct from to_jsonb(discount) or line->'coupon_discount_cents' is distinct from to_jsonb(discount)
   or line->'crypto_discount_cents' is distinct from '0'::jsonb or line->'line_total_cents' is distinct from to_jsonb(gross-discount)
   or line->'discount_bps' is distinct from to_jsonb(coupon_bps)
   or line->>'discount_reason' is distinct from (case when code='' then 'none' else 'coupon_blackfriday15' end)
   or line->'bogo_free_units' is distinct from '0'::jsonb
   or line ?| array['membership_gift','free_qty','paid_qty','bank_discount_cents','payment_discount_cents','bulk_tier']
  then raise exception 'CAD merchandise or coupon arithmetic changed' using errcode='22023'; end if;
  discounts:=discounts+discount;
 end loop;
 usd_discount:=round(usd_subtotal::numeric*coupon_bps/10000)::integer;
 if pricing->'usd_basis' is distinct from jsonb_build_object('currency','USD','subtotal_cents',usd_subtotal,'coupon_discount_cents',usd_discount,'merchandise_cents',usd_subtotal-usd_discount)
 then raise exception 'USD partner merchandise basis changed' using errcode='22023'; end if;
 delivery_usd:=commerce_internal.regular_delivery_quote(request->'checkout'->'delivery','CA',usd_subtotal-usd_discount);
 shipping:=round((delivery_usd->>'shipping_cents')::numeric*rate/1000000)::integer;
 select coalesce(jsonb_agg(value||jsonb_build_object('amount_cents',round((value->>'amount_cents')::numeric*rate/1000000)::integer) order by ordinality),'[]'::jsonb),
  coalesce(sum(round((value->>'amount_cents')::numeric*rate/1000000)::integer),0)::integer
 into delivery_extras,extras_total from jsonb_array_elements(delivery_usd->'extras') with ordinality;
 expected_delivery:=delivery_usd||jsonb_build_object('currency','CAD','shipping_cents',shipping,'extras',delivery_extras,'extras_cents',extras_total,'total_cents',shipping+extras_total);
 if p_data->'subtotal_cents' is distinct from to_jsonb(subtotal) or pricing->'subtotal_cents' is distinct from to_jsonb(subtotal)
  or p_data->'discount_cents' is distinct from to_jsonb(discounts) or pricing->'discount_cents' is distinct from to_jsonb(discounts)
  or pricing->'coupon_discount_cents' is distinct from to_jsonb(discounts)
  or pricing->'delivery' is distinct from expected_delivery or p_data->'shipping_cents' is distinct from expected_delivery->'total_cents'
  or p_data->'total_cents' is distinct from to_jsonb(subtotal-discounts+shipping+extras_total)
  or subtotal-discounts+shipping+extras_total not between 1 and 100000000
 then raise exception 'CAD checkout total or delivery changed' using errcode='22023'; end if;
end $$;
revoke all on function commerce_internal.validate_interac_checkout(jsonb) from public,anon,authenticated,service_role;

create function public.commerce_place_interac_checkout(p_data jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare
 r public.commerce_invoices%rowtype;m public.commerce_payment_methods%rowtype;
 uid uuid:=(p_data->>'customer_id')::uuid;oid uuid:=(p_data->>'id')::uuid;n integer;
begin
 if uid is null or oid is null or jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>50000
  or p_data->>'checkout_version' is distinct from 'checkout-interac-cad-2026-11-v1'
  or p_data->'consent' is distinct from 'true'::jsonb or p_data->>'terms_version' is distinct from 'launch-2026-11-v1'
  or p_data->>'currency' is distinct from 'CAD' or p_data->>'kind' is distinct from 'goods'
  or coalesce(p_data->>'digest','') !~ '^[a-f0-9]{64}$'
 then raise exception 'Invalid Interac checkout' using errcode='22023'; end if;
 -- Match existing checkout lock order. A successful retry uses the saved amount,
 -- including after its short-lived rate quote expires; it never reprices an order.
 perform pg_advisory_xact_lock(hashtextextended(oid::text,23));
 select * into r from public.commerce_invoices where id=oid for update;
 if found then
  if r.customer_id is distinct from uid or r.request_digest is distinct from p_data->>'digest'
   or r.checkout_version is distinct from 'checkout-interac-cad-2026-11-v1' or r.currency is distinct from 'CAD'
  then raise exception 'Checkout reference conflict' using errcode='23505'; end if;
  return jsonb_build_object('id',r.id,'status',r.status,'currency',r.currency,'total_cents',r.total_cents,'manual_transfer',true,'replayed',true);
 end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text,0));
 select count(*) into n from public.commerce_invoices where customer_id=uid and status in ('requested','issued','accepted');
 if n>=10 then raise exception 'Cancel unpaid orders before creating more' using errcode='P0001'; end if;
 select * into m from public.commerce_payment_methods where id=(p_data->>'method_id')::uuid for share;
 if not found or not m.active or m.kind is distinct from 'interac' or m.provider_key is distinct from 'interac'
  or m.currency is distinct from 'CAD' or m.native_provider is not null or m.sale_scope not in ('both','goods')
  or m.version is distinct from (p_data->>'method_version')::integer
  or p_data->'request'->'preferred_payment'->>'label' is distinct from m.label
 then raise exception 'Interac receiving method changed' using errcode='P0001'; end if;
 perform commerce_internal.validate_interac_checkout(p_data);
 if p_data->'pricing' ? 'referral' then perform commerce_internal.validate_referral(uid,p_data->>'customer_email',p_data->'pricing'->'referral'); end if;
 insert into public.commerce_invoices(id,customer_id,customer_email,customer_name,kind,plan,request_digest,request_data,terms_version,status,currency,
  pricing,subtotal_cents,discount_cents,shipping_cents,tax_cents,total_cents,method_id,payment_snapshot,expires_at,accepted_at,checkout_version,points_redeemed,credit_redeemed_cents,earned_points)
 values(oid,uid,lower(trim(p_data->>'customer_email')),p_data->>'customer_name','goods',null,p_data->>'digest',p_data->'request','launch-2026-11-v1','accepted','CAD',
  p_data->'pricing',(p_data->>'subtotal_cents')::integer,(p_data->>'discount_cents')::integer,(p_data->>'shipping_cents')::integer,0,(p_data->>'total_cents')::integer,
  m.id,jsonb_build_object('kind','interac','provider_key','interac','currency','CAD','label',m.label,'payee',m.payee,'instructions',m.instructions,'method_version',m.version,
   'payment_reference','AP'||upper(substr(replace(oid::text,'-',''),1,10)),'payment_url',null),now()+interval '24 hours',now(),'checkout-interac-cad-2026-11-v1',0,0,0);
 insert into public.commerce_events(invoice_id,action,actor,details)
  values(oid,'checkout_placed','customer:'||uid,jsonb_build_object('amount_cents',(p_data->>'total_cents')::integer,'currency','CAD','version','checkout-interac-cad-2026-11-v1'));
 return jsonb_build_object('id',oid,'status','accepted','currency','CAD','total_cents',(p_data->>'total_cents')::integer,'manual_transfer',true,'created',true);
end $$;
revoke all on function public.commerce_place_interac_checkout(jsonb) from public,anon,authenticated;
grant execute on function public.commerce_place_interac_checkout(jsonb) to service_role;

-- Partner balances and payouts remain denominated in USD. Only the new CAD
-- checkout uses its independently validated original-USD merchandise basis.
-- Existing USD orders retain precisely their prior saved commission calculation.
create or replace function commerce_internal.partner_order_transition()
returns trigger language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare pid uuid;first_id uuid;basis integer;rate integer;
begin
 if new.kind<>'goods' or old.status=new.status then return new; end if;
 perform 1 from public.commerce_partners where customer_id in (select partner_id from public.commerce_partner_commissions where invoice_id=new.id) for update;
 if new.status='paid' and old.status='accepted' and new.checkout_version in ('checkout-2026-11-v3','checkout-2026-11-v4','checkout-2026-11-v5','checkout-2026-11-v6','checkout-2026-11-v7','checkout-interac-cad-2026-11-v1') then
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
   if new.checkout_version='checkout-interac-cad-2026-11-v1' then
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
commit;
