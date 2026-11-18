-- Private return-address and package defaults. No customer/browser role may
-- read the personal address. Preferences never change an existing label.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table public.admin_shipping_preferences (
  id boolean primary key default true check (id),
  version integer not null default 0 check (version >= 0),
  sender jsonb,
  package_defaults jsonb,
  updated_at timestamptz,
  check (sender is null or (jsonb_typeof(sender) = 'object' and octet_length(sender::text) <= 4096)),
  -- Reject packed weight (and every other extra field) even on a direct
  -- service-role write. Weight always belongs to one order's packed parcel.
  check (package_defaults is null or (
    jsonb_typeof(package_defaults) = 'object' and octet_length(package_defaults::text) <= 1000
    and package_defaults - array['length','width','height','distance_unit','mass_unit'] = '{}'::jsonb
  ))
);
alter table public.admin_shipping_preferences enable row level security;
-- Supabase may default new tables to ALL privileges for service_role. Reset
-- those defaults too before granting only the operations this RPC needs.
revoke all on public.admin_shipping_preferences from public, anon, authenticated, service_role;
grant select, insert, update on public.admin_shipping_preferences to service_role;

-- Version zero represents no saved profile/package, with no invented values.
insert into public.admin_shipping_preferences(id) values (true);

create function public.pure_admin_shipping_preferences_save(p_scope text, p_expected_version integer, p_value jsonb)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, pg_temp as $$
declare prefs public.admin_shipping_preferences; field_name text; digits text;
begin
  if p_scope is null or p_scope not in ('sender','package') or p_expected_version is null
    or p_expected_version < 0 or p_expected_version >= 2147483647 then
    raise exception 'Invalid shipping preferences request' using errcode = '22023';
  end if;

  if p_scope = 'sender' then
    if p_value is null or jsonb_typeof(p_value) <> 'object' or octet_length(p_value::text) > 4096
      or not (p_value ?& array['name','street1','city','zip','country','phone','email'])
      or p_value - array['name','company','street1','street2','city','state','zip','country','phone','email'] <> '{}'::jsonb then
      raise exception 'Invalid sender profile' using errcode = '22023';
    end if;
    if exists(select 1 from jsonb_each(p_value) where jsonb_typeof(value) <> 'string') then
      raise exception 'Invalid sender profile fields' using errcode = '22023';
    end if;
    foreach field_name in array array['name','company','street1','street2','city','state','zip','country','phone','email'] loop
      if length(coalesce(p_value->>field_name,'')) > (case when field_name='email' then 254 else 120 end)
        or coalesce(p_value->>field_name,'') ~ '[[:cntrl:]]' then
        raise exception 'Invalid sender profile field' using errcode = '22023';
      end if;
    end loop;
    if btrim(p_value->>'name') = '' or btrim(p_value->>'street1') = '' or btrim(p_value->>'city') = '' or btrim(p_value->>'zip') = ''
      or p_value->>'country' !~ '^[A-Z]{2}$'
      or (p_value->>'country' in ('CA','US') and btrim(coalesce(p_value->>'state','')) = '')
      or p_value->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
      or p_value->>'phone' !~ '^[+]?[0-9(). -]+$' then
      raise exception 'Complete the sender address and contact details' using errcode = '22023';
    end if;
    digits := regexp_replace(p_value->>'phone', '[^0-9]', '', 'g');
    if length(digits) < 7 or length(digits) > 15 then
      raise exception 'Invalid sender phone number' using errcode = '22023';
    end if;
  else
    if p_value is null or jsonb_typeof(p_value) = 'null' then
      p_value := null;
    else
      if jsonb_typeof(p_value) <> 'object' or octet_length(p_value::text) > 1000
        or not (p_value ?& array['length','width','height','distance_unit','mass_unit'])
        or p_value - array['length','width','height','distance_unit','mass_unit'] <> '{}'::jsonb
        or p_value->>'distance_unit' not in ('in','cm') or p_value->>'mass_unit' not in ('lb','oz','g','kg') then
        raise exception 'Invalid package defaults; packed weight must be entered per order' using errcode = '22023';
      end if;
      if exists(select 1 from jsonb_each(p_value) where jsonb_typeof(value) <> 'string') then
        raise exception 'Invalid package default fields' using errcode = '22023';
      end if;
      foreach field_name in array array['length','width','height'] loop
        if p_value->>field_name !~ '^[0-9]+([.][0-9]{1,4})?$' then
          raise exception 'Invalid package dimensions' using errcode = '22023';
        end if;
        if (p_value->>field_name)::numeric <= 0 or (p_value->>field_name)::numeric > 300 then
          raise exception 'Invalid package dimensions' using errcode = '22023';
        end if;
      end loop;
    end if;
  end if;

  select * into prefs from public.admin_shipping_preferences where id = true for update;
  if not found or prefs.version <> p_expected_version then
    raise exception 'Shipping preferences changed; reload before saving' using errcode = '40001';
  end if;
  update public.admin_shipping_preferences set
    sender = case when p_scope = 'sender' then p_value else sender end,
    package_defaults = case when p_scope = 'package' then p_value else package_defaults end,
    version = version + 1,
    updated_at = clock_timestamp()
  where id = true returning * into prefs;
  return to_jsonb(prefs);
end $$;
revoke all on function public.pure_admin_shipping_preferences_save(text,integer,jsonb) from public, anon, authenticated;
grant execute on function public.pure_admin_shipping_preferences_save(text,integer,jsonb) to service_role;

commit;
