-- Manual invoicing for owner-managed payment reconciliation and fulfillment.
-- No processor account, receiver, payment, membership or shipment is pre-created.
create table public.commerce_payment_methods (
 id uuid primary key, kind text not null check(kind in ('bank_transfer','interac','hosted_link')),
 label text not null check(length(label) between 3 and 80), currency text not null check(currency in ('USD','CAD')),
 payee text not null check(length(payee) between 2 and 180), instructions text not null check(length(instructions) between 12 and 3000),
 allowed_host text not null default '', acceptance_reference text not null check(length(acceptance_reference) between 8 and 400),
 active boolean not null default false, version integer not null default 1,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.commerce_invoices (
 id uuid primary key, customer_id uuid not null, customer_email text not null,
 customer_name text not null, kind text not null check(kind in ('goods','membership')),
 plan text check(plan is null or plan in ('vip','elite')),
 request_digest text not null check(request_digest ~ '^[a-f0-9]{64}$'), request_data jsonb not null,
 terms_version text not null default 'launch-2026-11-v1',
 status text not null default 'requested' check(status in ('requested','issued','accepted','paid','processing','shipped','delivered','void','refunded')),
 version integer not null default 1, currency text check(currency in ('USD','CAD')),
 pricing jsonb, subtotal_cents integer, discount_cents integer, shipping_cents integer, tax_cents integer, total_cents integer,
 method_id uuid references public.commerce_payment_methods(id), payment_snapshot jsonb,
 expires_at timestamptz, accepted_at timestamptz, paid_at timestamptz,
 tracking_carrier text, tracking_number text, fulfillment_note text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(length(customer_email) between 3 and 254 and customer_email=lower(trim(customer_email))),
 check(length(customer_name) between 1 and 120),
 check(jsonb_typeof(request_data)='object' and octet_length(request_data::text)<=24000),
 check((kind='goods' and plan is null) or (kind='membership' and plan in ('vip','elite'))),
 check(total_cents is null or (subtotal_cents>0 and discount_cents>=0 and discount_cents<=subtotal_cents
  and shipping_cents>=0 and tax_cents>=0 and total_cents=subtotal_cents-discount_cents+shipping_cents+tax_cents and total_cents between 1 and 100000000))
);
create index commerce_invoice_customer_idx on public.commerce_invoices(customer_id,created_at desc);
create index commerce_invoice_status_idx on public.commerce_invoices(status,created_at desc);
create table public.commerce_receipts (
 id uuid primary key, invoice_id uuid not null references public.commerce_invoices(id),
 kind text not null check(kind in ('payment','refund')), method_id uuid not null references public.commerce_payment_methods(id),
 external_reference text not null check(length(external_reference) between 6 and 180),
 amount_cents integer not null check(amount_cents>0), currency text not null check(currency in ('USD','CAD')),
 actor text not null, created_at timestamptz not null default now(),
 unique(method_id,external_reference), unique(invoice_id,kind)
);
create table public.commerce_memberships (
 invoice_id uuid primary key references public.commerce_invoices(id), customer_id uuid not null,
 plan text not null check(plan in ('vip','elite')), starts_at timestamptz not null, expires_at timestamptz not null,
 revoked_at timestamptz, check(expires_at>starts_at)
);
create index commerce_membership_customer_idx on public.commerce_memberships(customer_id,expires_at desc);
create table public.commerce_events (
 id uuid primary key default gen_random_uuid(), invoice_id uuid references public.commerce_invoices(id), method_id uuid references public.commerce_payment_methods(id),
 action text not null, actor text not null, details jsonb not null default '{}', created_at timestamptz not null default now()
);
create index commerce_event_invoice_idx on public.commerce_events(invoice_id,created_at desc);
alter table public.commerce_payment_methods enable row level security;
alter table public.commerce_invoices enable row level security;
alter table public.commerce_receipts enable row level security;
alter table public.commerce_memberships enable row level security;
alter table public.commerce_events enable row level security;
revoke all on public.commerce_payment_methods,public.commerce_invoices,public.commerce_receipts,public.commerce_memberships,public.commerce_events from public,anon,authenticated,service_role;
grant select on public.commerce_payment_methods,public.commerce_invoices,public.commerce_receipts,public.commerce_memberships,public.commerce_events to service_role;

create function public.commerce_request_invoice(p_data jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare r public.commerce_invoices%rowtype; n integer; uid uuid; kind text;
begin
 if p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>30000 then raise exception 'Invalid invoice request' using errcode='22023'; end if;
 uid:=(p_data->>'customer_id')::uuid; kind:=p_data->>'kind';
 if uid is null or kind is null or kind not in ('goods','membership') or p_data->>'terms_version' is distinct from 'launch-2026-11-v1'
  or p_data->>'consent' is distinct from 'true' then raise exception 'Invoice consent required' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text,0));
 select count(*) into n from public.commerce_invoices where customer_id=uid and status in ('requested','issued','accepted');
 if n>=10 and not exists(select 1 from public.commerce_invoices where id=(p_data->>'id')::uuid) then raise exception 'Too many open invoices' using errcode='P0001'; end if;
 if kind='membership' and exists(select 1 from public.commerce_memberships where customer_id=uid and revoked_at is null and expires_at>now()) then
  raise exception 'A membership is already active; contact support for an upgrade' using errcode='P0001';
 end if;
 insert into public.commerce_invoices(id,customer_id,customer_email,customer_name,kind,plan,request_digest,request_data)
 values((p_data->>'id')::uuid,uid,lower(trim(p_data->>'customer_email')),p_data->>'customer_name',kind,p_data->>'plan',p_data->>'digest',p_data->'request') on conflict(id) do nothing;
 get diagnostics n=row_count;
 select * into r from public.commerce_invoices where id=(p_data->>'id')::uuid for update;
 if r.customer_id<>uid or r.request_digest<>p_data->>'digest' then raise exception 'Request ID conflict' using errcode='23505'; end if;
 if n=1 then insert into public.commerce_events(invoice_id,action,actor,details) values(r.id,'requested','customer:'||uid::text,jsonb_build_object('terms_version',r.terms_version)); end if;
 return jsonb_build_object('id',r.id,'status',r.status,'created',n=1);
