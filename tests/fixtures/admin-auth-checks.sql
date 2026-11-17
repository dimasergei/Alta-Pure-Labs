-- Run after the passwordless migration. Synthetic records are always rolled back.
begin;
do $$
begin
  if has_schema_privilege('anon','pure_admin','USAGE')
     or has_schema_privilege('authenticated','pure_admin','USAGE') then
    raise exception 'Browser roles must not access the private auth schema';
  end if;
  if has_function_privilege('anon','public.pure_admin_request_login(text,text,text,timestamptz)','EXECUTE')
     or has_function_privilege('authenticated','public.pure_admin_create_session(text,text,timestamptz,text)','EXECUTE')
     or has_function_privilege('anon','public.pure_admin_get_session(text,text)','EXECUTE')
     or has_function_privilege('authenticated','public.pure_admin_revoke_session(text)','EXECUTE') then
    raise exception 'Browser roles must not execute authentication RPCs';
  end if;
end;
$$;
set local role service_role;
do $$
declare result text; valid boolean; records integer;
begin
  result := public.pure_admin_request_login(repeat('1',64),repeat('2',64),repeat('3',64),now()+interval '5 minutes');
  if result <> 'created' then raise exception 'Initial request was rejected'; end if;
  result := public.pure_admin_request_login(repeat('4',64),repeat('2',64),repeat('3',64),now()+interval '5 minutes');
  if result <> 'rate_limited' then raise exception 'Recipient cooldown did not apply'; end if;
  valid := public.pure_admin_create_session(repeat('5',64),repeat('2',64),now()+interval '7 days',repeat('1',64));
  if not valid then raise exception 'Valid nonce was rejected'; end if;
  valid := public.pure_admin_create_session(repeat('6',64),repeat('2',64),now()+interval '7 days',repeat('1',64));
  if valid then raise exception 'Consumed nonce was replayed'; end if;
  select count(*) into records from public.pure_admin_get_session(repeat('5',64),repeat('2',64));
  if records <> 1 then raise exception 'Issued session was not verified'; end if;
  select count(*) into records from public.pure_admin_get_session(repeat('5',64),repeat('7',64));
  if records <> 0 then raise exception 'Session accepted for the wrong owner'; end if;
  perform public.pure_admin_revoke_session(repeat('5',64));
  select count(*) into records from public.pure_admin_get_session(repeat('5',64),repeat('2',64));
  if records <> 0 then raise exception 'Revoked session was accepted'; end if;
  insert into pure_admin.login_requests(nonce_hash,owner_hash,ip_hash,created_at,expires_at)
    values(repeat('8',64),repeat('2',64),repeat('3',64),now()-interval '20 minutes',now()-interval '10 minutes');
  valid := public.pure_admin_create_session(repeat('9',64),repeat('2',64),now()+interval '7 days',repeat('8',64));
  if valid then raise exception 'Expired nonce was accepted'; end if;
  insert into pure_admin.sessions(session_hash,owner_hash,created_at,expires_at)
    values(repeat('a',64),repeat('2',64),now()-interval '8 days',now()-interval '1 day');
  select count(*) into records from public.pure_admin_get_session(repeat('a',64),repeat('2',64));
  if records <> 0 then raise exception 'Expired session was accepted'; end if;
end;
$$;
rollback;
