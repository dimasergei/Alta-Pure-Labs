\set ON_ERROR_STOP on
-- Disposable fixture only, after direct-checkout checks. No real customer or funds.
\i supabase/migrations/20261111163930_conversion_memberships_partners.sql
reset role;
create table if not exists public.store_orders(id uuid primary key,customer_email text,payment_status text);
do $$
declare p uuid:=gen_random_uuid();u uuid:=gen_random_uuid();m uuid:=gen_random_uuid();i uuid:=gen_random_uuid();j uuid; payout uuid:=gen_random_uuid();v uuid;member_order uuid;period text;amount integer;payload jsonb;summary jsonb;
begin
 perform public.commerce_join_partner(p,'AP-ABCDEFGH2345','partner-2026-11-v1');
 perform public.commerce_join_partner(p,'AP-ZYXWVUTS2345','partner-2026-11-v1');
 if (select code from public.commerce_partners where customer_id=p)<>'AP-ABCDEFGH2345' then raise exception 'Enrollment replay changed code';end if;
 perform public.commerce_admin_command('save_method',jsonb_build_object('id',m,'version',0,'kind','bank_transfer','label','Conversion fixture','currency','USD','payee','Fixture only','instructions','Not a real bank','acceptance_reference','Fixture only approval','active',true,'business_confirmed',true,'catalog_accepted',true),'conversion-fixture');
 payload:=jsonb_build_object('id',i,'customer_id',u,'customer_email','conversion@example.test','customer_name','Isolated fixture','kind','goods','plan',null,'digest',repeat('c',64),'request',jsonb_build_object('items','[]'::jsonb,'address',jsonb_build_object('country','US')),'consent',true,'terms_version','launch-2026-11-v1','checkout_version','checkout-2026-11-v3','currency','USD','method_id',m,'method_version',1,'subtotal_cents',100000,'discount_cents',0,'shipping_cents',0,'tax_cents',0,'total_cents',100000,'points_redeemed',0,'credit_redeemed_cents',0,'earned_points',2500,'pricing',jsonb_build_object('referral',jsonb_build_object('partner_id',p,'code','AP-ABCDEFGH2345','first_order',true)),'membership_invoice_id',null);
 perform public.commerce_place_checkout(payload);perform public.commerce_place_checkout(payload);
 begin
  perform public.commerce_place_checkout(payload||jsonb_build_object('id',gen_random_uuid()));raise exception 'Concurrent first-order promotion accepted' using errcode='22000';
 exception when raise_exception then null;end;
 perform public.commerce_admin_command('record_payment',jsonb_build_object('id',i,'version',1,'receipt_id',gen_random_uuid(),'external_reference','conversion-first-'||i,'amount_cents',100000,'currency','USD','funds_confirmed',true),'conversion-fixture');
 if (select amount_cents from public.commerce_partner_commissions where invoice_id=i)<>20000 or (select count(*) from public.commerce_referrals where customer_id=u)<>1 then raise exception 'First commission or attribution wrong';end if;
 perform public.commerce_admin_command('status',jsonb_build_object('id',i,'version',2,'status','shipped','tracking_carrier','Fixture carrier','tracking_number','FIXTURE0001','note','Isolated dispatch fixture'),'conversion-fixture');
 perform public.commerce_admin_command('status',jsonb_build_object('id',i,'version',3,'status','delivered','note','Isolated delivery fixture'),'conversion-fixture');
 perform public.commerce_refresh_partner(p);
 if (public.commerce_partner_summary(p)->>'eligible_cents')::integer<>0 then raise exception 'Hold skipped';end if;
 update public.commerce_partner_commissions set eligible_at=now()-interval '1 second' where invoice_id=i;
 perform public.commerce_record_partner_payout(payout,p,20000,'fixture-payout-one','conversion-fixture');
 perform public.commerce_record_partner_payout(payout,p,20000,'fixture-payout-one','conversion-fixture');
 if (select count(*) from public.commerce_partner_payouts where partner_id=p)<>1 then raise exception 'Payout duplicated';end if;
 perform public.commerce_admin_command('record_refund',jsonb_build_object('id',i,'version',4,'receipt_id',gen_random_uuid(),'external_reference','conversion-refund-'||i,'amount_cents',100000,'currency','USD','funds_confirmed',true),'conversion-fixture');
 j:=gen_random_uuid();payload:=payload||jsonb_build_object('id',j,'subtotal_cents',300000,'total_cents',300000,'earned_points',7500,'pricing',jsonb_build_object('referral',jsonb_build_object('partner_id',p,'code','AP-ABCDEFGH2345','first_order',false)));
 perform public.commerce_place_checkout(payload);
 perform public.commerce_admin_command('record_payment',jsonb_build_object('id',j,'version',1,'receipt_id',gen_random_uuid(),'external_reference','conversion-repeat-'||j,'amount_cents',300000,'currency','USD','funds_confirmed',true),'conversion-fixture');
 if (select amount_cents from public.commerce_partner_commissions where invoice_id=j)<>30000 then raise exception 'Repeat commission wrong';end if;
 perform public.commerce_admin_command('status',jsonb_build_object('id',j,'version',2,'status','shipped','tracking_carrier','Fixture carrier','tracking_number','FIXTURE0002','note','Isolated dispatch fixture'),'conversion-fixture');
 perform public.commerce_admin_command('status',jsonb_build_object('id',j,'version',3,'status','delivered','note','Isolated delivery fixture'),'conversion-fixture');
 update public.commerce_partner_commissions set eligible_at=now()-interval '1 second' where invoice_id=j;
 perform public.commerce_refresh_partner(p);
 if (public.commerce_partner_summary(p)->>'eligible_cents')::integer<>10000 then raise exception 'Paid refund debt ignored';end if;
 perform public.commerce_record_partner_payout(gen_random_uuid(),p,10000,'fixture-payout-two','conversion-fixture');
 summary:=public.commerce_partner_summary(p);
 if (summary->>'paid_cents')::integer<>30000 or (summary->>'eligible_cents')::integer<>0 then raise exception 'Payout offset accounting wrong %',summary;end if;
 -- Membership calendar periods are set at verified payment, not browsing or order creation.
 foreach period in array array['monthly','annual'] loop
  v:=gen_random_uuid();member_order:=gen_random_uuid();amount:=case period when 'monthly' then 1999 else 19190 end;
  perform public.commerce_place_checkout(payload||jsonb_build_object('id',member_order,'customer_id',v,'kind','membership','plan','vip','request',jsonb_build_object('items','[]'::jsonb,'billing_period',period),'subtotal_cents',amount,'total_cents',amount,'earned_points',0,'pricing','{}'::jsonb));
  if exists(select 1 from public.commerce_memberships where invoice_id=member_order) then raise exception 'Unpaid membership activated';end if;
  perform public.commerce_admin_command('record_payment',jsonb_build_object('id',member_order,'version',1,'receipt_id',gen_random_uuid(),'external_reference','conversion-member-'||member_order,'amount_cents',amount,'currency','USD','funds_confirmed',true),'conversion-fixture');
  if not exists(select 1 from public.commerce_memberships where invoice_id=member_order and expires_at=starts_at+case period when 'monthly' then interval '1 month' else interval '1 year' end) then raise exception 'Wrong membership term';end if;
 end loop;
 -- First-order discount excludes historical Stripe customers and self-referrals.
 insert into public.store_orders values(gen_random_uuid(),'historical@example.test','paid');
 begin
  perform public.commerce_place_checkout(payload||jsonb_build_object('id',gen_random_uuid(),'customer_id',gen_random_uuid(),'customer_email','historical@example.test','pricing',jsonb_build_object('referral',jsonb_build_object('partner_id',p,'code','AP-ABCDEFGH2345','first_order',true))));raise exception 'Historical buyer accepted' using errcode='22000';
 exception when serialization_failure then null;end;
 begin
  perform public.commerce_place_checkout(payload||jsonb_build_object('id',gen_random_uuid(),'customer_id',p));raise exception 'Self referral accepted' using errcode='22000';
 exception when raise_exception then null;end;
 if has_table_privilege('anon','public.commerce_partners','select') or has_table_privilege('authenticated','public.commerce_partner_commissions','select') or has_function_privilege('anon','public.commerce_join_partner(uuid,text,text)','execute') or has_function_privilege('authenticated','public.commerce_record_partner_payout(uuid,uuid,integer,text,text)','execute') then raise exception 'Browser access leaked';end if;
end $$;
