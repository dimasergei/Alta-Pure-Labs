-- Run after 20261117084413_pure_storefront_regular_pricing.sql as the migration owner.
-- All fixtures and financial transitions are rolled back; no provider is contacted.
begin;
create function pg_temp.reset_payload(p_id uuid,p_customer uuid,p_method uuid,p_unit integer default 10000,p_qty integer default 2,p_coupon text default '',p_points integer default 0,p_credit integer default 0)
returns jsonb language plpgsql as $$
declare item jsonb; priced jsonb; subtotal integer:=p_unit*p_qty; discount integer; shipping integer; delivery jsonb;
begin
 discount:=case when upper(trim(p_coupon))='BLACKFRIDAY15' then round(subtotal::numeric*1500/10000)::integer else 0 end;
 shipping:=case when subtotal-discount>=15000 then 0 else 1495 end;
 item:=jsonb_build_object('id','fixture-product','name','Fixture product','size','5mg','qty',p_qty,'unit_price_usd_cents',p_unit);
 priced:=item||jsonb_build_object('unit_price_cents',p_unit,'gross_cents',subtotal,'discount_cents',discount,'coupon_discount_cents',discount,'line_total_cents',subtotal-discount,'discount_bps',case when p_coupon='' then 0 else 1500 end,'discount_reason',case when p_coupon='' then 'none' else 'coupon_blackfriday15' end,'bogo_free_units',0);
 delivery:=jsonb_build_object('selection',jsonb_build_object('shipping','standard','extras','[]'::jsonb),'shipping_cents',shipping,'country','US','rate_version','shipping-2026-11-v1','extras','[]'::jsonb,'extras_cents',0,'total_cents',shipping);
 return jsonb_build_object('id',p_id,'customer_id',p_customer,'customer_email','reset-fixture@example.test','customer_name','Reset fixture','kind','goods','plan',null,'digest',repeat('d',64),'consent',true,'terms_version','launch-2026-11-v1','checkout_version','checkout-2026-11-v5','currency','USD','method_id',p_method,'method_version',1,
  'subtotal_cents',subtotal,'discount_cents',discount,'shipping_cents',shipping,'tax_cents',0,'total_cents',subtotal-discount+shipping-p_points-p_credit,'points_redeemed',p_points,'credit_redeemed_cents',p_credit,'earned_points',0,'membership_invoice_id',null,
  'request',jsonb_build_object('items',jsonb_build_array(item),'address',jsonb_build_object('country','US'),'research_use_confirmed',true,'checkout',jsonb_build_object('version','checkout-2026-11-v5','method_id',p_method,'coupon',upper(trim(p_coupon)),'points',p_points,'credit_cents',p_credit,'delivery',delivery->'selection')),
  'pricing',jsonb_build_object('lines',jsonb_build_array(priced),'subtotal_cents',subtotal,'discount_cents',discount,'currency','USD','fx_ppm',1000000,'terms_version','launch-2026-11-v1','checkout_version','checkout-2026-11-v5','conversion_version','conversion-2026-11-v2','billing_period',null,'promotion_version','blackfriday15-2026-11-v1','coupon_code',upper(trim(p_coupon)),'coupon_discount_cents',discount,'bogo_free_units',0,'delivery',delivery,'redeemed_points',p_points,'credit_cents',p_credit));
end $$;
create function pg_temp.reset_reject(p jsonb,label text) returns void language plpgsql as $$
begin
 begin
  perform public.commerce_place_checkout(p);
  raise exception 'Unexpectedly accepted %',label using errcode='22000';
 exception when invalid_parameter_value or raise_exception or check_violation then null;
 end;
end $$;
do $$
declare
 m uuid:=gen_random_uuid();u uuid:=gen_random_uuid();i uuid:=gen_random_uuid();j uuid;
 p jsonb;q jsonb;r jsonb;stored public.commerce_invoices%rowtype;v text;unit integer;qty integer;n integer;
