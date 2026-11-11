-- Add a disabled-by-default payment adapter. No route, customer, invoice or payment is seeded.
alter table public.commerce_payment_methods drop constraint commerce_payment_methods_native_provider_check;
alter table public.commerce_payment_methods add constraint commerce_payment_methods_native_provider_check check(native_provider in ('nmi','payerurl','peptidepay'));
alter table public.commerce_gateway_accounts drop constraint commerce_gateway_accounts_provider_check;
alter table public.commerce_gateway_accounts add constraint commerce_gateway_accounts_provider_check check(provider in ('nmi','payerurl','peptidepay'));
alter table public.commerce_gateway_attempts drop constraint commerce_gateway_attempts_provider_check;
alter table public.commerce_gateway_attempts add constraint commerce_gateway_attempts_provider_check check(provider in ('nmi','payerurl','peptidepay'));
alter table public.commerce_gateway_attempts
 add column provider_session_id text check(provider_session_id ~ '^cs_[A-Za-z0-9_-]{6,120}$'),
 add column settlement_address text check(settlement_address ~ '^0x[a-f0-9]{40}$');
create unique index gateway_unique_session on public.commerce_gateway_attempts(provider,account_tag,provider_session_id) where provider_session_id is not null;

create or replace function public.commerce_configure_native_gateway(p_data jsonb,p_actor text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare mid uuid; current_method public.commerce_payment_methods%rowtype; country text; codes text[];
begin
 mid:=(p_data->>'id')::uuid;
 if mid is null or p_data->>'provider' not in ('nmi','payerurl','peptidepay') or p_data->>'mode' not in ('sandbox','live')
  or p_data->>'account_tag' !~ '^[a-f0-9]{64}$' or p_data->>'confirmed' is distinct from 'true'
  or length(coalesce(p_actor,''))<8 then raise exception 'Invalid native gateway setup' using errcode='22023'; end if;
 if p_data->>'provider'='peptidepay' and (p_data->>'mode'<>'live' or p_data->>'sale_scope'<>'goods') then raise exception 'PeptidePay requires a verified live goods route' using errcode='22023'; end if;
 select array_agg(value) into codes from jsonb_array_elements_text(p_data->'countries');
 if codes is null or cardinality(codes) not between 1 and 60 then raise exception 'Approved destinations required' using errcode='22023'; end if;
 foreach country in array codes loop if country !~ '^[A-Z]{2}$' then raise exception 'Invalid country' using errcode='22023'; end if; end loop;
 select * into current_method from public.commerce_payment_methods where id=mid for update;
 if found then
  if current_method.version is distinct from (p_data->>'version')::integer then raise exception 'Gateway changed' using errcode='40001'; end if;
  if current_method.native_provider is distinct from p_data->>'provider' or current_method.currency is distinct from p_data->>'currency'
   or not exists(select 1 from public.commerce_gateway_accounts where method_id=mid and mode=p_data->>'mode' and account_tag=p_data->>'account_tag') then
   raise exception 'Use a new route for a different gateway account or currency' using errcode='22023'; end if;
  update public.commerce_payment_methods set label=p_data->>'label',payee=p_data->>'payee',acceptance_reference=p_data->>'approval_reference',
   active=(p_data->>'active')::boolean,sale_scope=p_data->>'sale_scope',version=version+1,updated_at=now() where id=mid;
  update public.commerce_gateway_accounts set countries=codes where method_id=mid;
 else
  if (p_data->>'version')::integer is distinct from 0 then raise exception 'Unknown gateway' using errcode='P0002'; end if;
  insert into public.commerce_payment_methods(id,kind,label,currency,payee,instructions,allowed_host,acceptance_reference,active,provider_key,display_order,sale_scope,native_provider)
  values(mid,'hosted_link',p_data->>'label',p_data->>'currency',p_data->>'payee','Pay securely on AltaPure. Provider-confirmed payments update this invoice automatically.','altapurelabs.com',p_data->>'approval_reference',(p_data->>'active')::boolean,'custom',5,p_data->>'sale_scope',p_data->>'provider');
  insert into public.commerce_gateway_accounts(method_id,provider,mode,account_tag,countries) values(mid,p_data->>'provider',p_data->>'mode',p_data->>'account_tag',codes);
 end if;
 insert into public.commerce_events(method_id,action,actor,details) values(mid,'native_gateway_configured',p_actor,jsonb_build_object('provider',p_data->>'provider','mode',p_data->>'mode','active',p_data->>'active','countries',codes));
 return jsonb_build_object('id',mid,'saved',true);
end $$;

create or replace function public.commerce_finish_gateway_attempt(p_id uuid,p_event text,p_outcome text,p_transaction text,p_amount integer,p_currency text,p_redirect text,p_error text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare a public.commerce_gateway_attempts%rowtype; i public.commerce_invoices%rowtype; prior public.commerce_gateway_events%rowtype; result jsonb; next_state text;
begin
 if p_id is null or p_outcome is null or p_outcome not in ('approved','declined','unknown','redirected','refunded','review')
  or length(coalesce(p_event,'')) not between 3 and 200 or length(coalesce(p_transaction,''))>150 or length(coalesce(p_error,''))>100 then raise exception 'Invalid gateway result' using errcode='22023'; end if;
 select invoice_id into a.invoice_id from public.commerce_gateway_attempts where id=p_id;
 if a.invoice_id is null then raise exception 'Attempt not found' using errcode='P0002'; end if;
 select * into i from public.commerce_invoices where id=a.invoice_id for update;
 select * into a from public.commerce_gateway_attempts where id=p_id for update;
 select * into prior from public.commerce_gateway_events where provider=a.provider and event_key=p_event;
 if found then
  if prior.attempt_id<>a.id or prior.outcome<>p_outcome or prior.provider_transaction_id is distinct from p_transaction or prior.amount_cents is distinct from p_amount or prior.currency is distinct from p_currency then raise exception 'Gateway event conflict' using errcode='23505'; end if;
  return jsonb_build_object('id',a.id,'state',a.state,'invoice_status',i.status,'replayed',true);
 end if;
 insert into public.commerce_gateway_events(provider,event_key,attempt_id,outcome,amount_cents,currency,provider_transaction_id)
 values(a.provider,p_event,a.id,p_outcome,p_amount,p_currency,p_transaction);
 if a.state in ('paid','refunded') then return jsonb_build_object('id',a.id,'state',a.state,'invoice_status',i.status); end if;
 if a.provider='peptidepay' and p_outcome='approved' and (a.provider_session_id is null or p_transaction is null or p_transaction !~ '^0x[a-fA-F0-9]{64}$') then raise exception 'Bound PeptidePay settlement required' using errcode='22023'; end if;
 if p_outcome in ('approved','refunded') then
  if p_amount is distinct from a.amount_cents or p_currency is distinct from a.currency or length(coalesce(p_transaction,''))<2 then
   next_state:='review';
  elsif a.mode<>'live' then
   -- Sandbox provider success never grants production invoice/pass entitlement.
   next_state:='review';p_error:='sandbox_no_live_entitlement';
  elsif (a.operation='sale' and p_outcome<>'approved') or (a.operation='refund' and p_outcome<>'refunded') then next_state:='review';
  else
   next_state:=case when a.operation='sale' then 'paid' else 'refunded' end;
   update public.commerce_gateway_attempts set state=next_state,provider_transaction_id=p_transaction,updated_at=now() where id=a.id;
   begin
    result:=public.commerce_admin_command(case when a.operation='sale' then 'record_payment' else 'record_refund' end,
     jsonb_build_object('id',i.id,'version',i.version,'receipt_id',a.id,'external_reference',a.provider||':'||a.operation||':'||p_transaction,
      'amount_cents',a.amount_cents,'currency',a.currency,'funds_confirmed',true),'verified-gateway:'||a.provider);
   exception when others then
    next_state:='review';p_error:='invoice_reconciliation_required';
   end;
  end if;
 else
  next_state:=p_outcome;
  -- A stale declined/redirected result cannot clear an uncertain result from another worker.
  if a.state='review' or (a.state='unknown' and p_outcome in ('declined','redirected')) then next_state:=a.state; end if;
 end if;
 if p_redirect is not null and (a.provider not in ('payerurl','peptidepay') or left(p_redirect,8)<>'https://' or length(p_redirect)>2000) then raise exception 'Invalid redirect' using errcode='22023'; end if;
 if a.provider='peptidepay' and p_redirect is not null and p_redirect not in ('https://peptide-pay.com/session/'||a.provider_session_id,'https://www.peptide-pay.com/session/'||a.provider_session_id) then raise exception 'Invalid PeptidePay session destination' using errcode='22023'; end if;
 update public.commerce_gateway_attempts set state=next_state,provider_transaction_id=coalesce(p_transaction,provider_transaction_id),
  redirect_url=coalesce(p_redirect,redirect_url),error_code=p_error,updated_at=now() where id=a.id;
 return jsonb_build_object('id',a.id,'state',next_state,'invoice_id',i.id,'invoice_status',(select status from public.commerce_invoices where id=i.id));
end $$;


-- Bind the server-created session before exposing its redirect or accepting settlement.
create function public.commerce_bind_peptidepay_session(p_id uuid,p_session text,p_address text,p_redirect text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare a public.commerce_gateway_attempts%rowtype; iid uuid;
begin
 if p_session is null or p_session !~ '^cs_[A-Za-z0-9_-]{6,120}$' or p_session like 'cs_test_%'
  or p_address is null or p_address !~ '^0x[a-f0-9]{40}$' or p_redirect is null
  or p_redirect not in ('https://peptide-pay.com/session/'||p_session,'https://www.peptide-pay.com/session/'||p_session) then raise exception 'Invalid PeptidePay session binding' using errcode='22023'; end if;
 select invoice_id into iid from public.commerce_gateway_attempts where id=p_id;
 if iid is null then raise exception 'Attempt not found' using errcode='P0002'; end if;
 perform 1 from public.commerce_invoices where id=iid for update;
 select * into a from public.commerce_gateway_attempts where id=p_id for update;
 if a.provider<>'peptidepay' or a.operation<>'sale' or a.mode<>'live' then raise exception 'Wrong gateway attempt' using errcode='22023'; end if;
 if a.provider_session_id is not null then
  if a.provider_session_id<>p_session or a.settlement_address<>p_address or a.redirect_url<>p_redirect then raise exception 'Session binding conflict' using errcode='23505'; end if;
  return jsonb_build_object('id',a.id,'state',a.state,'replayed',true);
 end if;
 if a.state not in ('started','unknown') then raise exception 'Attempt cannot be rebound' using errcode='P0001'; end if;
 update public.commerce_gateway_attempts set provider_session_id=p_session,settlement_address=p_address where id=a.id;
 return public.commerce_finish_gateway_attempt(a.id,'session-bound:'||a.id::text,'redirected',null,null,null,p_redirect,null);
end $$;
revoke all on function public.commerce_bind_peptidepay_session(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.commerce_bind_peptidepay_session(uuid,text,text,text) to service_role;
-- CREATE OR REPLACE preserves existing ACLs; explicitly retain the backend-only mutation boundary.
revoke all on function public.commerce_configure_native_gateway(jsonb,text),public.commerce_finish_gateway_attempt(uuid,text,text,text,integer,text,text,text) from public,anon,authenticated;
grant execute on function public.commerce_configure_native_gateway(jsonb,text),public.commerce_finish_gateway_attempt(uuid,text,text,text,integer,text,text,text) to service_role;
