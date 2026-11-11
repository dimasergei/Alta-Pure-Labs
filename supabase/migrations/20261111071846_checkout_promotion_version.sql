-- Add the promotion-aware checkout version while preserving v1 for rollback.
-- No rows, balances, gateway settings, shipping charges or historical snapshots change.
begin;
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
 or (p_data->>'checkout_version' is null or p_data->>'checkout_version' not in ('checkout-2026-11-v1','checkout-2026-11-v2')) or p_data->>'consent' is distinct from 'true'
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
  or sub is distinct from (case p_data->>'plan' when 'vip' then 4900 when 'elite' then 9900 else null end)
  or exists(select 1 from public.commerce_invoices where customer_id=uid and kind='membership' and status in ('requested','issued','accepted'))
  then raise exception 'Invalid or existing membership purchase' using errcode='P0001'; end if;
 else
  if p_data->'request'->'address'->>'country' is distinct from 'US' or ship<>2500
  or earned<>greatest(0,(sub-disc-points-credit)/100) then raise exception 'Invalid goods checkout' using errcode='22023'; end if;
 end if;
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
commit;
