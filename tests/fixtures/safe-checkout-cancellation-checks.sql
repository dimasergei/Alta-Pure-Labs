\set ON_ERROR_STOP on
-- Disposable PostgreSQL only: regression for persisted Rampex link, customer cancellation and late settlement.
do $$
declare m uuid:=gen_random_uuid();u uuid:=gen_random_uuid();i uuid:=gen_random_uuid();a uuid:=gen_random_uuid();
 p jsonb;q jsonb;r jsonb;tag text:=md5(gen_random_uuid()::text)||md5(gen_random_uuid()::text);
 tx text:='0x'||repeat('c',64);ln text:='safe-cancel-'||substr(gen_random_uuid()::text,1,8);
begin
 p:=jsonb_build_object('id',m,'version',0,'provider','rampex','mode','live','account_tag',tag,
 'confirmed',true,'countries',jsonb_build_array('US'),'label','Fixture Stripe','payee','Fixture only',
 'currency','USD','approval_reference','DISPOSABLE TEST ONLY','active',true,'sale_scope','goods','rampex_provider','stripe');
 perform public.commerce_configure_rampex_gateway(p,'isolated-test-admin');
 p:=jsonb_build_object('id',i,'customer_id',u,'customer_email','safe-fixture@example.test',
 'customer_name','Safe cancel fixture','kind','goods','digest',repeat('7',64),
 'request',jsonb_build_object('items','[]'::jsonb,'address',jsonb_build_object('country','US')),
 'consent',true,'terms_version','launch-2026-11-v1');
 perform public.commerce_request_invoice(p);
 q:=jsonb_build_object('id',i,'version',1,'method_id',m,'method_version',1,
 'subtotal_cents',4900,'discount_cents',0,'shipping_cents',0,'tax_cents',0,
 'pricing',jsonb_build_object('lines','[]'::jsonb),'expires_at',now()+interval '24 hours',
 'fulfillment_confirmed',true,'review_note','Safe cancellation fixture testing',
 'payment_url','https://altapurelabs.com/pay.html?invoice='||i::text);
 perform public.commerce_provider_command('issue',q,'isolated-test-admin');
 perform public.commerce_accept_invoice(i,u,2,'launch-2026-11-v1');
 -- Only the disposable database fixture is marked as checkout-v4; no production row is changed.
 update public.commerce_invoices set checkout_version='checkout-2026-11-v4' where id=i;
 perform public.commerce_begin_rampex_attempt(a,i,u,tag);
 perform public.commerce_bind_rampex_link(a,ln,'https://checkout.rampex.io/pay/'||ln,tag);
 begin
  perform public.commerce_cancel_checkout(i,gen_random_uuid());
  raise exception 'Cross-customer cancel succeeded' using errcode='22000';
 exception when SQLSTATE 'P0002' then null;end;
 r:=public.commerce_cancel_checkout(i,u);
 if r->>'status'<>'void' or r->>'provider_link_may_remain_live'<>'true' then
   raise exception 'Did not void unpaid checkout: %',r;end if;
 r:=public.commerce_cancel_checkout(i,u);
 if r->>'already_canceled'<>'true' then raise exception 'Repeat cancellation was not idempotent';end if;
 -- Even if provider accepts after user cancellation, DB cannot mark paid or ship.
 r:=public.commerce_finish_rampex_payment(a,ln,tag,tx,4900,4900,'USD');
 if r->>'state'<>'review' or r->>'newly_paid'<>'false' then raise exception 'Late payment did not require manual review: %',r;end if;
 if (select status from public.commerce_invoices where id=i)<>'void' then raise exception 'Late payment fulfilled canceled order';end if;
 if exists(select 1 from public.commerce_receipts where invoice_id=i and kind='payment') then raise exception 'Late payment created receipt';end if;
 if exists(select 1 from public.commerce_fulfillment_items where invoice_id=i) then raise exception 'Late payment created fulfillment allocation';end if;
end $$;
select 'safe_cancellation_and_late_payment_review_pass' as result;
