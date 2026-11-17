-- Owner-managed admin password. Only server-side service_role can reach these
-- records/functions. Password setup consumes an emailed proof atomically.
alter table pure_admin.login_requests add column purpose text not null default 'sign_in'
  check (purpose in ('sign_in','password_setup'));

create table pure_admin.credentials (
  owner_hash text primary key check (owner_hash ~ '^[a-f0-9]{64}$'),
  password_hash text not null check (password_hash ~ '^scrypt-v1\$[a-f0-9]{32}\$[a-f0-9]{128}$'),
  updated_at timestamptz not null default now()
);
create table pure_admin.password_attempts (
  id bigint generated always as identity primary key,
  owner_hash text not null check (owner_hash ~ '^[a-f0-9]{64}$'),
  ip_hash text not null check (ip_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now()
);
create index pure_admin_password_attempt_owner on pure_admin.password_attempts(owner_hash,created_at desc);
create index pure_admin_password_attempt_ip on pure_admin.password_attempts(ip_hash,created_at desc);
alter table pure_admin.credentials enable row level security;
alter table pure_admin.password_attempts enable row level security;
revoke all on pure_admin.credentials, pure_admin.password_attempts from public,anon,authenticated;
grant select,insert,update,delete on pure_admin.credentials,pure_admin.password_attempts to service_role;
grant usage,select on sequence pure_admin.password_attempts_id_seq to service_role;

create function public.pure_admin_password_status(p_owner_hash text)
returns boolean language sql stable security invoker set search_path=pg_catalog,pg_temp as $$
  select exists(select 1 from pure_admin.credentials where owner_hash=p_owner_hash);
$$;

create function public.pure_admin_get_password(p_owner_hash text)
returns table(password_hash text) language sql stable security invoker set search_path=pg_catalog,pg_temp as $$
  select c.password_hash from pure_admin.credentials c where c.owner_hash=p_owner_hash;
$$;

create function public.pure_admin_password_attempt(p_owner_hash text,p_ip_hash text)
returns boolean language plpgsql security invoker set search_path=pg_catalog,pg_temp as $$
begin
  if p_owner_hash is null or p_owner_hash !~ '^[a-f0-9]{64}$'
     or p_ip_hash is null or p_ip_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid password attempt'; end if;
  perform pg_advisory_xact_lock(hashtextextended('pure-admin-password:'||p_owner_hash,0));
  perform pg_advisory_xact_lock(hashtextextended('pure-admin-password-ip:'||p_ip_hash,0));
  delete from pure_admin.password_attempts where created_at < now()-interval '1 day';
  if (select count(*) from pure_admin.password_attempts where owner_hash=p_owner_hash and created_at>now()-interval '15 minutes')>=10
     or (select count(*) from pure_admin.password_attempts where ip_hash=p_ip_hash and created_at>now()-interval '15 minutes')>=10 then
    return false;
  end if;
  insert into pure_admin.password_attempts(owner_hash,ip_hash) values(p_owner_hash,p_ip_hash);
  return true;
end;
$$;

create function public.pure_admin_request_password_setup(p_nonce_hash text,p_owner_hash text,p_ip_hash text,p_expires_at timestamptz)
returns text language plpgsql security invoker set search_path=pg_catalog,pg_temp as $$
begin
  if p_nonce_hash is null or p_nonce_hash !~ '^[a-f0-9]{64}$'
     or p_owner_hash is null or p_owner_hash !~ '^[a-f0-9]{64}$'
     or p_ip_hash is null or p_ip_hash !~ '^[a-f0-9]{64}$'
     or p_expires_at is null or p_expires_at<=now() or p_expires_at>now()+interval '31 minutes' then
    raise exception 'Invalid password setup request';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('pure-admin-login:'||p_owner_hash,0));
  perform pg_advisory_xact_lock(hashtextextended('pure-admin-setup-ip:'||p_ip_hash,0));
  delete from pure_admin.login_requests where created_at<now()-interval '1 day';
  if exists(select 1 from pure_admin.login_requests where owner_hash=p_owner_hash and created_at>now()-interval '1 minute')
     or (select count(*) from pure_admin.login_requests where owner_hash=p_owner_hash and created_at>now()-interval '15 minutes')>=5
     or (select count(*) from pure_admin.login_requests where ip_hash=p_ip_hash and created_at>now()-interval '15 minutes')>=3 then
    return 'rate_limited';
  end if;
  insert into pure_admin.login_requests(nonce_hash,owner_hash,ip_hash,expires_at,purpose)
    values(p_nonce_hash,p_owner_hash,p_ip_hash,p_expires_at,'password_setup');
  return 'created';
end;
$$;

