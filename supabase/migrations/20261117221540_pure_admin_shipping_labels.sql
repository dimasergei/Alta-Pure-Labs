-- Private, durable label attempts. The browser never receives the Shippo key.
-- A claim is committed before the provider purchase, and uncertain purchases
-- retain their guard until a matching provider transaction is reconciled.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create table public.admin_shipping_labels (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('commerce','store')),
  order_id uuid not null,
  status text not null check (status in ('quoted','purchasing','created','failed','review','refunded')),
  test_mode boolean not null,
  order_snapshot jsonb not null,
  shipment_id text not null,
  transaction_id text unique,
  provider_status text check (provider_status in ('WAITING','QUEUED','SUCCESS','ERROR','REFUNDPENDING','REFUNDREJECTED','REFUNDED','UNKNOWN')),
  sender jsonb not null,
  recipient jsonb not null,
  parcel jsonb not null,
  customs jsonb,
  rate_options jsonb not null,
  warnings jsonb not null default '[]'::jsonb,
  selected_rate jsonb,
  label_url text,
  customs_url text,
  tracking_number text,
  tracking_url text,
  message text,
  expires_at timestamptz not null,
  purchased_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(rate_options) = 'array'),
  check (status = 'quoted' or selected_rate is not null)
);
create index admin_shipping_labels_order_idx on public.admin_shipping_labels(source,order_id,created_at desc);
create unique index admin_shipping_labels_one_active_idx on public.admin_shipping_labels(source,order_id,test_mode)
  where status in ('purchasing','created','review');
alter table public.admin_shipping_labels enable row level security;
revoke all on public.admin_shipping_labels from public,anon,authenticated;
grant select,insert,update on public.admin_shipping_labels to service_role;

create function public.pure_shipping_label_claim(p_id uuid,p_rate text,p_amount integer,p_currency text)
returns jsonb language plpgsql security definer set search_path = pg_catalog,pg_temp as $$
declare
  l public.admin_shipping_labels; o public.commerce_invoices; s public.store_orders;
  current_snapshot jsonb; selected jsonb;
begin
  select * into l from public.admin_shipping_labels where id=p_id;
  if not found then raise exception 'Shipping quote not found' using errcode='22023'; end if;
  -- Keep the supplier job -> invoice -> allocation -> label order used by
  -- existing admin and fulfillment actions to avoid lock inversions.
  if l.source='commerce' then
    perform 1 from public.commerce_supplier_jobs where invoice_id=l.order_id for update;
    select * into o from public.commerce_invoices where id=l.order_id for update;
    if not found then raise exception 'Order not found' using errcode='22023'; end if;
    perform 1 from public.commerce_fulfillment_items where invoice_id=l.order_id for update;
  else
    select * into s from public.store_orders where id=l.order_id for update;
    if not found then raise exception 'Order not found' using errcode='22023'; end if;
  end if;
  select * into l from public.admin_shipping_labels where id=p_id for update;
  if l.status<>'quoted' then
    return jsonb_build_object('claimed',false,'label',to_jsonb(l));
  end if;
  if l.expires_at<=now() then raise exception 'Shipping quote expired' using errcode='22023'; end if;
  select x into selected from jsonb_array_elements(l.rate_options) x
    where x->>'id'=p_rate and (x->>'amount_cents')::integer=p_amount and x->>'currency'=p_currency;
  if selected is null then raise exception 'Shipping rate changed' using errcode='22023'; end if;
  if l.source='commerce' then
    if o.kind<>'goods' or o.status not in ('paid','processing') or coalesce(o.tracking_number,'')<>''
      or nullif(to_jsonb(o)->>'cancellation_status','') is not null then
      raise exception 'Order is not ready to ship' using errcode='22023';
    end if;
    if exists(select 1 from public.commerce_supplier_jobs where invoice_id=o.id and
      (supplier_id is not null or payload is not null or status in ('working','submitted','shipped') or lease_until>now()))
      or exists(select 1 from public.commerce_fulfillment_items where invoice_id=o.id and (route<>'manual' or status in ('ordered','shipped','delivered'))) then
      raise exception 'Existing supplier shipment must be reconciled' using errcode='22023';
    end if;
    current_snapshot:=jsonb_build_object('version',o.version,'status',o.status,'address',o.request_data->'address','items',o.request_data->'items');
  else
    if s.payment_status<>'paid' or s.fulfillment_status not in ('unfulfilled','processing','awaiting_supplier') or coalesce(s.tracking_number,'')<>'' then
      raise exception 'Order is not ready to ship' using errcode='22023';
    end if;
    current_snapshot:=jsonb_build_object('payment_status',s.payment_status,'fulfillment_status',s.fulfillment_status,'shipping_address',s.shipping_address,'shipping_name',s.shipping_name,'tracking_number',s.tracking_number);
  end if;
  if current_snapshot is distinct from l.order_snapshot then raise exception 'Order changed after quotation' using errcode='22023'; end if;
  if exists(select 1 from public.admin_shipping_labels where source=l.source and order_id=l.order_id and test_mode=l.test_mode and status in ('purchasing','created','review') and id<>l.id) then
    raise exception 'Another shipping label already exists' using errcode='22023';
  end if;
  update public.admin_shipping_labels set status='purchasing',selected_rate=selected,purchased_at=now(),updated_at=now(),
    message='Label purchase started. Check status before trying again.' where id=l.id returning * into l;
  return jsonb_build_object('claimed',true,'label',to_jsonb(l));
