-- Rampex only. Adds no payment method, customer, invoice, payment, notification or supplier job.
-- Apply this exact migration separately after approval; never run a broad pending-migrations push.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
alter table public.commerce_payment_methods drop constraint commerce_payment_methods_native_provider_check;
alter table public.commerce_payment_methods add constraint commerce_payment_methods_native_provider_check check(native_provider in ('nmi','payerurl','peptidepay','rampex'));
alter table public.commerce_gateway_accounts drop constraint commerce_gateway_accounts_provider_check;
alter table public.commerce_gateway_accounts add constraint commerce_gateway_accounts_provider_check check(provider in ('nmi','payerurl','peptidepay','rampex'));
alter table public.commerce_gateway_attempts drop constraint commerce_gateway_attempts_provider_check;
alter table public.commerce_gateway_attempts add constraint commerce_gateway_attempts_provider_check check(provider in ('nmi','payerurl','peptidepay','rampex'));
alter table public.commerce_gateway_accounts add column rampex_provider text;
alter table public.commerce_gateway_attempts add column rampex_provider text,
 add column rampex_link_id text check(rampex_link_id ~ '^[A-Za-z0-9_-]{1,160}$');
alter table public.commerce_gateway_accounts add constraint rampex_account_rail_check check(provider<>'rampex' or (rampex_provider is not null and rampex_provider in ('rampnetwork','robinhood','topper','unlimit','bitnovo','simpleswap','mercuryo','revolut','transak','cryptix','guardarian','moonpay','banxa','alchemypay','sardine','particle','wert','simplex','utorg','transfi')));
create unique index gateway_unique_rampex_link on public.commerce_gateway_attempts(account_tag,rampex_link_id) where provider='rampex' and rampex_link_id is not null;

