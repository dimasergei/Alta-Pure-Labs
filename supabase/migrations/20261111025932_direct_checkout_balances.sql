-- Direct checkout reuses the existing payment, receipt, membership and fulfillment lifecycle.
-- Historical records are untouched; no customer receives a fabricated opening balance.
alter table public.commerce_invoices
 add column checkout_version text,
 add column points_redeemed integer not null default 0 check(points_redeemed>=0),
 add column credit_redeemed_cents integer not null default 0 check(credit_redeemed_cents>=0),
 add column earned_points integer not null default 0 check(earned_points>=0);
do $$ declare c text; begin
 select conname into strict c from pg_constraint where conrelid='public.commerce_invoices'::regclass and contype='c'
 and pg_get_constraintdef(oid) like '%subtotal_cents > 0%';
 execute format('alter table public.commerce_invoices drop constraint %I',c);
end $$;
alter table public.commerce_invoices add constraint commerce_checkout_total_check check(total_cents is null or
 (subtotal_cents>0 and discount_cents>=0 and discount_cents<=subtotal_cents and shipping_cents>=0 and tax_cents>=0
 and total_cents=subtotal_cents-discount_cents+shipping_cents+tax_cents-points_redeemed-credit_redeemed_cents
 and total_cents between 0 and 100000000 and (total_cents>0 or checkout_version is not null)));
create table public.commerce_balance_accounts (
 customer_id uuid primary key, points integer not null default 0,
 credit_cents integer not null default 0 check(credit_cents>=0)
);
create table public.commerce_balance_events (
 id uuid primary key default gen_random_uuid(), customer_id uuid not null references public.commerce_balance_accounts(customer_id),
 invoice_id uuid references public.commerce_invoices(id), asset text not null check(asset in ('points','credit')),
 delta integer not null check(delta<>0), reason text not null, reference text not null unique,
 actor text not null, created_at timestamptz not null default now()
);
create index commerce_balance_events_customer_idx on public.commerce_balance_events(customer_id,created_at desc);
alter table public.commerce_balance_accounts enable row level security;
alter table public.commerce_balance_events enable row level security;
revoke all on public.commerce_balance_accounts,public.commerce_balance_events from public,anon,authenticated,service_role;
grant select on public.commerce_balance_accounts,public.commerce_balance_events to service_role;

create function commerce_internal.balance_event(p_customer uuid,p_invoice uuid,p_asset text,p_delta integer,p_reason text,p_reference text,p_actor text)
returns void language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 if p_delta=0 then return; end if;
 insert into public.commerce_balance_events(customer_id,invoice_id,asset,delta,reason,reference,actor)
 values(p_customer,p_invoice,p_asset,p_delta,p_reason,p_reference,p_actor);
 update public.commerce_balance_accounts set points=points+case when p_asset='points' then p_delta else 0 end,
 credit_cents=credit_cents+case when p_asset='credit' then p_delta else 0 end where customer_id=p_customer;
end $$;
revoke all on function commerce_internal.balance_event(uuid,uuid,text,integer,text,text,text) from public,anon,authenticated,service_role;

create function commerce_internal.checkout_balance_transition()
returns trigger language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 if new.checkout_version is null or new.status=old.status then return new; end if;
 -- Lock the financial account for all debits, restores and earnings.
 perform 1 from public.commerce_balance_accounts where customer_id=new.customer_id for update;
 if new.status='void' and exists(select 1 from public.commerce_gateway_attempts where invoice_id=new.id and state<>'declined') then raise exception 'Reconcile payment before voiding' using errcode='P0001'; end if;
 if new.status='paid' and old.status='accepted' then
  perform commerce_internal.balance_event(new.customer_id,new.id,'points',new.earned_points,'Paid merchandise',new.id||':earn','verified-payment');
 elsif new.status in ('void','refunded') then
  if new.status='refunded' then
   -- A reversal can create a points debt if the earned points were already spent.
   -- Future earnings repay that debt; no further spending is allowed meanwhile.
   perform commerce_internal.balance_event(new.customer_id,new.id,'points',-new.earned_points,'Refunded merchandise',new.id||':reverse-earn','verified-refund');
  end if;
  perform commerce_internal.balance_event(new.customer_id,new.id,'points',new.points_redeemed,'Restored redemption',new.id||':restore-points','order-transition');
  perform commerce_internal.balance_event(new.customer_id,new.id,'credit',new.credit_redeemed_cents,'Restored credit',new.id||':restore-credit','order-transition');
 end if;
 return new;
end $$;
revoke all on function commerce_internal.checkout_balance_transition() from public,anon,authenticated,service_role;
create trigger commerce_checkout_balances after update of status on public.commerce_invoices
 for each row execute function commerce_internal.checkout_balance_transition();