create function public.pure_admin_password_setup_valid(p_nonce_hash text,p_owner_hash text)
returns boolean language sql stable security invoker set search_path=pg_catalog,pg_temp as $$
  select exists(select 1 from pure_admin.login_requests where nonce_hash=p_nonce_hash and owner_hash=p_owner_hash
    and purpose='password_setup' and consumed_at is null and expires_at>now());
$$;

create function public.pure_admin_create_password_session(p_session_hash text,p_owner_hash text,p_expires_at timestamptz,p_password_hash text)
returns boolean language plpgsql security invoker set search_path=pg_catalog,pg_temp as $$
begin
  if p_session_hash is null or p_session_hash !~ '^[a-f0-9]{64}$'
     or p_owner_hash is null or p_owner_hash !~ '^[a-f0-9]{64}$'
     or p_expires_at is null or p_expires_at<=now() or p_expires_at>now()+interval '7 days 1 minute' then
    raise exception 'Invalid admin session';
  end if;
  -- Serialize with password reset and compare the exact credential that was
  -- verified in Node. A concurrent password change cannot issue a stale session.
  perform pg_advisory_xact_lock(hashtextextended('pure-admin-password:'||p_owner_hash,0));
  if not exists(select 1 from pure_admin.credentials where owner_hash=p_owner_hash and password_hash=p_password_hash) then return false; end if;
  insert into pure_admin.sessions(session_hash,owner_hash,expires_at) values(p_session_hash,p_owner_hash,p_expires_at);
  delete from pure_admin.password_attempts where owner_hash=p_owner_hash;
  delete from pure_admin.sessions where expires_at<now()-interval '1 day';
  return true;
end;
$$;

create function public.pure_admin_set_password(p_nonce_hash text,p_owner_hash text,p_password_hash text,p_session_hash text,p_expires_at timestamptz)
returns boolean language plpgsql security invoker set search_path=pg_catalog,pg_temp as $$
declare consumed integer;
begin
  if p_nonce_hash is null or p_nonce_hash !~ '^[a-f0-9]{64}$'
     or p_owner_hash is null or p_owner_hash !~ '^[a-f0-9]{64}$'
     or p_session_hash is null or p_session_hash !~ '^[a-f0-9]{64}$'
     or p_password_hash is null or p_password_hash !~ '^scrypt-v1\$[a-f0-9]{32}\$[a-f0-9]{128}$'
     or p_expires_at is null or p_expires_at<=now() or p_expires_at>now()+interval '7 days 1 minute' then
    raise exception 'Invalid password setup';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('pure-admin-password:'||p_owner_hash,0));
  update pure_admin.login_requests set consumed_at=now() where nonce_hash=p_nonce_hash and owner_hash=p_owner_hash
    and purpose='password_setup' and consumed_at is null and expires_at>now();
  get diagnostics consumed=row_count;
  if consumed<>1 then return false; end if;
  insert into pure_admin.credentials(owner_hash,password_hash) values(p_owner_hash,p_password_hash)
    on conflict(owner_hash) do update set password_hash=excluded.password_hash,updated_at=now();
  update pure_admin.sessions set revoked_at=now() where owner_hash=p_owner_hash and revoked_at is null;
  update pure_admin.login_requests set consumed_at=now() where owner_hash=p_owner_hash and consumed_at is null;
  delete from pure_admin.password_attempts where owner_hash=p_owner_hash;
  insert into pure_admin.sessions(session_hash,owner_hash,expires_at) values(p_session_hash,p_owner_hash,p_expires_at);
  return true;
end;
$$;

revoke all on function public.pure_admin_password_status(text) from public,anon,authenticated;
revoke all on function public.pure_admin_get_password(text) from public,anon,authenticated;
revoke all on function public.pure_admin_password_attempt(text,text) from public,anon,authenticated;
revoke all on function public.pure_admin_request_password_setup(text,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.pure_admin_password_setup_valid(text,text) from public,anon,authenticated;
revoke all on function public.pure_admin_create_password_session(text,text,timestamptz,text) from public,anon,authenticated;
revoke all on function public.pure_admin_set_password(text,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.pure_admin_password_status(text) to service_role;
grant execute on function public.pure_admin_get_password(text) to service_role;
grant execute on function public.pure_admin_password_attempt(text,text) to service_role;
grant execute on function public.pure_admin_request_password_setup(text,text,text,timestamptz) to service_role;
grant execute on function public.pure_admin_password_setup_valid(text,text) to service_role;
grant execute on function public.pure_admin_create_password_session(text,text,timestamptz,text) to service_role;
grant execute on function public.pure_admin_set_password(text,text,text,text,timestamptz) to service_role;
