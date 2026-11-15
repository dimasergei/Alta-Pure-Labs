-- The checkout API resolves IDs/strengths against the server catalog before this
-- service-role-only RPC. This second boundary independently validates the bulk
-- quantity, discount and payable arithmetic before an invoice can be created.
begin;

create or replace function commerce_internal.validate_bulk_checkout(p_data jsonb)
returns void language plpgsql security invoker immutable
set search_path=pg_catalog,pg_temp as $$
declare
 items jsonb:=p_data->'request'->'items';
 lines jsonb:=p_data->'pricing'->'lines';
 item jsonb; line jsonb; i integer; qty integer; unit integer; units integer;
 gross bigint; discount bigint; subtotal bigint:=0; savings bigint:=0; bps integer;
begin
 if p_data->>'kind' is distinct from 'goods'
 or p_data->>'checkout_version' is distinct from 'checkout-2026-11-v4'
 or p_data->'request'->'bulk_order' is distinct from 'true'::jsonb
 or p_data->'pricing'->'bulk_order' is distinct from 'true'::jsonb
 or p_data->>'currency' is distinct from 'USD'
 or p_data->'pricing'->>'currency' is distinct from 'USD'
 or p_data->'pricing'->'fx_ppm' is distinct from '1000000'::jsonb
 or p_data->'request'->'address'->>'country' is distinct from 'US'
 or p_data->'request'->'checkout'->'delivery' is distinct from '{"shipping":"express","extras":[]}'::jsonb
 or p_data->'pricing'->'delivery'->'selection' is distinct from '{"shipping":"express","extras":[]}'::jsonb
 or p_data->'pricing'->'delivery'->'shipping_cents' is distinct from '0'::jsonb
 or p_data->'pricing'->'delivery'->'extras_cents' is distinct from '0'::jsonb
 or p_data->'pricing'->'delivery'->'total_cents' is distinct from '0'::jsonb
 or p_data->'pricing'->'delivery'->'extras' is distinct from '[]'::jsonb
 or p_data->'request'->'checkout'->>'coupon' is distinct from ''
 or p_data->'request'->'checkout'->'points' is distinct from '0'::jsonb
 or p_data->'request'->'checkout'->'credit_cents' is distinct from '0'::jsonb
 or p_data->'points_redeemed' is distinct from '0'::jsonb
 or p_data->'credit_redeemed_cents' is distinct from '0'::jsonb
 or p_data->'pricing'->'redeemed_points' is distinct from '0'::jsonb
 or p_data->'pricing'->'credit_cents' is distinct from '0'::jsonb
 or p_data->'shipping_cents' is distinct from '0'::jsonb
 or p_data->'tax_cents' is distinct from '0'::jsonb
 or p_data->'pricing' ?| array['payment_discount','referral','referral_discount','promotion_version','coupon_code','bogo_free_units','coupon_discount_cents']
 then raise exception 'Invalid bulk checkout terms' using errcode='22023'; end if;
 if jsonb_typeof(items) is distinct from 'array' or jsonb_typeof(lines) is distinct from 'array' then
  raise exception 'Invalid bulk checkout items' using errcode='22023';
 end if;
 if jsonb_array_length(items) not between 1 and 60 or jsonb_array_length(lines)<>jsonb_array_length(items)
 or exists(select 1 from jsonb_array_elements(items) x group by x->>'id',x->>'size' having count(*)>1)
 then raise exception 'Invalid bulk checkout items' using errcode='22023'; end if;

 -- Validate all source lines before aggregating quantities. PostgreSQL numeric
 -- equality permits JSON 10.0, but fractional quantities are explicitly rejected.
 for item in select value from jsonb_array_elements(items) loop
  if jsonb_typeof(item) is distinct from 'object'
  or jsonb_typeof(item->'id') is distinct from 'string' or length(item->>'id') not between 1 and 200
  or jsonb_typeof(item->'size') is distinct from 'string' or length(item->>'size') not between 1 and 200
  or jsonb_typeof(item->'qty') is distinct from 'number'
  or jsonb_typeof(item->'unit_price_usd_cents') is distinct from 'number'
  then raise exception 'Invalid bulk source item' using errcode='22023'; end if;
  if (item->>'qty')::numeric not between 1 and 100 or trunc((item->>'qty')::numeric)<>(item->>'qty')::numeric
  or (item->>'unit_price_usd_cents')::numeric not between 1 and 100000000
  or trunc((item->>'unit_price_usd_cents')::numeric)<>(item->>'unit_price_usd_cents')::numeric
  then raise exception 'Invalid bulk source quantity or price' using errcode='22023'; end if;
 end loop;

 for i in 0..jsonb_array_length(items)-1 loop
  item:=items->i; line:=lines->i;
  qty:=(item->>'qty')::numeric::integer; unit:=(item->>'unit_price_usd_cents')::numeric::integer;
  select sum((x->>'qty')::numeric)::integer into units from jsonb_array_elements(items) x where x->>'id'=item->>'id';
  if units<10 then raise exception 'Each bulk product requires at least 10 units across its strengths' using errcode='22023'; end if;
  bps:=case when units>=50 then 6000 else 5000 end;
  gross:=unit::bigint*qty; discount:=floor(gross::numeric*bps/10000)::bigint;
  if jsonb_typeof(line) is distinct from 'object'
  or line->'id' is distinct from item->'id' or line->'size' is distinct from item->'size'
  or line->'name' is distinct from item->'name'
  or line->'qty' is distinct from to_jsonb(qty)
  or line->'unit_price_usd_cents' is distinct from to_jsonb(unit)
  or line->'unit_price_cents' is distinct from to_jsonb(unit)
  or line->'gross_cents' is distinct from to_jsonb(gross)
  or line->'discount_bps' is distinct from to_jsonb(bps)
  or line->'discount_cents' is distinct from to_jsonb(discount)
  or line->>'discount_reason' is distinct from 'bulk'
  or line->'line_total_cents' is distinct from to_jsonb(gross-discount)
  or line ?| array['bogo_free_units','coupon_discount_cents']
  then raise exception 'Bulk line does not match its product tier' using errcode='22023'; end if;
  subtotal:=subtotal+gross; savings:=savings+discount;
 end loop;
 if p_data->'subtotal_cents' is distinct from to_jsonb(subtotal)
 or p_data->'pricing'->'subtotal_cents' is distinct from to_jsonb(subtotal)
 or p_data->'discount_cents' is distinct from to_jsonb(savings)
 or p_data->'pricing'->'discount_cents' is distinct from to_jsonb(savings)
 or p_data->'total_cents' is distinct from to_jsonb(subtotal-savings)
 then raise exception 'Bulk total does not match its product tiers' using errcode='22023'; end if;
