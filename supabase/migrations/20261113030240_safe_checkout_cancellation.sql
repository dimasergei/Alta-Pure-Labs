-- Safely void unpaid checkout orders with a Rampex payment link.
-- Do not delete provider links; late confirmed funds must enter manual review, never fulfillment.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create or replace function commerce_internal.prevent_uncertain_gateway_mutation()
returns trigger language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 if new.status is distinct from old.status
    and exists(select 1 from public.commerce_gateway_attempts where invoice_id=old.id and state in ('started','redirected','unknown','review')) then
   if old.status='accepted' and new.status='void'
      and current_setting('app.commerce_cancel_unpaid_verified',true)='yes'
      and not exists(select 1 from public.commerce_receipts where invoice_id=old.id and kind='payment')
      and not exists(select 1 from public.commerce_gateway_attempts where invoice_id=old.id
          and (state in ('paid','refunded','review','unknown','started')
           or (state='redirected' and provider<>'rampex')))
   then return new;end if;
   raise exception 'Reconcile the existing native payment attempt before changing this invoice' using errcode='P0001';
 end if;
 return new;
end $$;

create or replace function commerce_internal.checkout_balance_transition()
returns trigger language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 if new.checkout_version is null or new.status=old.status then return new; end if;
 perform 1 from public.commerce_balance_accounts where customer_id=new.customer_id for update;
 if new.status='void' and exists(select 1 from public.commerce_gateway_attempts where invoice_id=new.id and state<>'declined')
   and not (old.status='accepted'
      and current_setting('app.commerce_cancel_unpaid_verified',true)='yes'
      and not exists(select 1 from public.commerce_receipts where invoice_id=new.id and kind='payment')
      and not exists(select 1 from public.commerce_gateway_attempts where invoice_id=new.id
          and (state in ('paid','refunded','review','unknown','started')
           or (state='redirected' and provider<>'rampex'))))
 then raise exception 'Reconcile payment before voiding' using errcode='P0001'; end if;
 if new.status='paid' and old.status='accepted' then
   perform commerce_internal.balance_event(new.customer_id,new.id,'points',new.earned_points,'Paid merchandise',new.id||':earn','verified-payment');
 elsif new.status in ('void','refunded') then
   if new.status='refunded' then
     perform commerce_internal.balance_event(new.customer_id,new.id,'points',-new.earned_points,'Refunded merchandise',new.id||':reverse-earn','verified-refund');
   end if;
   perform commerce_internal.balance_event(new.customer_id,new.id,'points',new.points_redeemed,'Restored redemption',new.id||':restore-points','order-transition');
   perform commerce_internal.balance_event(new.customer_id,new.id,'credit',new.credit_redeemed_cents,'Restored credit',new.id||':restore-credit','order-transition');
 end if;
 return new;
end $$;

create or replace function public.commerce_cancel_checkout(p_id uuid,p_customer uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare r public.commerce_invoices%rowtype; pending_link boolean;
begin
 if p_id is null or p_customer is null then raise exception 'Missing order details' using errcode='22023';end if;
 select * into r from public.commerce_invoices where id=p_id and customer_id=p_customer
   and checkout_version is not null for update;
 if not found then raise exception 'Order not found' using errcode='P0002';end if;
 if r.status='void' then return jsonb_build_object('id',p_id,'status','void','already_canceled',true);end if;
 if r.status<>'accepted'
   or exists(select 1 from public.commerce_receipts where invoice_id=p_id and kind='payment')
   or exists(select 1 from public.commerce_gateway_attempts where invoice_id=p_id
     and (state in ('paid','refunded','review','unknown','started')
      or (state='redirected' and provider<>'rampex')))
 then raise exception 'Payment in progress; verify before canceling' using errcode='P0001';end if;
 select exists(select 1 from public.commerce_gateway_attempts where invoice_id=p_id
   and provider='rampex' and state='redirected') into pending_link;
 perform set_config('app.commerce_cancel_unpaid_verified','yes',true);
 update public.commerce_invoices set status='void',version=version+1,updated_at=now() where id=p_id;
 insert into public.commerce_events(invoice_id,action,actor,details)
 values(p_id,'status_changed','customer:'||p_customer,jsonb_build_object('from',r.status,'to','void',
 'provider_link_may_remain_live',pending_link,'late_payment_action','manual_refund_review'));
 return jsonb_build_object('id',p_id,'status','void','provider_link_may_remain_live',pending_link);
end $$;
revoke all on function public.commerce_cancel_checkout(uuid,uuid) from public,anon,authenticated;
grant execute on function public.commerce_cancel_checkout(uuid,uuid) to service_role,postgres;
revoke all on function commerce_internal.prevent_uncertain_gateway_mutation(),commerce_internal.checkout_balance_transition() from public,anon,authenticated;
commit;