create function public.commerce_place_checkout(p_data jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare r public.commerce_invoices%rowtype; m public.commerce_payment_methods%rowtype; b public.commerce_balance_accounts%rowtype;
 uid uuid:=(p_data->>'customer_id')::uuid; oid uuid:=(p_data->>'id')::uuid; member_id uuid; member_plan text; expiry timestamptz;
 points integer:=(p_data->>'points_redeemed')::integer; credit integer:=(p_data->>'credit_redeemed_cents')::integer;
 sub integer:=(p_data->>'subtotal_cents')::integer; disc integer:=(p_data->>'discount_cents')::integer;
 ship integer:=(p_data->>'shipping_cents')::integer; tax integer:=(p_data->>'tax_cents')::integer; total integer:=(p_data->>'total_cents')::integer;
 earned integer:=(p_data->>'earned_points')::integer; n integer;
begin
 if uid is null or oid is null or jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>50000
 or p_data->>'checkout_version' is distinct from 'checkout-2026-11-v1' or p_data->>'consent' is distinct from 'true'
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

create function public.commerce_cancel_checkout(p_id uuid,p_customer uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare r public.commerce_invoices%rowtype;
begin
 select * into r from public.commerce_invoices where id=p_id and customer_id=p_customer and checkout_version is not null for update;
 if not found then raise exception 'Order not found' using errcode='P0002'; end if;
 if r.status='void' then return jsonb_build_object('id',p_id,'status','void'); end if;
 if r.status<>'accepted' or exists(select 1 from public.commerce_gateway_attempts where invoice_id=p_id and state<>'declined') then
 raise exception 'Payment in progress; reconcile before cancelling' using errcode='P0001'; end if;
 update public.commerce_invoices set status='void',version=version+1,updated_at=now() where id=p_id;
 insert into public.commerce_events(invoice_id,action,actor,details) values(p_id,'status_changed','customer:'||p_customer,jsonb_build_object('from',r.status,'to','void'));
 return jsonb_build_object('id',p_id,'status','void');
end $$;

create function public.commerce_issue_credit(p_id uuid,p_customer uuid,p_amount integer,p_reason text,p_actor text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare e public.commerce_balance_events%rowtype;
begin
 if p_id is null or p_customer is null or p_amount is null or p_amount not between 1 and 100000
 or length(coalesce(p_reason,'')) not between 12 and 500 or length(coalesce(p_actor,'')) not between 8 and 180 then raise exception 'Invalid credit' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_customer::text,0));
 insert into public.commerce_balance_accounts(customer_id) values(p_customer) on conflict do nothing;
 perform 1 from public.commerce_balance_accounts where customer_id=p_customer for update;
 select * into e from public.commerce_balance_events where reference='grant:'||p_id::text;
 if found then
  if e.customer_id<>p_customer or e.delta<>p_amount or e.reason<>p_reason then raise exception 'Credit reference conflict' using errcode='23505'; end if;
  return jsonb_build_object('id',p_id,'replayed',true);
 end if;
 perform commerce_internal.balance_event(p_customer,null,'credit',p_amount,p_reason,'grant:'||p_id::text,p_actor);
 return jsonb_build_object('id',p_id,'issued',true);
end $$;
revoke all on function public.commerce_place_checkout(jsonb),public.commerce_cancel_checkout(uuid,uuid),public.commerce_issue_credit(uuid,uuid,integer,text,text) from public,anon,authenticated;
grant execute on function public.commerce_place_checkout(jsonb),public.commerce_cancel_checkout(uuid,uuid),public.commerce_issue_credit(uuid,uuid,integer,text,text) to service_role;

create function public.commerce_refund_balance_order(p_id uuid,p_version integer,p_actor text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare r public.commerce_invoices%rowtype;
begin
 if length(coalesce(p_actor,''))<8 then raise exception 'Actor required' using errcode='22023'; end if;
 select * into r from public.commerce_invoices where id=p_id for update;
 if not found then raise exception 'Order not found' using errcode='P0002'; end if;
 if r.checkout_version is null or r.total_cents<>0 then raise exception 'External refund required' using errcode='P0001'; end if;
 if r.status='refunded' then return jsonb_build_object('id',p_id,'status','refunded','replayed',true); end if;
 if r.version is distinct from p_version or r.status not in ('paid','processing','shipped','delivered') then raise exception 'Order changed' using errcode='40001'; end if;
 update public.commerce_invoices set status='refunded',version=version+1,updated_at=now() where id=p_id;
 insert into public.commerce_events(invoice_id,action,actor,details) values(p_id,'full_refund_recorded',p_actor,jsonb_build_object('amount_cents',0,'balance_only',true));
 return jsonb_build_object('id',p_id,'status','refunded');
end $$;
revoke all on function public.commerce_refund_balance_order(uuid,integer,text) from public,anon,authenticated;
grant execute on function public.commerce_refund_balance_order(uuid,integer,text) to service_role;

create or replace function commerce_internal.queue_invoice_notification()
returns trigger language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare r public.commerce_invoices%rowtype; s jsonb; a text;
begin
 if new.invoice_id is null or new.action not in ('checkout_placed','requested','issued','accepted','payment_recorded','full_refund_recorded','status_changed') then return new; end if;
 select * into r from public.commerce_invoices where id=new.invoice_id;
 s:=jsonb_build_object('id',r.id,'customer_email',r.customer_email,'customer_name',r.customer_name,
  'kind',r.kind,'plan',r.plan,'status',r.status,'currency',r.currency,'total_cents',r.total_cents,
  'expires_at',r.expires_at,'tracking_carrier',r.tracking_carrier,'tracking_number',r.tracking_number,
  'event_at',new.created_at,'checkout_version',r.checkout_version);
 foreach a in array array['customer','admin'] loop
  -- Staff need the request/acceptance alerts; customers get every meaningful state.
  if (a='admin' and new.action in ('checkout_placed','requested','accepted','payment_recorded')) or (a='customer' and new.action<>'accepted') then
   insert into public.commerce_notifications(event_id,invoice_id,audience,event_action,snapshot)
   values(new.id,r.id,a,new.action,s) on conflict(event_id,audience) do nothing;
  end if;
 end loop;
 return new;
end $$;
