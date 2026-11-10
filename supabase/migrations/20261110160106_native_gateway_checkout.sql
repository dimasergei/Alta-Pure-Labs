-- Native gateway collection for accepted, owner-reviewed invoices.
-- No merchant credentials, account approvals, receiving routes or paid records are seeded.
alter table public.commerce_payment_methods add column native_provider text check(native_provider in ('nmi','payerurl'));
create table public.commerce_gateway_accounts(
 method_id uuid primary key references public.commerce_payment_methods(id),
 provider text not null check(provider in ('nmi','payerurl')),
 mode text not null check(mode in ('sandbox','live')),
 account_tag text not null check(account_tag ~ '^[a-f0-9]{64}$'),
 countries text[] not null check(cardinality(countries) between 1 and 60),
 created_at timestamptz not null default now()
);
create table public.commerce_gateway_attempts(
 id uuid primary key, invoice_id uuid not null references public.commerce_invoices(id),
 method_id uuid not null references public.commerce_payment_methods(id),
 provider text not null check(provider in ('nmi','payerurl')),
 mode text not null check(mode in ('sandbox','live')), account_tag text not null,
 operation text not null check(operation in ('sale','refund')),
 amount_cents integer not null check(amount_cents between 1 and 100000000),
 currency text not null check(currency in ('USD','CAD')),
 state text not null default 'started' check(state in ('started','redirected','unknown','declined','paid','refunded','review')),
 provider_transaction_id text, redirect_url text, error_code text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index gateway_one_active_sale on public.commerce_gateway_attempts(invoice_id) where operation='sale' and state<>'declined';
create unique index gateway_one_refund on public.commerce_gateway_attempts(invoice_id) where operation='refund';
create unique index gateway_single_verified_transaction on public.commerce_gateway_attempts(provider,account_tag,provider_transaction_id,operation) where state in ('paid','refunded');
create index gateway_provider_transaction on public.commerce_gateway_attempts(provider,provider_transaction_id);
create table public.commerce_gateway_events(
 provider text not null, event_key text not null, attempt_id uuid not null references public.commerce_gateway_attempts(id),
 outcome text not null, amount_cents integer, currency text, provider_transaction_id text,
 created_at timestamptz not null default now(), primary key(provider,event_key)
);
alter table public.commerce_gateway_accounts enable row level security;
alter table public.commerce_gateway_attempts enable row level security;
alter table public.commerce_gateway_events enable row level security;
revoke all on public.commerce_gateway_accounts,public.commerce_gateway_attempts,public.commerce_gateway_events from public,anon,authenticated,service_role;
grant select on public.commerce_gateway_accounts,public.commerce_gateway_attempts,public.commerce_gateway_events to service_role;

create function public.commerce_configure_native_gateway(p_data jsonb,p_actor text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare mid uuid; current_method public.commerce_payment_methods%rowtype; country text; codes text[];
begin
 mid:=(p_data->>'id')::uuid;
 if mid is null or p_data->>'provider' not in ('nmi','payerurl') or p_data->>'mode' not in ('sandbox','live')
  or p_data->>'account_tag' !~ '^[a-f0-9]{64}$' or p_data->>'confirmed' is distinct from 'true'
  or length(coalesce(p_actor,''))<8 then raise exception 'Invalid native gateway setup' using errcode='22023'; end if;
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

create function public.commerce_begin_gateway_attempt(p_id uuid,p_invoice uuid,p_customer uuid,p_operation text,p_account_tag text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare i public.commerce_invoices%rowtype; a public.commerce_gateway_accounts%rowtype; m public.commerce_payment_methods%rowtype; old public.commerce_gateway_attempts%rowtype;
begin
 if p_id is null or p_customer is null or p_operation is null or p_operation not in ('sale','refund') then raise exception 'Invalid payment command' using errcode='22023'; end if;
 select * into i from public.commerce_invoices where id=p_invoice and customer_id=p_customer for update;
 if not found then raise exception 'Invoice not found' using errcode='P0002'; end if;
 select * into old from public.commerce_gateway_attempts where id=p_id;
 if found then
  if old.invoice_id<>i.id or old.operation<>p_operation or old.account_tag<>p_account_tag then raise exception 'Attempt ID conflict' using errcode='23505'; end if;
  return to_jsonb(old)||jsonb_build_object('claimed',false);
 end if;
 select * into a from public.commerce_gateway_accounts where method_id=i.method_id;
 select * into m from public.commerce_payment_methods where id=i.method_id for share;
 if a.method_id is null or a.account_tag is distinct from p_account_tag or not m.active then raise exception 'Gateway unavailable' using errcode='P0001'; end if;
 if p_operation='sale' then
  if i.status<>'accepted' or i.expires_at<=now() or (m.sale_scope<>'both' and m.sale_scope<>i.kind)
   or (i.kind='goods' and not ((i.request_data->'address'->>'country')=any(a.countries))) then raise exception 'Invoice not payable on this route' using errcode='P0001'; end if;
  select * into old from public.commerce_gateway_attempts where invoice_id=i.id and operation='sale' and state<>'declined';
  if found then return to_jsonb(old)||jsonb_build_object('claimed',false); end if;
 else
  if a.provider<>'nmi' or i.status not in ('paid','processing','shipped','delivered') then raise exception 'Refund not available' using errcode='P0001'; end if;
  select * into old from public.commerce_gateway_attempts where invoice_id=i.id and operation='refund';
  if found then return to_jsonb(old)||jsonb_build_object('claimed',false); end if;
  if not exists(select 1 from public.commerce_gateway_attempts where invoice_id=i.id and operation='sale' and state='paid' and provider='nmi') then raise exception 'Native payment not found' using errcode='P0001'; end if;
 end if;
 insert into public.commerce_gateway_attempts(id,invoice_id,method_id,provider,mode,account_tag,operation,amount_cents,currency)
 values(p_id,i.id,m.id,a.provider,a.mode,a.account_tag,p_operation,i.total_cents,i.currency) returning * into old;
 return to_jsonb(old)||jsonb_build_object('claimed',true);
end $$;

create function public.commerce_finish_gateway_attempt(p_id uuid,p_event text,p_outcome text,p_transaction text,p_amount integer,p_currency text,p_redirect text,p_error text)
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
 if p_redirect is not null and (a.provider<>'payerurl' or left(p_redirect,8)<>'https://' or length(p_redirect)>2000) then raise exception 'Invalid redirect' using errcode='22023'; end if;
 update public.commerce_gateway_attempts set state=next_state,provider_transaction_id=coalesce(p_transaction,provider_transaction_id),
  redirect_url=coalesce(p_redirect,redirect_url),error_code=p_error,updated_at=now() where id=a.id;
 return jsonb_build_object('id',a.id,'state',next_state,'invoice_id',i.id,'invoice_status',(select status from public.commerce_invoices where id=i.id));
end $$;

create function commerce_internal.prevent_uncertain_gateway_mutation()
returns trigger language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 if new.status is distinct from old.status and exists(select 1 from public.commerce_gateway_attempts where invoice_id=old.id and state in ('started','redirected','unknown','review')) then
  raise exception 'Reconcile the existing native payment attempt before changing this invoice' using errcode='P0001';
 end if;
 return new;
end $$;
revoke all on function commerce_internal.prevent_uncertain_gateway_mutation() from public,anon,authenticated,service_role;
create trigger invoice_gateway_pending_guard before update of status on public.commerce_invoices for each row execute function commerce_internal.prevent_uncertain_gateway_mutation();
revoke all on function public.commerce_configure_native_gateway(jsonb,text),public.commerce_begin_gateway_attempt(uuid,uuid,uuid,text,text),public.commerce_finish_gateway_attempt(uuid,text,text,text,integer,text,text,text) from public,anon,authenticated;
grant execute on function public.commerce_configure_native_gateway(jsonb,text),public.commerce_begin_gateway_attempt(uuid,uuid,uuid,text,text),public.commerce_finish_gateway_attempt(uuid,text,text,text,integer,text,text,text) to service_role;
