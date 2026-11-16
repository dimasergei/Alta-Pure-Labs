begin;

-- Manual reconciliation never fabricates a processor settlement. Reuse the
-- existing receipt uniqueness, audit events, entitlement and fulfillment triggers.
create function public.commerce_admin_record_bank_payment(p_invoice uuid,p_data jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare
 r public.commerce_invoices%rowtype;
 m public.commerce_payment_methods%rowtype;
 receipt public.commerce_receipts%rowtype;
 ref text:=trim(coalesce(p_data->>'external_reference',''));
begin
 if jsonb_typeof(p_data) is distinct from 'object' or p_data->>'confirm_funds_received' is distinct from 'true'
  or p_data->>'receipt_id' is null or p_data->>'method_id' is null
  or length(ref) not between 8 and 150 or ref !~ '^[A-Za-z0-9:_./ -]+$'
  or coalesce((p_data->>'expected_version')::integer,0)<1 then
  raise exception 'Received funds, bank reference and current method/version are required' using errcode='22023';
 end if;
 -- Same lock ordering as the supplier worker and fulfillment actions.
 perform 1 from public.commerce_supplier_jobs where invoice_id=p_invoice for update;
 select * into r from public.commerce_invoices where id=p_invoice for update;
 if r.id is null then raise exception 'Order not found' using errcode='P0002'; end if;
 select * into m from public.commerce_payment_methods where id=r.method_id for share;
 if m.id is null or r.method_id is distinct from (p_data->>'method_id')::uuid
  or m.kind not in ('bank_transfer','interac') or m.native_provider is not null
  or r.payment_snapshot->>'kind' is distinct from m.kind or m.currency is distinct from r.currency
  or coalesce(r.total_cents,0)<=0 then
  raise exception 'Manual bank reconciliation does not apply to this payment method' using errcode='P0001';
 end if;
 select * into receipt from public.commerce_receipts where id=(p_data->>'receipt_id')::uuid;
 if receipt.id is null and (r.status<>'accepted' or r.version is distinct from (p_data->>'expected_version')::integer) then
  raise exception 'Order changed; reload before recording funds' using errcode='40001';
 end if;
 return public.commerce_admin_command('record_payment',jsonb_build_object(
  'id',r.id,'version',(p_data->>'expected_version')::integer,'receipt_id',p_data->>'receipt_id',
  'external_reference',ref,'amount_cents',r.total_cents,'currency',r.currency,'funds_confirmed',true
 ),'admin:verified-bank-payment');
end $$;

-- Complete-order changes must update allocations and the customer invoice in one
-- transaction. A manual action can never invent a Lotus dispatch or bypass a
-- submitted/uncertain remote order. Existing line-level partial fulfillment stays
-- available; delivery preserves each parcel's tracking information.
create function public.commerce_admin_fulfill_order(p_invoice uuid,p_data jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare
 r public.commerce_invoices%rowtype;
 j public.commerce_supplier_jobs%rowtype;
 a text:=p_data->>'action';
 next_status text:=p_data->>'status';
 audit_note text:=trim(coalesce(p_data->>'note',''));
 carrier text:=trim(coalesce(p_data->>'tracking_carrier',''));
 tracking text:=trim(coalesce(p_data->>'tracking_number',''));
 result jsonb;
begin
 if jsonb_typeof(p_data) is distinct from 'object' or a is null or a not in ('update_order','update_tracking')
  or length(audit_note) not between 8 and 1000 then raise exception 'Order action and audit note required' using errcode='22023'; end if;
 select * into j from public.commerce_supplier_jobs where invoice_id=p_invoice for update;
 if j.lease_until>now() then raise exception 'Supplier sync in progress; refresh shortly' using errcode='40001'; end if;
 select * into r from public.commerce_invoices where id=p_invoice for update;
 if r.id is null or r.kind<>'goods' or r.status not in ('paid','processing','shipped','delivered') then
  raise exception 'Paid physical order required' using errcode='P0001';
 end if;
 if r.version is distinct from (p_data->>'version')::integer then raise exception 'Order changed' using errcode='40001'; end if;
 perform commerce_internal.fulfillment_seed(p_invoice);
 perform 1 from public.commerce_fulfillment_items where invoice_id=p_invoice order by variant_key for update;
 if not found then raise exception 'Fulfillment allocations are missing; reconcile this order first' using errcode='P0001'; end if;
 if a='update_tracking' or (a='update_order' and next_status='shipped') then
  if length(carrier) not between 2 and 100 or length(tracking) not between 4 and 160
   or carrier ~ '[[:cntrl:]]' or tracking ~ '[[:cntrl:]]' then raise exception 'Carrier and tracking required' using errcode='22023'; end if;
  if exists(select 1 from public.commerce_fulfillment_items where invoice_id=p_invoice and (route<>'manual' or length(trim(supplier_name))<2)) then
   raise exception 'Manual supplier assignment required; Lotus dispatch is synchronized from the supplier' using errcode='P0001';
  end if;
  if (j.payload is not null or j.supplier_id is not null) and not (j.status='cancelled' and j.provider_status='cancelled') then
   raise exception 'Confirm Lotus cancellation before manual dispatch or tracking changes' using errcode='P0001';
  end if;
 end if;
 if a='update_tracking' then
  if r.status not in ('shipped','delivered') or exists(select 1 from public.commerce_fulfillment_items where invoice_id=p_invoice and status not in ('shipped','delivered')) then
   raise exception 'Tracking corrections require a dispatched order' using errcode='P0001';
  end if;
  -- Do not silently merge different parcels into one tracking number.
  if (select count(distinct (tracking_carrier,tracking_number)) from public.commerce_fulfillment_items where invoice_id=p_invoice)>1 then
   raise exception 'This order has multiple parcels; correct each shipment separately' using errcode='P0001';
  end if;
  update public.commerce_fulfillment_items set tracking_carrier=carrier,tracking_number=tracking,note=audit_note,
   version=version+1,updated_at=now() where invoice_id=p_invoice;
  update public.commerce_invoices set tracking_carrier=carrier,tracking_number=tracking,fulfillment_note=audit_note,
   version=version+1,updated_at=now() where id=p_invoice;
  insert into public.commerce_events(invoice_id,action,actor,details) values(p_invoice,'tracking_corrected','admin:unified-orders',
   jsonb_build_object('note',audit_note,'from_carrier',r.tracking_carrier,'from_tracking',r.tracking_number,'tracking_carrier',carrier,'tracking_number',tracking));
 else
  if next_status='processing' then
   if r.status<>'paid' then raise exception 'Only paid orders can start processing' using errcode='P0001'; end if;
  elsif next_status='shipped' then
   if r.status not in ('paid','processing') or exists(select 1 from public.commerce_fulfillment_items where invoice_id=p_invoice and status not in ('pending','ordered')) then
    raise exception 'Use individual shipments for a partly dispatched order' using errcode='P0001';
   end if;
   update public.commerce_fulfillment_items set status='shipped',tracking_carrier=carrier,tracking_number=tracking,note=audit_note,
    version=version+1,updated_at=now() where invoice_id=p_invoice;
   update public.commerce_supplier_jobs set status='cancelled',provider_status='cancelled',last_error=null,updated_at=now()
    where invoice_id=p_invoice and payload is null and supplier_id is null;
  elsif next_status='delivered' then
   if r.status<>'shipped' or exists(select 1 from public.commerce_fulfillment_items where invoice_id=p_invoice and
    (status not in ('shipped','delivered') or length(tracking_carrier)<2 or length(tracking_number)<4)) then
    raise exception 'Confirm dispatch and tracking before delivery' using errcode='P0001';
   end if;
   update public.commerce_fulfillment_items set status='delivered',note=audit_note,version=version+1,updated_at=now()
    where invoice_id=p_invoice and status='shipped';
  else raise exception 'Invalid order transition' using errcode='22023'; end if;
  -- The original command preserves all established order events and their
  -- customer notification/rewards/stock lifecycle triggers.
  result:=public.commerce_admin_command('status',jsonb_build_object('id',r.id,'version',r.version,'status',next_status,'note',audit_note,
   'tracking_carrier',case when next_status='shipped' then carrier else null end,
   'tracking_number',case when next_status='shipped' then tracking else null end),'admin:unified-orders');
  insert into public.commerce_events(invoice_id,action,actor,details) values(p_invoice,'fulfillment_order_updated','admin:unified-orders',
   jsonb_build_object('from',r.status,'to',next_status,'note',audit_note));
 end if;
 select * into r from public.commerce_invoices where id=p_invoice;
 return jsonb_build_object('id',r.id,'status',r.status,'version',r.version,'saved',true);
end $$;

revoke all on function public.commerce_admin_record_bank_payment(uuid,jsonb),public.commerce_admin_fulfill_order(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.commerce_admin_record_bank_payment(uuid,jsonb),public.commerce_admin_fulfill_order(uuid,jsonb) to service_role;
commit;
