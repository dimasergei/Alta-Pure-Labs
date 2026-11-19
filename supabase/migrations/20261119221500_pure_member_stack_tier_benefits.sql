-- PURE WHITE Member Stack = 20% and included US standard shipping.
-- PURE BLACK Member Stack = 40% and included US express shipping.
-- All membership tier determinations come from verified database entitlements,
-- never client-submitted pricing, a tier label, or shipping preferences.
-- Keep prior paid orders unchanged; v2 applies to new Member Stack purchases only.
CREATE OR REPLACE FUNCTION commerce_internal.validate_member_stack_checkout(p_data jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
declare
  r jsonb:=p_data->'request'; p jsonb:=p_data->'pricing'; line jsonb; item jsonb;
  ids text[]:=array[]::text[]; n integer; unit integer; gross integer; discount integer;
  subtotal bigint:=0; savings bigint:=0; selection jsonb;
  member public.commerce_memberships%rowtype;
  tier_discount_bps integer;
begin
  member:=commerce_internal.active_paid_membership((p_data->>'customer_id')::uuid,now());
  if member.invoice_id is null
    or member.invoice_id::text is distinct from (p_data->>'membership_invoice_id')
    or member.plan not in ('vip','elite')
  then raise exception 'Member Stack requires an active paid PURE membership' using errcode='P0001';end if;
  tier_discount_bps:=case member.plan when 'vip' then 2000 when 'elite' then 4000 end;
  selection:=jsonb_build_object('shipping',case member.plan when 'vip' then 'standard' else 'express' end,'extras','[]'::jsonb);
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
    or p->>'research_builder_pricing_version' is distinct from 'pure-member-stack-2026-11-v2'
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
    gross:=unit; discount:=floor(gross::numeric*tier_discount_bps/10000)::integer;
    if (line->'id') is distinct from (item->'id')
      or (line->'name') is distinct from (item->'name')
      or (line->'size') is distinct from (item->'size')
      or (line->'qty') is distinct from (item->'qty')
      or (line->'unit_price_usd_cents') is distinct from (item->'unit_price_usd_cents')
      or line->'unit_price_cents' is distinct from to_jsonb(unit)
      or line->'gross_cents' is distinct from to_jsonb(gross)
      or line->'discount_cents' is distinct from to_jsonb(discount)
      or line->'discount_bps' is distinct from to_jsonb(tier_discount_bps)
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
