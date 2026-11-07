begin;
create or replace function public.apply_store_checkout_event(
 p_event_id text,p_event_type text,p_order_id uuid,p_session_id text,p_payment_intent text,
 p_paid boolean,p_currency text,p_subtotal bigint,p_shipping bigint,p_tax bigint,p_total bigint,
 p_shipping_name text,p_shipping_address jsonb
) returns void language plpgsql security definer set search_path = '' as $$
declare o public.store_orders%rowtype;
begin
 select * into o from public.store_orders where id=p_order_id for update;
 if not found then raise exception 'Order not found'; end if;
 if exists(select 1 from public.store_payment_events where stripe_event_id=p_event_id) then return; end if;
 if o.stripe_checkout_session_id is not null and o.stripe_checkout_session_id<>p_session_id then raise exception 'Session mismatch'; end if;
 if p_currency<>'usd' or p_subtotal<>o.subtotal_cents or p_shipping<>2500 or p_tax<>0 or p_total<>o.total_cents then raise exception 'Payment amount mismatch'; end if;
 if p_paid then
   if p_shipping_address is null or p_shipping_address->>'country' is distinct from 'US' then raise exception 'US shipping address required'; end if;
   update public.store_orders set payment_status=case when payment_status in ('refunded','partially_refunded') then payment_status else 'paid' end,
    stripe_checkout_session_id=p_session_id,stripe_payment_intent_id=p_payment_intent,
    shipping_country='US',shipping_address=p_shipping_address,shipping_name=p_shipping_name,
    paid_at=coalesce(paid_at,now()) where id=p_order_id;
 elsif p_event_type in ('checkout.session.expired','checkout.session.async_payment_failed') then
   update public.store_orders set payment_status=case when p_event_type='checkout.session.expired' then 'expired' else 'failed' end
    where id=p_order_id and payment_status='pending';
 end if;
 insert into public.store_payment_events(stripe_event_id,event_type) values(p_event_id,p_event_type);
end; $$;
revoke all on function public.apply_store_checkout_event(text,text,uuid,text,text,boolean,text,bigint,bigint,bigint,bigint,text,jsonb) from public,anon,authenticated;
grant execute on function public.apply_store_checkout_event(text,text,uuid,text,text,boolean,text,bigint,bigint,bigint,bigint,text,jsonb) to service_role;
commit;
