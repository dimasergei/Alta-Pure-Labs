-- Additive customer-request inbox and leased notification outbox.
-- No orders, payments, inventory, existing grants, or customer balances are changed.
create table public.enterprise_customer_requests (
 id uuid primary key,
 content_digest text not null check (content_digest ~ '^[a-f0-9]{64}$'),
 kind text not null check (kind in ('contact','bulk','partner','updates')),
 customer_email text not null check (length(customer_email) between 3 and 254 and customer_email=lower(trim(customer_email))),
 customer_name text not null check (length(trim(customer_name)) between 1 and 120),
 payload jsonb not null check (jsonb_typeof(payload)='object' and octet_length(payload::text)<=24000),
 consent_version text not null default 'inquiry-2026-11-v1',
 consent_at timestamptz not null default now(),
 marketing_opt_in boolean not null default false,
 status text not null default 'new' check (status in ('new','in_review','waiting_customer','resolved','spam')),
 assigned_to text,
 public_reply text not null default '' check (length(public_reply)<=4000),
 version integer not null default 1 check (version>0),
 email_status text not null default 'queued' check (email_status in ('queued','sending','accepted','failed','needs_review')),
 email_payload jsonb,
 email_attempts integer not null default 0 check (email_attempts between 0 and 5),
 first_email_attempt_at timestamptz,
 email_lease_until timestamptz,
 email_claim uuid,
 provider_email_id text,
 last_email_error text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index enterprise_requests_email_created_idx on public.enterprise_customer_requests(customer_email,created_at desc);
create index enterprise_requests_status_created_idx on public.enterprise_customer_requests(status,created_at desc);
create index enterprise_requests_delivery_idx on public.enterprise_customer_requests(email_status,created_at);
create table public.enterprise_customer_request_events (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null references public.enterprise_customer_requests(id) on delete restrict,
 kind text not null check (kind in ('submitted','status_changed','email_claimed','email_accepted','email_failed','email_review_required')),
 actor_reference text not null check (length(actor_reference) between 2 and 180),
 details jsonb not null default '{}'::jsonb check (jsonb_typeof(details)='object' and octet_length(details::text)<=8000),
 created_at timestamptz not null default now()
);
create index enterprise_request_events_request_idx on public.enterprise_customer_request_events(request_id,created_at desc);
alter table public.enterprise_customer_requests enable row level security;
alter table public.enterprise_customer_request_events enable row level security;
revoke all on public.enterprise_customer_requests,public.enterprise_customer_request_events from public,anon,authenticated,service_role;
grant select on public.enterprise_customer_requests,public.enterprise_customer_request_events to service_role;

create function public.enterprise_submit_customer_request(p_id uuid,p_digest text,p_payload jsonb,p_email_payload jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare r public.enterprise_customer_requests%rowtype; added integer;
begin
 if p_id is null or p_digest is null or p_digest !~ '^[a-f0-9]{64}$' or p_payload is null
  or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>24000
  or coalesce(p_payload->>'type','') not in ('contact','bulk','partner','updates')
  or coalesce(p_payload->>'consent','')<>'true'
  or coalesce(p_payload->>'email','') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  or length(coalesce(p_payload->>'email',''))>254
  or length(trim(coalesce(p_payload->>'name',''))) not between 1 and 120
  or (p_email_payload is not null and (jsonb_typeof(p_email_payload)<>'object' or octet_length(p_email_payload::text)>30000)) then
  raise exception 'Invalid customer request' using errcode='22023';
 end if;
 insert into public.enterprise_customer_requests(id,content_digest,kind,customer_email,customer_name,payload,marketing_opt_in,email_payload)
 values(p_id,p_digest,p_payload->>'type',lower(trim(p_payload->>'email')),trim(p_payload->>'name'),p_payload,(p_payload->>'type'='updates'),p_email_payload)
 on conflict(id) do nothing;
 get diagnostics added = row_count;
 select * into r from public.enterprise_customer_requests where id=p_id for update;
 if r.content_digest<>p_digest then raise exception 'Request identifier already used' using errcode='23505'; end if;
 if added=1 then
  insert into public.enterprise_customer_request_events(request_id,kind,actor_reference,details)
  values(p_id,'submitted','public-inquiry',jsonb_build_object('kind',r.kind,'marketing_opt_in',r.marketing_opt_in));
 end if;
 return jsonb_build_object('id',r.id,'created',added=1,'email_status',r.email_status);
end $$;

create function public.enterprise_claim_request_email(p_id uuid,p_email_payload jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare r public.enterprise_customer_requests%rowtype; claim uuid;
begin
 if p_id is null then raise exception 'Request required' using errcode='22023'; end if;
 select * into r from public.enterprise_customer_requests where id=p_id for update;
 if not found then raise exception 'Request not found' using errcode='P0002'; end if;
 if r.email_status in ('accepted','needs_review') or r.status='spam' then return jsonb_build_object('claimed',false,'email_status',r.email_status); end if;
 if r.email_status='sending' and r.email_lease_until>now() then return jsonb_build_object('claimed',false,'email_status','sending'); end if;
 -- Provider idempotency lasts 24 hours. Stop before that window rather than risk duplicate delivery.
 if r.email_attempts>=5 or (r.first_email_attempt_at is not null and r.first_email_attempt_at < now()-interval '23 hours') then
  update public.enterprise_customer_requests set email_status='needs_review',email_claim=null,email_lease_until=null,updated_at=now() where id=p_id;
  insert into public.enterprise_customer_request_events(request_id,kind,actor_reference,details)
  values(p_id,'email_review_required','notification-worker',jsonb_build_object('reason','retry_window_or_attempt_limit'));
  return jsonb_build_object('claimed',false,'email_status','needs_review');
 end if;
 if r.email_payload is null then
  if p_email_payload is null or jsonb_typeof(p_email_payload)<>'object' or octet_length(p_email_payload::text)>30000 then
   return jsonb_build_object('claimed',false,'email_status','queued');
  end if;
  r.email_payload:=p_email_payload;
 end if;
 claim:=gen_random_uuid();
 update public.enterprise_customer_requests set email_status='sending',email_payload=r.email_payload,
  email_attempts=email_attempts+1,first_email_attempt_at=coalesce(first_email_attempt_at,now()),
  email_claim=claim,email_lease_until=now()+interval '90 seconds',updated_at=now() where id=p_id;
 insert into public.enterprise_customer_request_events(request_id,kind,actor_reference,details)
 values(p_id,'email_claimed','notification-worker',jsonb_build_object('attempt',r.email_attempts+1));
 return jsonb_build_object('claimed',true,'claim',claim,'email_payload',r.email_payload,'email_status','sending');
end $$;

create function public.enterprise_finish_request_email(p_id uuid,p_claim uuid,p_outcome text,p_provider_id text,p_error text)
returns boolean language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare r public.enterprise_customer_requests%rowtype;
begin
 if p_id is null or p_claim is null or p_outcome is null or p_outcome not in ('accepted','failed')
  or length(coalesce(p_provider_id,''))>180 or length(coalesce(p_error,''))>180
  or (p_outcome='accepted' and length(coalesce(p_provider_id,''))<2) then
  raise exception 'Invalid delivery result' using errcode='22023';
 end if;
 select * into r from public.enterprise_customer_requests where id=p_id for update;
 if not found or r.email_status<>'sending' or r.email_claim is distinct from p_claim then return false; end if;
 update public.enterprise_customer_requests set email_status=p_outcome,provider_email_id=p_provider_id,
  last_email_error=case when p_outcome='failed' then p_error else null end,email_claim=null,email_lease_until=null,updated_at=now() where id=p_id;
 insert into public.enterprise_customer_request_events(request_id,kind,actor_reference,details)
 values(p_id,case when p_outcome='accepted' then 'email_accepted' else 'email_failed' end,'notification-worker',
  jsonb_build_object('outcome',p_outcome,'provider_id',p_provider_id,'error_code',p_error));
 return true;
end $$;

create function public.enterprise_update_customer_request(p_id uuid,p_expected_version integer,p_status text,p_note text,p_public_reply text,p_assigned_to text,p_actor text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare r public.enterprise_customer_requests%rowtype;
begin
 if p_id is null or p_expected_version is null or p_expected_version<1 or p_status is null
  or p_status not in ('new','in_review','waiting_customer','resolved','spam')
  or length(trim(coalesce(p_note,''))) not between 3 and 2000
  or length(coalesce(p_public_reply,''))>4000 or length(coalesce(p_assigned_to,''))>120
  or length(trim(coalesce(p_actor,''))) not between 2 and 180 then
  raise exception 'Invalid request update' using errcode='22023';
 end if;
 select * into r from public.enterprise_customer_requests where id=p_id for update;
 if not found then raise exception 'Request not found' using errcode='P0002'; end if;
 if r.version<>p_expected_version then raise exception 'Request changed; reload before saving' using errcode='40001'; end if;
 update public.enterprise_customer_requests set status=p_status,public_reply=coalesce(p_public_reply,''),
  assigned_to=nullif(trim(coalesce(p_assigned_to,'')),''),version=version+1,updated_at=now() where id=p_id;
 insert into public.enterprise_customer_request_events(request_id,kind,actor_reference,details)
 values(p_id,'status_changed',p_actor,jsonb_build_object('previous_status',r.status,'next_status',p_status,
  'note',trim(p_note),'public_reply_changed',r.public_reply is distinct from coalesce(p_public_reply,''),'assigned_to',p_assigned_to,'version',r.version+1));
 return jsonb_build_object('id',p_id,'status',p_status,'version',r.version+1);
end $$;

revoke all on function public.enterprise_submit_customer_request(uuid,text,jsonb,jsonb),
 public.enterprise_claim_request_email(uuid,jsonb),public.enterprise_finish_request_email(uuid,uuid,text,text,text),
 public.enterprise_update_customer_request(uuid,integer,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.enterprise_submit_customer_request(uuid,text,jsonb,jsonb),
 public.enterprise_claim_request_email(uuid,jsonb),public.enterprise_finish_request_email(uuid,uuid,text,text,text),
 public.enterprise_update_customer_request(uuid,integer,text,text,text,text,text) to service_role;
