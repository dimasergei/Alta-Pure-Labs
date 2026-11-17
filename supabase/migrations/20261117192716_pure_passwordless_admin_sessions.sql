-- PURE owner sign-in: no plaintext login tokens, no browser-readable session rows.
create schema if not exists pure_admin;
revoke all on schema pure_admin from public, anon, authenticated;
grant usage on schema pure_admin to service_role;

create table pure_admin.login_requests (
  nonce_hash text primary key check (nonce_hash ~ '^[a-f0-9]{64}$'),
  owner_hash text not null check (owner_hash ~ '^[a-f0-9]{64}$'),
  ip_hash text not null check (ip_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  check (expires_at > created_at)
);
create index pure_admin_login_owner_recent on pure_admin.login_requests (owner_hash, created_at desc);
create index pure_admin_login_ip_recent on pure_admin.login_requests (ip_hash, created_at desc);

create table pure_admin.sessions (
  session_hash text primary key check (session_hash ~ '^[a-f0-9]{64}$'),
  owner_hash text not null check (owner_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  check (expires_at > created_at)
);
create index pure_admin_session_expiry on pure_admin.sessions (expires_at);

alter table pure_admin.login_requests enable row level security;
alter table pure_admin.sessions enable row level security;
revoke all on pure_admin.login_requests, pure_admin.sessions from public, anon, authenticated;
grant select, insert, update, delete on pure_admin.login_requests, pure_admin.sessions to service_role;

create function public.pure_admin_request_login(
  p_nonce_hash text, p_owner_hash text, p_ip_hash text, p_expires_at timestamptz
) returns text language plpgsql security invoker set search_path = pg_catalog, pg_temp as $$
begin
  if p_nonce_hash is null or p_nonce_hash !~ '^[a-f0-9]{64}$'
     or p_owner_hash is null or p_owner_hash !~ '^[a-f0-9]{64}$'
     or p_ip_hash is null or p_ip_hash !~ '^[a-f0-9]{64}$'
     or p_expires_at is null or p_expires_at <= now()
     or p_expires_at > now() + interval '11 minutes' then
    raise exception 'Invalid sign-in request';
  end if;
  -- Serialize the recipient throttle, including simultaneous requests from many IPs.
  perform pg_advisory_xact_lock(hashtextextended('pure-admin-login:' || p_owner_hash, 0));
  delete from pure_admin.login_requests where created_at < now() - interval '1 day';
  if exists (
    select 1 from pure_admin.login_requests
    where owner_hash = p_owner_hash and created_at > now() - interval '1 minute'
  ) or (
    select count(*) from pure_admin.login_requests
    where owner_hash = p_owner_hash and created_at > now() - interval '15 minutes'
  ) >= 5 or (
    select count(*) from pure_admin.login_requests
    where ip_hash = p_ip_hash and created_at > now() - interval '15 minutes'
  ) >= 3 then
    return 'rate_limited';
  end if;
  insert into pure_admin.login_requests(nonce_hash, owner_hash, ip_hash, expires_at)
    values (p_nonce_hash, p_owner_hash, p_ip_hash, p_expires_at);
  return 'created';
end;
$$;

create function public.pure_admin_create_session(
  p_session_hash text, p_owner_hash text, p_expires_at timestamptz, p_nonce_hash text default null
) returns boolean language plpgsql security invoker set search_path = pg_catalog, pg_temp as $$
declare consumed integer;
begin
  if p_session_hash is null or p_session_hash !~ '^[a-f0-9]{64}$'
     or p_owner_hash is null or p_owner_hash !~ '^[a-f0-9]{64}$'
     or p_expires_at is null or p_expires_at <= now()
     or p_expires_at > now() + interval '7 days 1 minute' then
    raise exception 'Invalid admin session';
  end if;
  if p_nonce_hash is not null then
    if p_nonce_hash !~ '^[a-f0-9]{64}$' then return false; end if;
    update pure_admin.login_requests set consumed_at = now()
      where nonce_hash = p_nonce_hash and owner_hash = p_owner_hash
        and consumed_at is null and expires_at > now();
    get diagnostics consumed = row_count;
    if consumed <> 1 then return false; end if;
  end if;
  -- The nonce update and session insert commit atomically; concurrent replay loses.
  insert into pure_admin.sessions(session_hash, owner_hash, expires_at)
    values (p_session_hash, p_owner_hash, p_expires_at);
  delete from pure_admin.sessions where expires_at < now() - interval '1 day';
  return true;
end;
$$;

create function public.pure_admin_get_session(p_session_hash text, p_owner_hash text)
returns table(expires_at timestamptz) language sql stable security invoker
set search_path = pg_catalog, pg_temp as $$
  select s.expires_at from pure_admin.sessions s
    where s.session_hash = p_session_hash and s.owner_hash = p_owner_hash
      and s.revoked_at is null and s.expires_at > now();
$$;

create function public.pure_admin_revoke_session(p_session_hash text)
returns boolean language plpgsql security invoker set search_path = pg_catalog, pg_temp as $$
begin
  update pure_admin.sessions set revoked_at = now()
    where session_hash = p_session_hash and revoked_at is null;
  return true;
end;
$$;

revoke all on function public.pure_admin_request_login(text,text,text,timestamptz) from public, anon, authenticated;
revoke all on function public.pure_admin_create_session(text,text,timestamptz,text) from public, anon, authenticated;
revoke all on function public.pure_admin_get_session(text,text) from public, anon, authenticated;
revoke all on function public.pure_admin_revoke_session(text) from public, anon, authenticated;
grant execute on function public.pure_admin_request_login(text,text,text,timestamptz) to service_role;
grant execute on function public.pure_admin_create_session(text,text,timestamptz,text) to service_role;
grant execute on function public.pure_admin_get_session(text,text) to service_role;
grant execute on function public.pure_admin_revoke_session(text) to service_role;