end $$;

create function public.commerce_accept_invoice(p_id uuid,p_customer uuid,p_version integer,p_terms text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare r public.commerce_invoices%rowtype;
begin
 select * into r from public.commerce_invoices where id=p_id and customer_id=p_customer for update;
 if not found then raise exception 'Invoice not found' using errcode='P0002'; end if;
 if r.status='accepted' then return jsonb_build_object('id',r.id,'status',r.status); end if;
 if r.status<>'issued' or r.version<>p_version or r.expires_at<=now() or p_terms is distinct from r.terms_version
  or not exists(select 1 from public.commerce_payment_methods where id=r.method_id and active) then
  raise exception 'Invoice changed, expired, or payment method unavailable' using errcode='P0001'; end if;
 update public.commerce_invoices set status='accepted',accepted_at=now(),version=version+1,updated_at=now() where id=p_id;
 insert into public.commerce_events(invoice_id,action,actor,details) values(p_id,'accepted','customer:'||p_customer::text,jsonb_build_object('terms_version',r.terms_version,'total_cents',r.total_cents,'currency',r.currency));
 return jsonb_build_object('id',p_id,'status','accepted');
end $$;

create function public.commerce_admin_command(p_action text,p_data jsonb,p_actor text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare r public.commerce_invoices%rowtype; m public.commerce_payment_methods%rowtype;
 receipt public.commerce_receipts%rowtype; uid uuid; id uuid; v integer; next_status text;
 sub integer; disc integer; ship integer; tax integer; total integer; expires timestamptz;
begin
 if p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>30000
  or length(coalesce(p_actor,'')) not between 8 and 180 then raise exception 'Invalid operation' using errcode='22023'; end if;
 id:=(p_data->>'id')::uuid; v:=(p_data->>'version')::integer;
 if id is null or v is null then raise exception 'ID and version required' using errcode='22023'; end if;
 if p_action='save_method' then
  if p_data->>'kind' is null or p_data->>'kind' not in ('bank_transfer','interac','hosted_link')
   or p_data->>'currency' is null or p_data->>'currency' not in ('USD','CAD')
   or p_data->>'business_confirmed' is distinct from 'true' or p_data->>'catalog_accepted' is distinct from 'true'
   or (p_data->>'kind'='interac' and p_data->>'currency'<>'CAD') then raise exception 'Verified business payment details required' using errcode='22023'; end if;
  select * into m from public.commerce_payment_methods where commerce_payment_methods.id=id for update;
  if found then
   if m.version<>v then raise exception 'Method changed' using errcode='40001'; end if;
   if m.kind<>p_data->>'kind' or m.currency<>p_data->>'currency' then raise exception 'Create a new method for a different rail or currency' using errcode='P0001'; end if;
   update public.commerce_payment_methods set label=p_data->>'label',payee=p_data->>'payee',instructions=p_data->>'instructions',
    allowed_host=coalesce(p_data->>'allowed_host',''),acceptance_reference=p_data->>'acceptance_reference',active=(p_data->>'active')::boolean,
    version=version+1,updated_at=now() where commerce_payment_methods.id=id;
  else
   if v<>0 then raise exception 'Method not found' using errcode='P0002'; end if;
   insert into public.commerce_payment_methods(id,kind,label,currency,payee,instructions,allowed_host,acceptance_reference,active)
    values(id,p_data->>'kind',p_data->>'label',p_data->>'currency',p_data->>'payee',p_data->>'instructions',coalesce(p_data->>'allowed_host',''),p_data->>'acceptance_reference',(p_data->>'active')::boolean);
  end if;
  insert into public.commerce_events(method_id,action,actor,details) values(id,'method_saved',p_actor,jsonb_build_object('active',(p_data->>'active')::boolean,'kind',p_data->>'kind'));
  return jsonb_build_object('id',id,'saved',true);
 end if;
 select * into r from public.commerce_invoices where commerce_invoices.id=id for update;
 if not found then raise exception 'Invoice not found' using errcode='P0002'; end if;
 if p_action in ('record_payment','record_refund') then
  select * into receipt from public.commerce_receipts where commerce_receipts.id=(p_data->>'receipt_id')::uuid;
  if found then
   if receipt.invoice_id<>id or receipt.kind<>case when p_action='record_payment' then 'payment' else 'refund' end
    or receipt.external_reference<>p_data->>'external_reference' or receipt.amount_cents<>(p_data->>'amount_cents')::integer
    or receipt.currency<>p_data->>'currency' then raise exception 'Receipt replay conflict' using errcode='23505'; end if;
   return jsonb_build_object('id',id,'status',r.status,'replayed',true);
  end if;
 end if;
 if r.version<>v then raise exception 'Invoice changed; reload before saving' using errcode='40001'; end if;
 if p_action='issue' then
  if r.status<>'requested' or p_data->>'fulfillment_confirmed' is distinct from 'true' or length(trim(coalesce(p_data->>'review_note','')))<12 then
   raise exception 'Review and manual fulfillment confirmation required' using errcode='P0001'; end if;
  select * into m from public.commerce_payment_methods where commerce_payment_methods.id=(p_data->>'method_id')::uuid and active for share;
  if not found then raise exception 'An active verified payment method is required' using errcode='P0001'; end if;
  sub:=(p_data->>'subtotal_cents')::integer;disc:=(p_data->>'discount_cents')::integer;ship:=(p_data->>'shipping_cents')::integer;tax:=(p_data->>'tax_cents')::integer;total:=sub-disc+ship+tax;
  expires:=(p_data->>'expires_at')::timestamptz;
  if sub is null or disc is null or ship is null or tax is null or expires is null or sub<=0 or disc<0 or disc>sub or ship<0 or tax<0
   or total not between 1 and 100000000 or expires<=now() or expires>now()+interval '48 hours'
   or jsonb_typeof(p_data->'pricing') is distinct from 'object' then raise exception 'Invalid final invoice' using errcode='22023'; end if;
  if r.kind='membership' and (disc<>0 or ship<>0) then raise exception 'Membership fees cannot be discounted or charged shipping' using errcode='22023'; end if;
  if m.kind='hosted_link' and (coalesce(p_data->>'payment_url','') not like 'https://%' or length(m.allowed_host)<4) then raise exception 'Hosted invoice URL required' using errcode='22023'; end if;
  update public.commerce_invoices set status='issued',version=version+1,currency=m.currency,pricing=p_data->'pricing',subtotal_cents=sub,discount_cents=disc,shipping_cents=ship,tax_cents=tax,total_cents=total,
   method_id=m.id,payment_snapshot=jsonb_build_object('kind',m.kind,'label',m.label,'payee',m.payee,'instructions',m.instructions,'payment_url',p_data->>'payment_url','method_version',m.version),
   expires_at=expires,updated_at=now() where commerce_invoices.id=id;
  insert into public.commerce_events(invoice_id,action,actor,details) values(id,'issued',p_actor,jsonb_build_object('review_note',p_data->>'review_note','currency',m.currency,'total_cents',total));
  return jsonb_build_object('id',id,'status','issued');
 elsif p_action='record_payment' then
  if r.status<>'accepted' or p_data->>'funds_confirmed' is distinct from 'true' or p_data->>'currency' is distinct from r.currency
   or (p_data->>'amount_cents')::integer is distinct from r.total_cents then raise exception 'Confirm received funds matching the accepted invoice' using errcode='P0001'; end if;
  if r.kind='membership' then
   perform pg_advisory_xact_lock(hashtextextended(r.customer_id::text,0));
   if exists(select 1 from public.commerce_memberships where customer_id=r.customer_id and revoked_at is null and expires_at>now()) then raise exception 'Existing active pass; reconcile before granting another' using errcode='P0001'; end if;
  end if;
  insert into public.commerce_receipts(id,invoice_id,kind,method_id,external_reference,amount_cents,currency,actor)
   values((p_data->>'receipt_id')::uuid,id,'payment',r.method_id,p_data->>'external_reference',r.total_cents,r.currency,p_actor);
  update public.commerce_invoices set status='paid',paid_at=now(),version=version+1,updated_at=now() where commerce_invoices.id=id;
  if r.kind='membership' then insert into public.commerce_memberships(invoice_id,customer_id,plan,starts_at,expires_at) values(id,r.customer_id,r.plan,now(),now()+interval '365 days'); end if;
  insert into public.commerce_events(invoice_id,action,actor,details) values(id,'payment_recorded',p_actor,jsonb_build_object('amount_cents',r.total_cents,'currency',r.currency,'receipt_id',p_data->>'receipt_id'));
  return jsonb_build_object('id',id,'status','paid');
 elsif p_action='record_refund' then
  if r.status not in ('paid','processing','shipped','delivered') or p_data->>'funds_confirmed' is distinct from 'true'
   or p_data->>'currency' is distinct from r.currency or (p_data->>'amount_cents')::integer is distinct from r.total_cents then
   raise exception 'A completed full refund matching the invoice is required' using errcode='P0001'; end if;
  insert into public.commerce_receipts(id,invoice_id,kind,method_id,external_reference,amount_cents,currency,actor)
   values((p_data->>'receipt_id')::uuid,id,'refund',r.method_id,p_data->>'external_reference',r.total_cents,r.currency,p_actor);
  update public.commerce_invoices set status='refunded',version=version+1,updated_at=now() where commerce_invoices.id=id;
  update public.commerce_memberships set revoked_at=now() where invoice_id=id;
  insert into public.commerce_events(invoice_id,action,actor,details) values(id,'full_refund_recorded',p_actor,jsonb_build_object('receipt_id',p_data->>'receipt_id','amount_cents',r.total_cents));
  return jsonb_build_object('id',id,'status','refunded');
 elsif p_action='status' then
  next_status:=p_data->>'status';
  if next_status is null or length(trim(coalesce(p_data->>'note','')))<8 or not (
   (next_status='void' and r.status in ('requested','issued','accepted')) or
   (r.kind='goods' and ((r.status='paid' and next_status in ('processing','shipped')) or (r.status='processing' and next_status='shipped') or (r.status='shipped' and next_status='delivered')))
  ) then raise exception 'Invalid manual order transition' using errcode='P0001'; end if;
  if next_status='shipped' and (length(trim(coalesce(p_data->>'tracking_carrier','')))<2 or length(trim(coalesce(p_data->>'tracking_number','')))<4) then raise exception 'Carrier and tracking required' using errcode='22023'; end if;
  update public.commerce_invoices set status=next_status,version=version+1,fulfillment_note=p_data->>'note',
   tracking_carrier=coalesce(p_data->>'tracking_carrier',tracking_carrier),tracking_number=coalesce(p_data->>'tracking_number',tracking_number),updated_at=now() where commerce_invoices.id=id;
  insert into public.commerce_events(invoice_id,action,actor,details) values(id,'status_changed',p_actor,jsonb_build_object('from',r.status,'to',next_status,'note',p_data->>'note'));
  return jsonb_build_object('id',id,'status',next_status);
 end if;
 raise exception 'Unknown operation' using errcode='22023';
end $$;
revoke all on function public.commerce_request_invoice(jsonb),public.commerce_accept_invoice(uuid,uuid,integer,text),public.commerce_admin_command(text,jsonb,text) from public,anon,authenticated;
grant execute on function public.commerce_request_invoice(jsonb),public.commerce_accept_invoice(uuid,uuid,integer,text),public.commerce_admin_command(text,jsonb,text) to service_role;