create function public.commerce_configure_rampex_gateway(p_data jsonb,p_actor text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare mid uuid; current_method public.commerce_payment_methods%rowtype; a public.commerce_gateway_accounts%rowtype; country text; codes text[]; rail text;
begin
 if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'Invalid Rampex configuration' using errcode='22023'; end if;
 mid:=(p_data->>'id')::uuid;rail:=p_data->>'rampex_provider';
 if mid is null or p_data->>'provider' is distinct from 'rampex' or p_data->>'mode' is distinct from 'live'
  or p_data->>'currency' is distinct from 'USD' or p_data->>'sale_scope' is distinct from 'goods'
  or coalesce(p_data->>'account_tag','') !~ '^[a-f0-9]{64}$' or p_data->>'confirmed' is distinct from 'true'
  or jsonb_typeof(p_data->'active') is distinct from 'boolean' or (p_data->>'version')::integer is null or (p_data->>'version')::integer<0
  or length(coalesce(p_actor,''))<8 or length(coalesce(p_data->>'label','')) not between 3 and 80
  or length(coalesce(p_data->>'payee','')) not between 2 and 180 or length(coalesce(p_data->>'approval_reference','')) not between 8 and 400
  or rail is null or rail not in ('rampnetwork','robinhood','topper','unlimit','bitnovo','simpleswap','mercuryo','revolut','transak','cryptix','guardarian','moonpay','banxa','alchemypay','sardine','particle','wert','simplex','utorg','transfi')
  or jsonb_typeof(p_data->'countries') is distinct from 'array' then raise exception 'Invalid Rampex configuration' using errcode='22023'; end if;
 select array_agg(value) into codes from jsonb_array_elements_text(p_data->'countries');
 if codes is null or cardinality(codes) not between 1 and 60 then raise exception 'Approved destinations required' using errcode='22023'; end if;
 foreach country in array codes loop if country is null or country !~ '^[A-Z]{2}$' then raise exception 'Invalid country' using errcode='22023'; end if; end loop;
 select * into current_method from public.commerce_payment_methods where id=mid for update;
 if found then
  select * into a from public.commerce_gateway_accounts where method_id=mid for update;
  if current_method.version is distinct from (p_data->>'version')::integer then raise exception 'Gateway changed' using errcode='40001'; end if;
  if current_method.native_provider is distinct from 'rampex' or current_method.currency is distinct from 'USD'
   or a.provider is distinct from 'rampex' or a.account_tag is distinct from p_data->>'account_tag' or a.rampex_provider is distinct from rail then
   raise exception 'Use a new route for a different Rampex account or provider' using errcode='22023'; end if;
  update public.commerce_payment_methods set label=p_data->>'label',payee=p_data->>'payee',acceptance_reference=p_data->>'approval_reference',
   active=(p_data->>'active')::boolean,sale_scope='goods',version=version+1,updated_at=now() where id=mid;
  update public.commerce_gateway_accounts set countries=codes where method_id=mid;
 else
  if (p_data->>'version')::integer is distinct from 0 then raise exception 'Unknown gateway' using errcode='P0002'; end if;
  insert into public.commerce_payment_methods(id,kind,label,currency,payee,instructions,allowed_host,acceptance_reference,active,provider_key,display_order,sale_scope,native_provider)
  values(mid,'hosted_link',p_data->>'label','USD',p_data->>'payee','Card-to-crypto payment. Review conversion, identity checks and provider fees before paying.','altapurelabs.com',p_data->>'approval_reference',(p_data->>'active')::boolean,'custom',4,'goods','rampex');
  insert into public.commerce_gateway_accounts(method_id,provider,mode,account_tag,countries,rampex_provider) values(mid,'rampex','live',p_data->>'account_tag',codes,rail);
 end if;
 insert into public.commerce_events(method_id,action,actor,details) values(mid,'native_gateway_configured',p_actor,jsonb_build_object('provider','rampex','mode','live','active',p_data->'active','countries',codes,'rampex_provider',rail));
 return jsonb_build_object('id',mid,'saved',true);
end $$;

create function public.commerce_begin_rampex_attempt(p_id uuid,p_invoice uuid,p_customer uuid,p_account_tag text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb; a public.commerce_gateway_attempts%rowtype; rail text;
begin
 result:=public.commerce_begin_gateway_attempt(p_id,p_invoice,p_customer,'sale',p_account_tag);
 select * into a from public.commerce_gateway_attempts where id=(result->>'id')::uuid for update;
 if a.provider is distinct from 'rampex' or a.mode is distinct from 'live' or a.currency is distinct from 'USD' then raise exception 'Wrong Rampex attempt' using errcode='22023'; end if;
 select rampex_provider into rail from public.commerce_gateway_accounts where method_id=a.method_id and provider='rampex' and account_tag=p_account_tag;
 if rail is null then raise exception 'Rampex route missing' using errcode='P0001'; end if;
 if result->>'claimed'='true' then update public.commerce_gateway_attempts set rampex_provider=rail where id=a.id; a.rampex_provider:=rail; end if;
 if a.rampex_provider is distinct from rail then raise exception 'Rampex provider changed' using errcode='P0001'; end if;
 return to_jsonb(a)||jsonb_build_object('claimed',result->'claimed');
end $$;

create function public.commerce_bind_rampex_link(p_id uuid,p_link text,p_redirect text,p_account_tag text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare a public.commerce_gateway_attempts%rowtype; iid uuid;
begin
 if p_link is null or p_link !~ '^[A-Za-z0-9_-]{1,160}$' or p_redirect is null or length(p_redirect)>2000
  or p_redirect !~ '^https://checkout[.]rampex[.]io/[^[:space:]#]*$' or position(chr(92) in p_redirect)>0 then raise exception 'Invalid Rampex link' using errcode='22023'; end if;
 select invoice_id into iid from public.commerce_gateway_attempts where id=p_id;
 if iid is null then raise exception 'Attempt missing' using errcode='P0002'; end if;
 perform 1 from public.commerce_invoices where id=iid for update;
 select * into a from public.commerce_gateway_attempts where id=p_id for update;
 if a.provider is distinct from 'rampex' or a.mode is distinct from 'live' or a.operation is distinct from 'sale' or a.account_tag is distinct from p_account_tag or a.rampex_provider is null then raise exception 'Wrong Rampex attempt' using errcode='22023'; end if;
 if a.rampex_link_id is not null then
  if a.rampex_link_id<>p_link or a.redirect_url is distinct from p_redirect then raise exception 'Rampex link conflict' using errcode='23505'; end if;
  return jsonb_build_object('id',a.id,'state',a.state,'replayed',true);
 end if;
 if a.state not in ('started','unknown') then raise exception 'Attempt cannot be rebound' using errcode='P0001'; end if;
 update public.commerce_gateway_attempts set rampex_link_id=p_link,redirect_url=p_redirect,state='redirected',error_code=null,updated_at=now() where id=a.id;
 insert into public.commerce_gateway_events(provider,event_key,attempt_id,outcome) values('rampex','link-bound:'||a.id::text,a.id,'redirected');
 return jsonb_build_object('id',a.id,'state','redirected','replayed',false);
end $$;

create function public.commerce_finish_rampex_payment(p_id uuid,p_link text,p_account_tag text,p_transaction text,p_amount integer,p_received integer,p_currency text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare a public.commerce_gateway_attempts%rowtype; iid uuid; result jsonb; was_paid boolean;
begin
 select invoice_id into iid from public.commerce_gateway_attempts where id=p_id;
 if iid is null then raise exception 'Attempt missing' using errcode='P0002'; end if;
 perform 1 from public.commerce_invoices where id=iid for update;
 select * into a from public.commerce_gateway_attempts where id=p_id for update;
 if a.provider is distinct from 'rampex' or a.mode is distinct from 'live' or a.operation is distinct from 'sale'
  or a.account_tag is distinct from p_account_tag or a.rampex_link_id is null or a.rampex_link_id is distinct from p_link
  or a.rampex_provider is null or a.amount_cents is distinct from p_amount or p_received is distinct from p_amount
  or a.currency is distinct from p_currency or p_currency is distinct from 'USD'
  or coalesce(p_transaction,'') !~ '^0x[a-f0-9]{64}$' then raise exception 'Rampex confirmation mismatch' using errcode='22023'; end if;
 was_paid:=a.state in ('paid','refunded');
 result:=public.commerce_finish_gateway_attempt(a.id,'rampex-paid:'||a.id::text,'approved',p_transaction,p_amount,p_currency,null,null);
 return result||jsonb_build_object('newly_paid',not was_paid and result->>'state'='paid','invoice_id',iid);
end $$;

create function public.commerce_rampex_schema_version() returns text language sql stable security invoker set search_path=pg_catalog,pg_temp as $$select 'rampex-v1'::text$$;
revoke all on function public.commerce_configure_rampex_gateway(jsonb,text),public.commerce_begin_rampex_attempt(uuid,uuid,uuid,text),public.commerce_bind_rampex_link(uuid,text,text,text),public.commerce_finish_rampex_payment(uuid,text,text,text,integer,integer,text),public.commerce_rampex_schema_version() from public,anon,authenticated;
grant execute on function public.commerce_configure_rampex_gateway(jsonb,text),public.commerce_begin_rampex_attempt(uuid,uuid,uuid,text),public.commerce_bind_rampex_link(uuid,text,text,text),public.commerce_finish_rampex_payment(uuid,text,text,text,integer,integer,text),public.commerce_rampex_schema_version() to service_role;
commit;
