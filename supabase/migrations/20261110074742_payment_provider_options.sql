-- Adds named payment-provider choices and order preference. No receiving account is created.
alter table public.commerce_payment_methods
 add column provider_key text not null default 'custom' check(provider_key in ('interac','bank_transfer','paypal','stripe','btcpay','nowpayments','custom')),
 add column display_order integer not null default 100 check(display_order between 0 and 999),
 add column sale_scope text not null default 'both' check(sale_scope in ('goods','membership','both'));
update public.commerce_payment_methods set provider_key=kind where kind in ('interac','bank_transfer');

create function public.commerce_provider_command(p_action text,p_data jsonb,p_actor text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare v_id uuid; v_provider text; v_order integer; v_scope text; v_url text; v_prefix text;
 m public.commerce_payment_methods%rowtype; i public.commerce_invoices%rowtype; result jsonb;
begin
 if p_data is null or jsonb_typeof(p_data)<>'object' or length(coalesce(p_actor,'')) not between 8 and 180 then raise exception 'Invalid provider operation' using errcode='22023'; end if;
 v_id:=(p_data->>'id')::uuid;
 if v_id is null then raise exception 'ID required' using errcode='22023'; end if;
 if p_action='save_method' then
  v_provider:=p_data->>'provider_key'; v_order:=(p_data->>'display_order')::integer; v_scope:=p_data->>'sale_scope';
  if v_provider is null or v_provider not in ('interac','bank_transfer','paypal','stripe','btcpay','nowpayments','custom')
   or v_order is null or v_order not between 0 and 999 or v_scope is null or v_scope not in ('goods','membership','both')
   or (v_provider in ('interac','bank_transfer') and p_data->>'kind' is distinct from v_provider)
   or (v_provider not in ('interac','bank_transfer') and p_data->>'kind' is distinct from 'hosted_link') then raise exception 'Invalid provider settings' using errcode='22023'; end if;
  if (v_provider='paypal' and p_data->>'allowed_host' not in ('paypal.com','www.paypal.com'))
   or (v_provider='stripe' and p_data->>'allowed_host' not in ('invoice.stripe.com','pay.stripe.com'))
   or (v_provider='nowpayments' and p_data->>'allowed_host'<>'nowpayments.io') then raise exception 'Provider hostname mismatch' using errcode='22023'; end if;
  select * into m from public.commerce_payment_methods where id=v_id for update;
  if found and m.provider_key<>v_provider then raise exception 'Create a separate method for a different provider' using errcode='P0001'; end if;
  result:=public.commerce_admin_command(p_action,p_data,p_actor);
  update public.commerce_payment_methods set provider_key=v_provider,display_order=v_order,sale_scope=v_scope where id=v_id;
  insert into public.commerce_events(method_id,action,actor,details) values(v_id,'provider_settings_saved',p_actor,jsonb_build_object('provider',v_provider,'display_order',v_order,'sale_scope',v_scope));
  return result;
 elsif p_action in ('set_method_priority','pause_method') then
  select * into m from public.commerce_payment_methods where id=v_id for update;
  if not found then raise exception 'Method not found' using errcode='P0002'; end if;
  if (p_data->>'version')::integer is distinct from m.version then raise exception 'Method changed' using errcode='40001'; end if;
  v_order:=(p_data->>'display_order')::integer;
  if p_action='set_method_priority' and (v_order is null or v_order not between 0 and 999) then raise exception 'Invalid priority' using errcode='22023'; end if;
  update public.commerce_payment_methods set display_order=case when p_action='set_method_priority' then v_order else display_order end,
   active=case when p_action='pause_method' then false else active end,version=version+1,updated_at=now() where id=v_id;
  insert into public.commerce_events(method_id,action,actor,details) values(v_id,p_action,p_actor,jsonb_build_object('previous_version',m.version,'display_order',v_order));
  return jsonb_build_object('id',v_id,'updated',true,'version',m.version+1);
 elsif p_action='issue' then
  select * into m from public.commerce_payment_methods where id=(p_data->>'method_id')::uuid for share;
  if not found or not m.active then raise exception 'Method unavailable' using errcode='P0001'; end if;
  if (p_data->>'method_version')::integer is distinct from m.version then raise exception 'Method changed; preview again' using errcode='40001'; end if;
  select * into i from public.commerce_invoices where id=v_id;
  if not found then raise exception 'Invoice not found' using errcode='P0002'; end if;
  if m.sale_scope<>'both' and m.sale_scope<>i.kind then raise exception 'This method is not configured for this sale type' using errcode='P0001'; end if;
  if m.kind='hosted_link' then
   v_url:=p_data->>'payment_url';v_prefix:='https://'||m.allowed_host||'/';
   if v_url is null or left(v_url,length(v_prefix))<>v_prefix or v_url ~ '[[:space:]\\]' then raise exception 'Hosted payment hostname mismatch' using errcode='22023'; end if;
   if m.provider_key='paypal' and v_url !~ '^https://(www\.)?paypal\.com/invoice/(p|view)(/|#)' then raise exception 'PayPal business invoice required' using errcode='22023'; end if;
   if m.provider_key='stripe' and (v_url !~ '^https://(invoice\.stripe\.com/i|pay\.stripe\.com/invoice)/acct_[A-Za-z0-9]+/live_' or v_url like '%/test_%') then raise exception 'Live Stripe invoice required' using errcode='22023'; end if;
   if m.provider_key='btcpay' and substring(v_url from length('https://'||m.allowed_host)+1) !~ '^/i/[A-Za-z0-9_-]{6,}' then raise exception 'BTCPay invoice required' using errcode='22023'; end if;
   if m.provider_key='nowpayments' and v_url !~ '^https://nowpayments\.io/payment/?\?([^#]*&)?iid=[0-9]+' then raise exception 'NOWPayments invoice required' using errcode='22023'; end if;
  end if;
  result:=public.commerce_admin_command(p_action,p_data,p_actor);
  update public.commerce_invoices set payment_snapshot=payment_snapshot||jsonb_build_object('provider_key',m.provider_key,'display_order',m.display_order) where id=v_id;
  return result;
 end if;
 raise exception 'Unsupported provider command' using errcode='22023';
end $$;
revoke all on function public.commerce_provider_command(text,jsonb,text) from public,anon,authenticated;
grant execute on function public.commerce_provider_command(text,jsonb,text) to service_role;