end $$;
revoke all on function public.pure_shipping_label_claim(uuid,text,integer,text) from public,anon,authenticated;
grant execute on function public.pure_shipping_label_claim(uuid,text,integer,text) to service_role;

-- Bind the provider identity once, and serialize out-of-order provider results.
-- Refund outcomes advance the same label lifecycle; they never buy postage.
create function public.pure_shipping_label_record(p_id uuid,p_transaction text,p_rate text,p_test_mode boolean,p_provider_status text,p_result jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare l public.admin_shipping_labels; next_status text; artifact text;
begin
  if p_transaction is null or p_transaction !~ '^[a-f0-9]{32}$' or p_rate is null or p_rate !~ '^[a-f0-9]{32}$'
    or p_test_mode is null or p_provider_status is null or p_provider_status not in ('WAITING','QUEUED','SUCCESS','ERROR','REFUNDPENDING','REFUNDREJECTED','REFUNDED','UNKNOWN')
    or jsonb_typeof(p_result) is distinct from 'object' or octet_length(p_result::text)>40000
    or length(coalesce(p_result->>'tracking_number',''))>180 or length(coalesce(p_result->>'message',''))>1000
  then raise exception 'Invalid shipping transaction result' using errcode='22023'; end if;
  foreach artifact in array array['label_url','tracking_url','customs_url'] loop
    if nullif(p_result->>artifact,'') is not null and (p_result->>artifact !~ '^https://' or length(p_result->>artifact)>8000)
    then raise exception 'Invalid shipping artifact URL' using errcode='22023'; end if;
  end loop;
  select * into l from public.admin_shipping_labels where id=p_id for update;
  if not found or l.status='quoted' or l.test_mode is distinct from p_test_mode or lower(l.selected_rate->>'id') is distinct from p_rate
    or (l.transaction_id is not null and l.transaction_id<>p_transaction)
  then raise exception 'The provider transaction does not match this shipping label' using errcode='22023'; end if;

  -- A terminal refund cannot be undone. Refund-rejected is newer than refund-
  -- pending; neither may be displaced by an old SUCCESS/WAITING response.
  if l.status='refunded'
    or (l.provider_status='REFUNDREJECTED' and p_provider_status not in ('REFUNDREJECTED','REFUNDED'))
    or (l.provider_status='REFUNDPENDING' and p_provider_status not in ('REFUNDPENDING','REFUNDREJECTED','REFUNDED'))
    or (l.status='created' and p_provider_status in ('WAITING','QUEUED','ERROR','UNKNOWN'))
    or (l.status='failed' and p_provider_status in ('WAITING','QUEUED','ERROR','UNKNOWN'))
  then return to_jsonb(l); end if;
  next_status:=case
    when p_provider_status='REFUNDED' then 'refunded'
    when p_provider_status in ('SUCCESS','REFUNDREJECTED') then case when coalesce(nullif(p_result->>'label_url',''),l.label_url) is not null then 'created' else 'review' end
    when p_provider_status='ERROR' then 'failed'
    when p_provider_status in ('REFUNDPENDING','UNKNOWN') or l.status='review' then 'review'
    else 'purchasing' end;
  update public.admin_shipping_labels set status=next_status,transaction_id=p_transaction,provider_status=p_provider_status,
    label_url=coalesce(nullif(p_result->>'label_url',''),label_url),
    tracking_number=coalesce(nullif(p_result->>'tracking_number',''),tracking_number),
    tracking_url=coalesce(nullif(p_result->>'tracking_url',''),tracking_url),
    customs_url=coalesce(nullif(p_result->>'customs_url',''),customs_url),
    message=case when l.status='created' and next_status='created' and p_provider_status='SUCCESS' and nullif(p_result->>'label_url','') is null then message else coalesce(nullif(p_result->>'message',''),message) end,
    updated_at=now() where id=l.id returning * into l;
  return to_jsonb(l);
end $$;
revoke all on function public.pure_shipping_label_record(uuid,text,text,boolean,text,jsonb) from public,anon,authenticated;
grant execute on function public.pure_shipping_label_record(uuid,text,text,boolean,text,jsonb) to service_role;

create function public.pure_shipping_transaction_identity_guard()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
  if old.transaction_id is not null and new.transaction_id is distinct from old.transaction_id then
    raise exception 'A shipping transaction identity cannot be replaced or cleared' using errcode='22023';
  end if;
  return new;
end $$;
revoke all on function public.pure_shipping_transaction_identity_guard() from public,anon,authenticated;
grant execute on function public.pure_shipping_transaction_identity_guard() to service_role;
create trigger pure_shipping_transaction_identity_guard before update of transaction_id on public.admin_shipping_labels
  for each row execute function public.pure_shipping_transaction_identity_guard();

-- Do not let another admin tab change a destination, issue a refund, or start
-- fulfillment during an unresolved postage purchase. Normal admin editing
-- resumes after the provider confirms success or failure.
create function public.pure_shipping_purchase_order_guard()
returns trigger language plpgsql security invoker set search_path = pg_catalog,public as $$
declare src text; changed boolean;
begin
  if tg_table_name='commerce_invoices' then
    src:='commerce';
    changed:=new.status is distinct from old.status or new.request_data is distinct from old.request_data
      or new.tracking_number is distinct from old.tracking_number;
  else
    src:='store';
    changed:=new.payment_status is distinct from old.payment_status or new.fulfillment_status is distinct from old.fulfillment_status
      or new.shipping_address is distinct from old.shipping_address or new.shipping_name is distinct from old.shipping_name
      or new.tracking_number is distinct from old.tracking_number;
  end if;
  if changed and exists(select 1 from public.admin_shipping_labels where source=src and order_id=old.id and not test_mode and status in ('purchasing','review')) then
    raise exception 'Reconcile the pending shipping label purchase before changing this order' using errcode='22023';
  end if;
  return new;
end $$;
revoke all on function public.pure_shipping_purchase_order_guard() from public,anon,authenticated;
grant execute on function public.pure_shipping_purchase_order_guard() to service_role;
create trigger pure_shipping_purchase_guard before update on public.commerce_invoices
  for each row execute function public.pure_shipping_purchase_order_guard();
create trigger pure_shipping_purchase_guard before update on public.store_orders
  for each row execute function public.pure_shipping_purchase_order_guard();

-- Some fulfillment RPCs update allocations/jobs without updating the invoice.
-- They already acquire job -> invoice -> allocation locks; do not acquire an
-- upward parent lock from this row trigger or introduce a label lock inversion.
create function public.pure_shipping_purchase_fulfillment_guard()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
declare prior_invoice uuid; next_invoice uuid;
begin
  if tg_op<>'INSERT' then prior_invoice:=old.invoice_id; end if;
  if tg_op<>'DELETE' then next_invoice:=new.invoice_id; end if;
  if exists(select 1 from public.admin_shipping_labels where source='commerce' and order_id in (prior_invoice,next_invoice)
    and not test_mode and status in ('purchasing','review')) then
    raise exception 'Reconcile the pending shipping label purchase before changing fulfillment' using errcode='22023';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public.pure_shipping_purchase_fulfillment_guard() from public,anon,authenticated;
grant execute on function public.pure_shipping_purchase_fulfillment_guard() to service_role;
create trigger pure_shipping_purchase_fulfillment_guard before insert or update or delete on public.commerce_fulfillment_items
  for each row execute function public.pure_shipping_purchase_fulfillment_guard();
create trigger pure_shipping_purchase_fulfillment_guard before insert or update or delete on public.commerce_supplier_jobs
  for each row execute function public.pure_shipping_purchase_fulfillment_guard();
commit;
