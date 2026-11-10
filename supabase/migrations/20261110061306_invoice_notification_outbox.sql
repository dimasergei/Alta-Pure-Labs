-- Transactional notifications for NEW invoice events only. No historical backfill.
create schema if not exists commerce_internal;
revoke all on schema commerce_internal from public,anon,authenticated,service_role;
create table public.commerce_notifications (
 id uuid primary key default gen_random_uuid(),
 event_id uuid not null references public.commerce_events(id),
 invoice_id uuid not null references public.commerce_invoices(id),
 audience text not null check(audience in ('customer','admin')),
 event_action text not null,
 snapshot jsonb not null check(jsonb_typeof(snapshot)='object'),
 state text not null default 'queued' check(state in ('queued','sending','accepted','failed','needs_review','skipped')),
 attempts integer not null default 0 check(attempts between 0 and 5),
 envelope jsonb, first_attempt_at timestamptz, claim_token uuid, lease_until timestamptz,
 next_attempt_at timestamptz not null default now(),
 provider_message_id text, last_error text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(event_id,audience)
);
create index commerce_notifications_due_idx on public.commerce_notifications(state,next_attempt_at,created_at);
create index commerce_notifications_invoice_idx on public.commerce_notifications(invoice_id,created_at);
alter table public.commerce_notifications enable row level security;
revoke all on public.commerce_notifications from public,anon,authenticated,service_role;
grant select on public.commerce_notifications to service_role;

create function commerce_internal.queue_invoice_notification()
returns trigger language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare r public.commerce_invoices%rowtype; s jsonb; a text;
begin
 if new.invoice_id is null or new.action not in ('requested','issued','accepted','payment_recorded','full_refund_recorded','status_changed') then return new; end if;
 select * into r from public.commerce_invoices where id=new.invoice_id;
 s:=jsonb_build_object('id',r.id,'customer_email',r.customer_email,'customer_name',r.customer_name,
  'kind',r.kind,'plan',r.plan,'status',r.status,'currency',r.currency,'total_cents',r.total_cents,
  'expires_at',r.expires_at,'tracking_carrier',r.tracking_carrier,'tracking_number',r.tracking_number,
  'event_at',new.created_at);
 foreach a in array array['customer','admin'] loop
  -- Staff need the request/acceptance alerts; customers get every meaningful state.
  if (a='admin' and new.action in ('requested','accepted')) or (a='customer' and new.action<>'accepted') then
   insert into public.commerce_notifications(event_id,invoice_id,audience,event_action,snapshot)
   values(new.id,r.id,a,new.action,s) on conflict(event_id,audience) do nothing;
  end if;
 end loop;
 return new;
end $$;
revoke all on function commerce_internal.queue_invoice_notification() from public,anon,authenticated,service_role;
create trigger commerce_event_notification after insert on public.commerce_events
 for each row execute function commerce_internal.queue_invoice_notification();

create function public.commerce_claim_notification(p_id uuid,p_envelope jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare n public.commerce_notifications%rowtype; r public.commerce_invoices%rowtype; token uuid;
begin
 select * into n from public.commerce_notifications where id=p_id for update;
 if not found then raise exception 'Notification not found' using errcode='P0002'; end if;
 if n.state in ('accepted','needs_review','skipped') then return jsonb_build_object('claimed',false,'state',n.state); end if;
 if n.next_attempt_at>now() or (n.state='sending' and n.lease_until>now()) then return jsonb_build_object('claimed',false,'state',n.state); end if;
 if n.attempts>=5 or (n.first_attempt_at is not null and n.first_attempt_at<now()-interval '23 hours') then
  update public.commerce_notifications set state='needs_review',claim_token=null,lease_until=null,last_error='retry_window_exhausted',updated_at=now() where id=p_id;
  return jsonb_build_object('claimed',false,'state','needs_review');
 end if;
 select * into r from public.commerce_invoices where id=n.invoice_id;
 -- Never email a stale request to pay an invoice already paid, voided or expired.
 if n.event_action='issued' and (r.status not in ('issued','accepted') or r.expires_at<=now()
  or not exists(select 1 from public.commerce_payment_methods where id=r.method_id and active)) then
  update public.commerce_notifications set state=case when attempts=0 then 'skipped' else 'needs_review' end,
   last_error='invoice_no_longer_payable',claim_token=null,lease_until=null,updated_at=now() where id=p_id;
  return jsonb_build_object('claimed',false,'state',case when n.attempts=0 then 'skipped' else 'needs_review' end);
 end if;
 if n.envelope is null then
  if p_envelope is null or jsonb_typeof(p_envelope)<>'object' or octet_length(p_envelope::text)>24000
   or jsonb_typeof(p_envelope->'to') is distinct from 'array' or jsonb_array_length(p_envelope->'to')<>1
   or length(coalesce(p_envelope->>'from',''))<3 or length(coalesce(p_envelope->>'text',''))<10 then
   raise exception 'Invalid email envelope' using errcode='22023';
  end if;
  if n.audience='customer' and lower(p_envelope->'to'->>0) is distinct from lower(n.snapshot->>'customer_email') then
   raise exception 'Customer recipient mismatch' using errcode='22023';
  end if;
  n.envelope:=p_envelope;
 end if;
 token:=gen_random_uuid();
 update public.commerce_notifications set state='sending',envelope=n.envelope,attempts=attempts+1,
  first_attempt_at=coalesce(first_attempt_at,now()),claim_token=token,lease_until=now()+interval '90 seconds',
  next_attempt_at=now()+interval '90 seconds',updated_at=now() where id=p_id;
 return jsonb_build_object('claimed',true,'claim',token,'envelope',n.envelope,'state','sending');
end $$;

create function public.commerce_finish_notification(p_id uuid,p_claim uuid,p_outcome text,p_provider_id text,p_error text)
returns boolean language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare n public.commerce_notifications%rowtype;
begin
 if p_claim is null or p_outcome is null or p_outcome not in ('accepted','failed')
  or length(coalesce(p_provider_id,''))>180 or length(coalesce(p_error,''))>180
  or (p_outcome='accepted' and length(coalesce(p_provider_id,''))<2) then
  raise exception 'Invalid send result' using errcode='22023'; end if;
 select * into n from public.commerce_notifications where id=p_id for update;
 if not found or n.state<>'sending' or n.claim_token is distinct from p_claim then return false; end if;
 update public.commerce_notifications set state=p_outcome,provider_message_id=p_provider_id,last_error=p_error,
  claim_token=null,lease_until=null,next_attempt_at=now()+make_interval(secs=>least(3600,60*(2^n.attempts)::integer)),updated_at=now()
 where id=p_id;
 return true;
end $$;
revoke all on function public.commerce_claim_notification(uuid,jsonb),public.commerce_finish_notification(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.commerce_claim_notification(uuid,jsonb),public.commerce_finish_notification(uuid,uuid,text,text,text) to service_role;
