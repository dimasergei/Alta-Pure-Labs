-- Allow a dedicated Rampex Stripe route, without changing any existing payment links or order status.
-- Existing inactive multi-hosted methods remain intact for historical callback reconciliation.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
alter table public.commerce_gateway_accounts drop constraint rampex_account_rail_check;
alter table public.commerce_gateway_accounts add constraint rampex_account_rail_check
  check (provider <> 'rampex' or (rampex_provider is not null and
   rampex_provider in ('hosted','stripe','rampnetwork','robinhood','topper','unlimit','bitnovo',
   'simpleswap','mercuryo','revolut','transak','cryptix','guardarian','moonpay','banxa',
   'alchemypay','sardine','particle','wert','simplex','utorg','transfi')));
create or replace function public.commerce_configure_rampex_gateway(p_data jsonb,p_actor text)
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
  or rail is null or rail not in ('hosted','stripe','rampnetwork','robinhood','topper','unlimit','bitnovo','simpleswap','mercuryo','revolut','transak','cryptix','guardarian','moonpay','banxa','alchemypay','sardine','particle','wert','simplex','utorg','transfi')
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


-- Explicitly preserve backend-only permissions.
revoke all on function public.commerce_configure_rampex_gateway(jsonb,text) from public,anon,authenticated;
grant execute on function public.commerce_configure_rampex_gateway(jsonb,text) to service_role;
commit;
