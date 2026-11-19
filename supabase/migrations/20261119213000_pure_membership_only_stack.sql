-- Retires separately billed AUTO-STACK and authorizes the Member Stack
-- only as an independently paid goods benefit of a verified paid membership.
-- Preserve all history; do not modify PURE membership entitlement prices or existing orders.
CREATE OR REPLACE FUNCTION commerce_internal.validate_member_stack_checkout(p_data jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
declare
  r jsonb:=p_data->'request'; p jsonb:=p_data->'pricing'; line jsonb; item jsonb;
  ids text[]:=array[]::text[]; n integer; unit integer; gross integer; discount integer;
  subtotal bigint:=0; savings bigint:=0; selection jsonb:='{"shipping":"express","extras":[]}'::jsonb;
begin
  if p_data->>'kind' is distinct from 'goods' or p_data->>'currency' is distinct from 'USD'
    or p_data->>'checkout_version' is distinct from 'checkout-2026-11-v8'
    or r->>'research_builder_mode' is distinct from 'member_stack'
    or r->'address'->>'country' is distinct from 'US'
    or r ? 'research_plan_id'
    or p_data->>'membership_invoice_id' is null
    or r->'research_use_confirmed' is distinct from 'true'::jsonb
    or r->'checkout'->'delivery' is distinct from selection
    or p->'delivery'->'selection' is distinct from selection
    or p->'delivery'->>'country' is distinct from 'US'
    or p->'delivery'->>'rate_version' is distinct from 'shipping-2026-11-v3'
    or p->'delivery'->'shipping_cents' is distinct from '0'::jsonb
    or p->'delivery'->'extras_cents' is distinct from '0'::jsonb
    or p->'delivery'->'total_cents' is distinct from '0'::jsonb
    or p->'delivery'->'extras' is distinct from '[]'::jsonb
    or r->'checkout'->>'coupon' is distinct from ''
    or r->'checkout'->'points' is distinct from '0'::jsonb
    or r->'checkout'->'credit_cents' is distinct from '0'::jsonb
    or p_data->'points_redeemed' is distinct from '0'::jsonb
    or p_data->'credit_redeemed_cents' is distinct from '0'::jsonb
    or p_data->'earned_points' is distinct from '0'::jsonb
    or p_data->'shipping_cents' is distinct from '0'::jsonb
    or p_data->'tax_cents' is distinct from '0'::jsonb
    or p->'redeemed_points' is distinct from '0'::jsonb
    or p->'credit_cents' is distinct from '0'::jsonb
    or p->'usd_earned_points_basis_cents' is distinct from '0'::jsonb
    or p->>'research_builder_pricing_version' is distinct from 'pure-member-stack-2026-11-v1'
    or p->>'billing_mode' is distinct from 'member_purchase'
    or p->'automatic_renewal' is distinct from 'false'::jsonb
    or p->>'discount_source' is distinct from 'member_stack'
    or p->>'payment_discount_version' is distinct from 'pure-payments-2026-11-v2'
    or p->'crypto_discount_eligible' is distinct from 'false'::jsonb
    or p->'crypto_discount_suppressed_for_balance' is distinct from 'false'::jsonb
    or p->'crypto_discount_cents' is distinct from '0'::jsonb
    or p->'membership_discount_cents' is distinct from '0'::jsonb
    or p->'coupon_discount_cents' is distinct from '0'::jsonb
    or p->'membership_discount_bps' is distinct from '0'::jsonb
    or p->'membership_plan' is distinct from 'null'::jsonb
    or p->>'promotion_version' is distinct from 'blackfriday15-2026-11-v1'
    or p->>'coupon_code' is distinct from ''
    or p->'bogo_free_units' is distinct from '0'::jsonb
    or p->'membership_benefits' is distinct from '{"free_shipping":false,"priority_fulfillment":false,"free_bac_water_3ml":false}'::jsonb
    or p->'bundled_items' is distinct from '[{"id":"gift-bac-3","name":"BAC Water","size":"3 mL","qty":1,"unit_price_cents":0,"line_total_cents":0}]'::jsonb
    or coalesce(r->>'subscription','false')<>'false' or coalesce(r->>'automatic_renewal','false')<>'false'
    or coalesce(r->>'research_builder','false')<>'false'
    or r->>'billing_period' is not null or r->>'plan' is not null
    or coalesce(r->>'bulk_order','false')<>'false'
    or p ?| array['referral','bulk_tier','payment_discount','referral_discount','delivery_tax']
  then raise exception 'Invalid Member Stack payment terms' using errcode='22023'; end if;
  if jsonb_typeof(r->'items') is distinct from 'array' or jsonb_typeof(p->'lines') is distinct from 'array'
     or jsonb_array_length(r->'items')<>4 or jsonb_array_length(p->'lines')<>4
  then raise exception 'Select four Member Stack compounds' using errcode='22023'; end if;
  for n in 0..3 loop
    item:=r->'items'->n;line:=p->'lines'->n;
    if item->>'id' is null or item->>'id' ~ '^(bac-|needle|syringe|supply|gift-)'
      or item->>'id'=any(ids) or item->'qty' is distinct from '1'::jsonb
      or jsonb_typeof(item->'unit_price_usd_cents') is distinct from 'number'
      or coalesce(item->>'unit_price_usd_cents','') !~ '^[0-9]+$'
      or coalesce(item->>'name','')='' or coalesce(item->>'size','')=''
    then raise exception 'Invalid Member Stack selection' using errcode='22023';end if;
    ids:=array_append(ids,item->>'id');
    unit:=(item->>'unit_price_usd_cents')::integer;
    if unit not between 1 and 1000000 then raise exception 'Invalid monthly product price' using errcode='22023';end if;
    gross:=unit; discount:=floor(gross::numeric*4000/10000)::integer;
    if (line->'id') is distinct from (item->'id')
      or (line->'name') is distinct from (item->'name')
      or (line->'size') is distinct from (item->'size')
      or (line->'qty') is distinct from (item->'qty')
      or (line->'unit_price_usd_cents') is distinct from (item->'unit_price_usd_cents')
      or line->'unit_price_cents' is distinct from to_jsonb(unit)
      or line->'gross_cents' is distinct from to_jsonb(gross)
      or line->'discount_cents' is distinct from to_jsonb(discount)
      or line->'discount_bps' is distinct from '4000'::jsonb
      or line->>'discount_reason' is distinct from 'member_stack'
      or line->'line_total_cents' is distinct from to_jsonb(gross-discount)
      or line->'membership_discount_cents' is distinct from '0'::jsonb
      or line->'coupon_discount_cents' is distinct from '0'::jsonb
      or line->'crypto_discount_cents' is distinct from '0'::jsonb
      or line->'bogo_free_units' is distinct from '0'::jsonb
    then raise exception 'Member Stack pricing changed' using errcode='22023';end if;
    subtotal:=subtotal+gross;savings:=savings+discount;
  end loop;
  if p_data->'subtotal_cents' is distinct from to_jsonb(subtotal)
    or p->'subtotal_cents' is distinct from to_jsonb(subtotal)
    or p_data->'discount_cents' is distinct from to_jsonb(savings)
    or p->'discount_cents' is distinct from to_jsonb(savings)
    or p_data->'total_cents' is distinct from to_jsonb(subtotal-savings)
    or p->'currency' is distinct from '"USD"'::jsonb
    or p->'fx_ppm' is distinct from '1000000'::jsonb
    or p_data->'method_id' is distinct from r->'checkout'->'method_id'
  then raise exception 'Member Stack total changed' using errcode='22023';end if;
end $function$
;
revoke all on function commerce_internal.validate_member_stack_checkout(jsonb) from public,anon,authenticated;
CREATE OR REPLACE FUNCTION commerce_internal.validate_membership_checkout(p_data jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
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
  quantity_mode boolean:=coalesce(pricing->>'quantity_discount_version','')='pure-quantity-2026-11-v1';
  tier_rate integer:=0; winner_rate integer:=0; quantity_discount integer:=0; line_quantity_discount integer:=0; eligible_tier boolean:=false;
  usd_member_discount integer:=0; usd_coupon_discount integer:=0;
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
    or (request ? 'research_builder_mode' and request->>'research_builder_mode' not in ('one_time','member_stack'))
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

  if request->>'research_builder_mode'='member_stack' then
    perform commerce_internal.validate_member_stack_checkout(p_data);return;
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
  if quantity_mode then
    base_parts:='[]'::jsonb;
    for n in 0..jsonb_array_length(amounts)-1 loop
      quantity:=(request->'items'->n->>'qty')::integer;
      tier_rate:=case when quantity>=10 then 2000 when quantity>=5 then 1000 when quantity>=2 then 500 else 0 end;
      winner_rate:=greatest(tier_rate,member_rate,coupon_rate);
      line_base:=round((amounts->>n)::numeric*winner_rate/10000)::integer;
      base_parts:=base_parts||to_jsonb(line_base);base_discount:=base_discount+line_base;
      if tier_rate>member_rate and tier_rate>coupon_rate then eligible_tier:=true;quantity_discount:=quantity_discount+line_base;
      elsif member_rate>coupon_rate then member_discount:=member_discount+line_base;
      else coupon_discount:=coupon_discount+line_base;end if;
    end loop;
    if not eligible_tier or pricing->'quantity_discount_cents' is distinct from to_jsonb(quantity_discount)
      or pricing->>'quantity_discount_version' is distinct from 'pure-quantity-2026-11-v1'
    then raise exception 'Invalid quantity savings' using errcode='22023';end if;
  else
    member_applied:=round(subtotal::numeric*member_rate/10000)>round(subtotal::numeric*coupon_rate/10000);
    base_rate:=case when member_applied then member_rate else coupon_rate end;
    base_discount:=round(subtotal::numeric*base_rate/10000)::integer;
    base_parts:=commerce_internal.checkout_discount_parts(amounts,base_rate);
  end if;
  for n in 0..jsonb_array_length(amounts)-1 loop net_amounts:=net_amounts||to_jsonb((amounts->>n)::integer-(base_parts->>n)::integer);end loop;
  if crypto_eligible then
    expected_delivery:=commerce_internal.membership_delivery_quote(request->'checkout'->'delivery',request->'address'->>'country',subtotal-base_discount-round((subtotal-base_discount)::numeric*500/10000)::integer,member.plan);
    suppressed:=points+credit>=subtotal-base_discount-round((subtotal-base_discount)::numeric*500/10000)::integer+(expected_delivery->>'total_cents')::integer;
  end if;
  crypto_rate:=case when crypto_eligible and not suppressed then 500 else 0 end;
  crypto_parts:=commerce_internal.checkout_discount_parts(net_amounts,crypto_rate);
  if not quantity_mode then member_discount:=case when member_applied then base_discount else 0 end;coupon_discount:=case when member_applied then 0 else base_discount end;end if;
  crypto_discount:=round((subtotal-base_discount)::numeric*crypto_rate/10000)::integer;discounts:=base_discount+crypto_discount;
  base_source:=case when quantity_discount>0 and (member_discount>0 or coupon_discount>0) then 'mixed' when quantity_discount>0 then 'quantity' when member_discount>0 then 'membership' when coupon_discount>0 then 'coupon' else 'none' end;
  source:=case when crypto_rate>0 then case when base_source='none' then 'crypto' else base_source||'_crypto' end else base_source end;
  if pricing->>'payment_discount_version' is distinct from 'pure-payments-2026-11-v2'
    or pricing->'crypto_discount_eligible' is distinct from to_jsonb(crypto_eligible)
    or pricing->'crypto_discount_suppressed_for_balance' is distinct from to_jsonb(suppressed)
    or pricing->>'discount_source' is distinct from source
  then raise exception 'Payment discount policy changed' using errcode='22023';end if;
  for n in 0..jsonb_array_length(request->'items')-1 loop
    item:=request->'items'->n;line:=pricing->'lines'->n;gross:=(amounts->>n)::integer;
    unit:=round((item->>'unit_price_usd_cents')::numeric*rate/1000000)::integer;line_base:=(base_parts->>n)::integer;line_crypto:=(crypto_parts->>n)::integer;
    line_quantity_discount:=0;
    if quantity_mode then
      quantity:=(item->>'qty')::integer;
      tier_rate:=case when quantity>=10 then 2000 when quantity>=5 then 1000 when quantity>=2 then 500 else 0 end;
      winner_rate:=greatest(tier_rate,member_rate,coupon_rate);
      if tier_rate>member_rate and tier_rate>coupon_rate then
        line_quantity_discount:=line_base;line_member:=0;line_coupon:=0;
        reason:='quantity_'||case when quantity>=10 then '10' when quantity>=5 then '5' else '2' end;
      elsif member_rate>coupon_rate then
        line_member:=line_base;line_coupon:=0;reason:='membership_'||member.plan;
      else
        line_member:=0;line_coupon:=case when coupon_rate>0 then line_base else 0 end;
        reason:=case when code<>'' then 'coupon_blackfriday15' else 'none' end;
      end if;
    else
      winner_rate:=base_rate;
      line_member:=case when member_applied then line_base else 0 end;line_coupon:=case when member_applied then 0 else line_base end;
      reason:=case when member_applied then 'membership_'||member.plan when code<>'' then 'coupon_blackfriday15' else 'none' end;
    end if;
    if crypto_rate>0 then
      reason:=case when line_member>0 then reason||'_crypto_direct'
        when line_coupon>0 then 'coupon_blackfriday15_crypto_direct'
        when line_quantity_discount>0 then reason||'_crypto_direct' else 'crypto_direct' end;
    end if;
    foreach key in array array['id','name','size','qty','unit_price_usd_cents'] loop
      if line->key is distinct from item->key then raise exception 'Quoted item differs from purchased item' using errcode='22023';end if;
    end loop;
    if line->'unit_price_cents' is distinct from to_jsonb(unit) or line->'gross_cents' is distinct from to_jsonb(gross)
      or line->'discount_cents' is distinct from to_jsonb(line_base+line_crypto)
      or line->'membership_discount_cents' is distinct from to_jsonb(line_member)
      or line->'coupon_discount_cents' is distinct from to_jsonb(line_coupon)
      or line->'crypto_discount_cents' is distinct from to_jsonb(line_crypto)
      or line->'line_total_cents' is distinct from to_jsonb(gross-line_base-line_crypto)
      or line->'discount_bps' is distinct from to_jsonb(winner_rate+(10000-winner_rate)*crypto_rate/10000)
      or (quantity_mode and line->'quantity_discount_cents' is distinct from to_jsonb(line_quantity_discount))
      or line->>'discount_reason' is distinct from reason or line->'bogo_free_units' is distinct from '0'::jsonb
      or line ?| array['membership_gift','free_qty','paid_qty','bank_discount_cents','payment_discount_cents','bulk_tier']
    then raise exception 'Membership, coupon or Crypto arithmetic changed' using errcode='22023';end if;
  end loop;
  if quantity_mode then
    for n in 0..jsonb_array_length(usd_amounts)-1 loop
      quantity:=(request->'items'->n->>'qty')::integer;
      tier_rate:=case when quantity>=10 then 2000 when quantity>=5 then 1000 when quantity>=2 then 500 else 0 end;
      winner_rate:=greatest(tier_rate,member_rate,coupon_rate);
      line_base:=round((usd_amounts->>n)::numeric*winner_rate/10000)::integer;
      usd_base_discount:=usd_base_discount+line_base;
      if tier_rate>member_rate and tier_rate>coupon_rate then null;
      elsif member_rate>coupon_rate then usd_member_discount:=usd_member_discount+line_base;
      else usd_coupon_discount:=usd_coupon_discount+line_base;end if;
    end loop;
  else
    usd_member_applied:=round(usd_subtotal::numeric*member_rate/10000)>round(usd_subtotal::numeric*coupon_rate/10000);
    usd_base_discount:=round(usd_subtotal::numeric*(case when usd_member_applied then member_rate else coupon_rate end)/10000)::integer;
    usd_member_discount:=case when usd_member_applied then usd_base_discount else 0 end;
    usd_coupon_discount:=case when usd_member_applied then 0 else usd_base_discount end;
  end if;
  usd_net:=case when is_cad then usd_subtotal-usd_base_discount else subtotal-discounts end;
  earning_basis:=greatest(0,usd_net-points-credit);expected_earned:=floor(earning_basis::numeric*earning_rate/100)::integer;
  if pricing->'usd_earned_points_basis_cents' is distinct from to_jsonb(earning_basis) or p_data->'earned_points' is distinct from to_jsonb(expected_earned)
  then raise exception 'USD points earning basis changed' using errcode='22023';end if;
  if is_cad and pricing->'usd_basis' is distinct from jsonb_build_object('currency','USD','subtotal_cents',usd_subtotal,
    'coupon_discount_cents',usd_coupon_discount,'membership_discount_cents',usd_member_discount,'merchandise_cents',usd_net)
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
end $function$
;
CREATE OR REPLACE FUNCTION commerce_internal.regular_invoice_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
begin
  if new.request_data->>'research_builder'='true' or new.request_data->>'subscription'='true'
    or (new.request_data ? 'research_builder_mode' and new.request_data->>'research_builder_mode' not in ('one_time','member_stack'))
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
  gift:=r.checkout_version in ('checkout-2026-11-v8','checkout-interac-cad-2026-11-v2') and exists(
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
-- No separate member-stack subscription or paid-cycle tracking is permitted.
drop trigger if exists pure_stack_paid_cycle_verified on public.commerce_invoices;