begin
 insert into public.commerce_payment_methods(id,kind,label,currency,payee,instructions,acceptance_reference,active,provider_key,sale_scope)
 values(m,'bank_transfer','Reset fixture bank','USD','Fixture only','No live receiving account; rollback fixture','Disposable test fixture',true,'bank_transfer','goods');
 insert into public.commerce_balance_accounts(customer_id,points,credit_cents) values(u,5000,50000);
 p:=pg_temp.reset_payload(i,u,m,10000,2,' blackFriday15 ',500,1000);
 r:=public.commerce_place_checkout(p);
 select * into stored from public.commerce_invoices where id=i;
 if r->>'status'<>'accepted' or stored.subtotal_cents<>20000 or stored.discount_cents<>3000 or stored.shipping_cents<>0 or stored.total_cents<>15500 or stored.earned_points<>0
  or stored.request_data->'items'->0->>'qty'<>'2' or stored.pricing->>'bogo_free_units'<>'0' or stored.pricing->>'coupon_code'<>'BLACKFRIDAY15'
 then raise exception 'Coupon, totals, earning or purchased quantity mismatch'; end if;
 if (select points from public.commerce_balance_accounts where customer_id=u)<>4500 or (select credit_cents from public.commerce_balance_accounts where customer_id=u)<>49000 then raise exception 'Existing balance redemption failed'; end if;
 perform public.commerce_place_checkout(p);
 if (select count(*) from public.commerce_balance_events where invoice_id=i)<>2 then raise exception 'Replay duplicated balance reservations'; end if;
 perform pg_temp.reset_reject(pg_temp.reset_payload(gen_random_uuid(),u,m,10000,2,'',5001,0),'overspent points');
 perform pg_temp.reset_reject(pg_temp.reset_payload(gen_random_uuid(),u,m,100000,1,'',0,49001),'overspent credit');
 perform public.commerce_cancel_checkout(i,u);perform public.commerce_cancel_checkout(i,u);
 if (select points from public.commerce_balance_accounts where customer_id=u)<>5000 or (select credit_cents from public.commerce_balance_accounts where customer_id=u)<>50000 then raise exception 'Cancellation did not restore exactly once'; end if;
 j:=gen_random_uuid();q:=pg_temp.reset_payload(j,u,m,10000,1,'',500,10995);
 perform public.commerce_place_checkout(q);
 if (select status from public.commerce_invoices where id=j)<>'paid' or exists(select 1 from public.commerce_receipts where invoice_id=j) then raise exception 'Existing account value payment failed'; end if;
 if (select points from public.commerce_balance_accounts where customer_id=u)<>4500 then raise exception 'New rewards were earned'; end if;
 perform public.commerce_refund_balance_order(j,2,'reset-fixture');perform public.commerce_refund_balance_order(j,2,'reset-fixture');
 if (select points from public.commerce_balance_accounts where customer_id=u)<>5000 or (select credit_cents from public.commerce_balance_accounts where customer_id=u)<>50000 then raise exception 'Balance refund restoration failed'; end if;
 -- The coupon applies before shipping eligibility, and account value does not reduce eligibility.
 foreach unit in array array[14999,15000,17646,17647] loop
  q:=pg_temp.reset_payload(gen_random_uuid(),u,m,unit,1,case when unit>15000 then 'BLACKFRIDAY15' else '' end,100,0);
  perform commerce_internal.validate_regular_checkout(q);
  if (q->>'shipping_cents')::integer<>(case when unit in (15000,17647) then 0 else 1495 end) then raise exception 'Shipping boundary mismatch'; end if;
 end loop;
 q:=pg_temp.reset_payload(gen_random_uuid(),u,m);
 if (q->>'discount_cents')::integer<>0 or (q->>'total_cents')::integer<>20000 then raise exception 'Coupon removal did not restore regular prices'; end if;
 perform commerce_internal.validate_regular_checkout(q);
 foreach qty in array array[1,9,10,50,100] loop
  q:=pg_temp.reset_payload(gen_random_uuid(),u,m,10000,qty)||jsonb_build_object('request',(pg_temp.reset_payload(gen_random_uuid(),u,m,10000,qty)->'request')||'{"bulk_order":true}'::jsonb);
  perform commerce_internal.validate_regular_checkout(q);
  if (q->>'discount_cents')::integer<>0 then raise exception 'Automatic bulk discount'; end if;
 end loop;
 foreach v in array array['checkout-2026-11-v1','checkout-2026-11-v2','checkout-2026-11-v3','checkout-2026-11-v4'] loop
  perform pg_temp.reset_reject(p||jsonb_build_object('id',gen_random_uuid(),'checkout_version',v),'retired quote version');
 end loop;
 q:=pg_temp.reset_payload(gen_random_uuid(),u,m);
 perform pg_temp.reset_reject(jsonb_set(q,'{request,checkout,coupon}','"BOGO"'),'BOGO code');
 perform pg_temp.reset_reject(jsonb_set(q,'{request,checkout,coupon}','"PARTNER"'),'referral code');
 perform pg_temp.reset_reject(jsonb_set(q,'{pricing,lines,0,discount_bps}','5000'),'bulk pricing');
 perform pg_temp.reset_reject(jsonb_set(q,'{pricing,lines,0,discount_reason}','"elite"'),'member pricing');
 perform pg_temp.reset_reject(jsonb_set(q,'{pricing,bank_discount_cents}','1000'),'bank savings');
 perform pg_temp.reset_reject(jsonb_set(q,'{pricing,lines,0,bogo_free_units}','2'),'free units');
 perform pg_temp.reset_reject(jsonb_set(q,'{request,items,0,qty}','4'),'quantity inflation');
 perform pg_temp.reset_reject(jsonb_set(q,'{earned_points}','100'),'new points');
 perform pg_temp.reset_reject(q||'{"kind":"membership","plan":"elite"}'::jsonb,'membership checkout');
 perform pg_temp.reset_reject(jsonb_set(q,'{request,research_builder}','true'),'builder checkout');
 perform pg_temp.reset_reject(jsonb_set(q,'{request,subscription}','true'),'subscription checkout');
 perform pg_temp.reset_reject(jsonb_set(q,'{request,billing_period}','"monthly"'),'plan checkout');
 begin
  perform public.commerce_request_invoice(q||'{"kind":"membership","plan":"vip"}'::jsonb);
  raise exception 'Membership request created' using errcode='22000';
 exception when invalid_parameter_value or raise_exception then null; end;
 begin
  insert into public.commerce_memberships(invoice_id,customer_id,plan,starts_at,expires_at) values(i,u,'elite',now(),now()+interval '1 year');
  raise exception 'Membership activated' using errcode='22000';
 exception when raise_exception then null; end;
 begin
  insert into public.research_subscriptions(id,customer_id,customer_email,lines,shipping_address,retail_cents,discount_cents,monthly_cents) values(gen_random_uuid(),u,'fixture@example.test','[]','{}',10000,0,10000);
  raise exception 'Subscription created' using errcode='22000';
 exception when raise_exception then null; end;
 begin
  insert into public.research_subscription_cycles(subscription_id,cycle_number,provider_transaction_id,amount_cents,status,paid_at) values(gen_random_uuid(),1,'reset-fixture',10000,'paid',now());
  raise exception 'Subscription recurrence created' using errcode='22000';
 exception when raise_exception then null; end;
 if has_function_privilege('anon','public.commerce_place_checkout(jsonb)','EXECUTE')
  or has_function_privilege('authenticated','public.commerce_place_checkout(jsonb)','EXECUTE')
  or has_function_privilege('service_role','commerce_internal.validate_regular_checkout(jsonb)','EXECUTE')
  or not has_function_privilege('service_role','public.commerce_place_checkout(jsonb)','EXECUTE')
 then raise exception 'Checkout privilege regression'; end if;
end $$;
select 'storefront_reset_checks_passed' as result;
rollback;
