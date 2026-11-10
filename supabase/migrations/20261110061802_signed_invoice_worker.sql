-- pg_net's managed queue may remain readable to platform roles. Never put a
-- reusable bearer secret there. Use a 60-second HMAC proof and atomic nonce instead.
create table commerce_internal.notification_job_nonces (
 nonce uuid primary key,
 issued_at timestamptz not null,
 consumed_at timestamptz not null default now()
);
alter table commerce_internal.notification_job_nonces enable row level security;
revoke all on commerce_internal.notification_job_nonces from public,anon,authenticated,service_role;

create function public.commerce_consume_notification_job(p_nonce uuid,p_issued_at timestamptz)
returns boolean language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare inserted integer;
begin
 if p_nonce is null or p_issued_at is null or p_issued_at<now()-interval '60 seconds' or p_issued_at>now()+interval '5 seconds' then return false; end if;
 delete from commerce_internal.notification_job_nonces where consumed_at<now()-interval '10 minutes';
 insert into commerce_internal.notification_job_nonces(nonce,issued_at) values(p_nonce,p_issued_at) on conflict(nonce) do nothing;
 get diagnostics inserted=row_count;
 return inserted=1;
end $$;
revoke all on function public.commerce_consume_notification_job(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.commerce_consume_notification_job(uuid,timestamptz) to service_role;

create or replace function commerce_internal.dispatch_due_invoice_emails()
returns bigint language plpgsql security invoker set search_path=pg_catalog,pg_temp as $$
declare signing_key text; ts text; nonce text; signature text;
begin
 if not exists(select 1 from public.commerce_notifications where state in ('queued','failed','sending') and next_attempt_at<=now()) then return null; end if;
 select decrypted_secret into signing_key from vault.decrypted_secrets where name='altapure_invoice_worker';
 if signing_key is null or length(signing_key)<32 then return null; end if;
 ts:=floor(extract(epoch from clock_timestamp()))::bigint::text;
 nonce:=gen_random_uuid()::text;
 signature:=encode(extensions.hmac(convert_to('invoice-email-retry'||chr(10)||ts||chr(10)||nonce,'UTF8'),convert_to(signing_key,'UTF8'),'sha256'),'hex');
 return net.http_post(url:='https://altapurelabs.com/api/customer-config?commerce=worker',
  headers:=jsonb_build_object('Content-Type','application/json','x-commerce-job-time',ts,'x-commerce-job-nonce',nonce,'x-commerce-job-signature',signature),
  body:='{}'::jsonb,timeout_milliseconds:=55000);
end $$;
revoke all on function commerce_internal.dispatch_due_invoice_emails() from public,anon,authenticated,service_role;