end $$;
revoke all on function commerce_internal.validate_bulk_checkout(jsonb) from public,anon,authenticated;
grant execute on function commerce_internal.validate_bulk_checkout(jsonb) to service_role;

-- Preserve the currently installed checkout implementation, including unrelated
-- payment/membership changes. Fail closed if either exact insertion point changed.
do $migration$
declare source text; original text;
 guard_anchor constant text:=E' -- Order lock precedes account lock, matching existing payment/refund transitions.';
 shipping_anchor constant text:='ship<>(case when p_data->>''checkout_version''=''checkout-2026-11-v4'' then commerce_internal.delivery_total';
begin
 select pg_get_functiondef('public.commerce_place_checkout(jsonb)'::regprocedure) into source;
 original:=source;
 if strpos(source,'commerce_internal.validate_bulk_checkout(p_data)')>0 then
  raise exception 'Bulk checkout validation is already installed';
 end if;
 if (length(source)-length(replace(source,guard_anchor,'')))/length(guard_anchor)<>1
 or (length(source)-length(replace(source,shipping_anchor,'')))/length(shipping_anchor)<>1 then
  raise exception 'Checkout implementation changed; review bulk migration insertion points';
 end if;
 source:=replace(source,guard_anchor,E' if p_data->''request'' ? ''bulk_order'' or p_data->''pricing'' ? ''bulk_order'' then\n  perform commerce_internal.validate_bulk_checkout(p_data);\n end if;\n'||guard_anchor);
 source:=replace(source,shipping_anchor,'ship<>(case when p_data->''request''->''bulk_order''=''true''::jsonb then 0 when p_data->>''checkout_version''=''checkout-2026-11-v4'' then commerce_internal.delivery_total');
 if source=original then raise exception 'Bulk checkout migration did not modify checkout'; end if;
 execute source;
end $migration$;

commit;
