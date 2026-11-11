\set ON_ERROR_STOP on
-- Run after native/PeptidePay fixtures, only in the disposable database.
\i supabase/migrations/20261111025932_direct_checkout_balances.sql
set role service_role;
do $$
declare m uuid:=gen_random_uuid();u uuid:=gen_random_uuid();i uuid:=gen_random_uuid();j uuid:=gen_random_uuid();grant_id uuid:=gen_random_uuid();
 p jsonb;r jsonb;receipt uuid:=gen_random_uuid();
begin
 perform public.commerce_admin_command('save_method',jsonb_build_object('id',m,'version',0,'kind','bank_transfer','label','Checkout fixture bank','currency','USD','payee','Fixture only','instructions','Isolated fixture receiving instructions','acceptance_reference','Fixture verification','active',true,'business_confirmed',true,'catalog_accepted',true),'checkout-fixture-admin');
 perform public.commerce_issue_credit(grant_id,u,5000,'Isolated credit fixture','checkout-fixture-admin');
 perform public.commerce_issue_credit(grant_id,u,5000,'Isolated credit fixture','checkout-fixture-admin');
 if (select credit_cents from public.commerce_balance_accounts where customer_id=u)<>5000 then raise exception 'Credit replay changed balance';end if;
 p:=jsonb_build_object('id',i,'customer_id',u,'customer_email','checkout@example.test','customer_name','Checkout fixture','kind','goods','plan',null,
 'digest',repeat('d',64),'request',jsonb_build_object('items','[]'::jsonb,'address',jsonb_build_object('country','US')),'consent',true,'terms_version','launch-2026-11-v1',
 'checkout_version','checkout-2026-11-v1','currency','USD','method_id',m,'method_version',1,'subtotal_cents',10000,'discount_cents',500,'shipping_cents',2500,'tax_cents',0,
 'total_cents',11000,'points_redeemed',0,'credit_redeemed_cents',1000,'earned_points',85,'pricing','{}'::jsonb,'membership_invoice_id',null);
 r:=public.commerce_place_checkout(p);
 if r->>'status'<>'accepted' or (select credit_cents from public.commerce_balance_accounts where customer_id=u)<>4000 then raise exception 'Checkout did not reserve credit';end if;
 perform public.commerce_place_checkout(p);
 if (select credit_cents from public.commerce_balance_accounts where customer_id=u)<>4000 or (select count(*) from public.commerce_notifications where invoice_id=i)<>2 then raise exception 'Checkout replay duplicated financial/notification effects';end if;
 begin
  perform public.commerce_place_checkout(p||jsonb_build_object('id',j,'credit_redeemed_cents',5000,'total_cents',7000,'earned_points',45));
  raise exception 'Overspend succeeded' using errcode='22000';
 exception when raise_exception then null;end;
 begin
  perform public.commerce_cancel_checkout(i,gen_random_uuid());raise exception 'Cross customer cancel succeeded' using errcode='22000';
 exception when no_data_found then null;end;
 perform public.commerce_admin_command('record_payment',jsonb_build_object('id',i,'version',1,'receipt_id',receipt,'external_reference','fixture-checkout-paid','amount_cents',11000,'currency','USD','funds_confirmed',true),'checkout-fixture-admin');
 perform public.commerce_admin_command('record_payment',jsonb_build_object('id',i,'version',1,'receipt_id',receipt,'external_reference','fixture-checkout-paid','amount_cents',11000,'currency','USD','funds_confirmed',true),'checkout-fixture-admin');
 if (select points from public.commerce_balance_accounts where customer_id=u)<>85 then raise exception 'Payment earnings duplicated';end if;
 perform public.commerce_admin_command('record_refund',jsonb_build_object('id',i,'version',2,'receipt_id',gen_random_uuid(),'external_reference','fixture-checkout-refund','amount_cents',11000,'currency','USD','funds_confirmed',true),'checkout-fixture-admin');
 if (select points from public.commerce_balance_accounts where customer_id=u)<>0 or (select credit_cents from public.commerce_balance_accounts where customer_id=u)<>5000 then raise exception 'Refund balance reversal wrong';end if;
 -- Cancel restores reserved balances exactly once.
 perform public.commerce_place_checkout(p||jsonb_build_object('id',j));
 perform public.commerce_cancel_checkout(j,u);perform public.commerce_cancel_checkout(j,u);
 if (select credit_cents from public.commerce_balance_accounts where customer_id=u)<>5000 then raise exception 'Cancel restore wrong';end if;
 -- Full credit payment must be paid atomically with no fictitious external receipt.
 j:=gen_random_uuid();
 perform public.commerce_issue_credit(gen_random_uuid(),u,10000,'Second isolated credit fixture','checkout-fixture-admin');
 perform public.commerce_place_checkout(p||jsonb_build_object('id',j,'credit_redeemed_cents',12000,'total_cents',0,'earned_points',0));
 if (select status from public.commerce_invoices where id=j)<>'paid' or exists(select 1 from public.commerce_receipts where invoice_id=j) then raise exception 'Full balance payment wrong';end if;
 perform public.commerce_refund_balance_order(j,2,'checkout-fixture-admin');
 perform public.commerce_refund_balance_order(j,2,'checkout-fixture-admin');
 if (select credit_cents from public.commerce_balance_accounts where customer_id=u)<>15000 then raise exception 'Full balance refund wrong';end if;
end $$;
reset role;
do $$ begin
 if has_table_privilege('anon','public.commerce_balance_accounts','SELECT') or has_table_privilege('authenticated','public.commerce_balance_events','SELECT')
 or has_table_privilege('service_role','public.commerce_balance_events','UPDATE')
 or has_function_privilege('authenticated','public.commerce_place_checkout(jsonb)','EXECUTE')
 or has_function_privilege('anon','public.commerce_issue_credit(uuid,uuid,integer,text,text)','EXECUTE') then raise exception 'Financial ACL regression';end if;
end $$;
select 'direct_checkout_balances_passed' as result;
