-- Uses the project's database scheduler; no paid hosting upgrade required.
-- COMMERCE_NOTIFICATION_JOB_SECRET is provisioned separately in Vercel and Vault,
-- never in source. No bank, gateway or customer token is used by this worker.
create extension if not exists pg_cron;
create extension if not exists pg_net;
revoke all on net.http_request_queue from public,anon,authenticated,service_role;
revoke usage on schema net from public,anon,authenticated,service_role;
create function commerce_internal.dispatch_due_invoice_emails()
returns bigint language plpgsql security invoker set search_path=pg_catalog,pg_temp as $$
declare token text;
begin
 if not exists(select 1 from public.commerce_notifications where state in ('queued','failed','sending') and next_attempt_at<=now()) then return null; end if;
 select decrypted_secret into token from vault.decrypted_secrets where name='altapure_invoice_worker';
 if token is null or length(token)<32 then return null; end if;
 return net.http_post(url:='https://altapurelabs.com/api/customer-config?commerce=worker',
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||token),
  body:='{}'::jsonb,timeout_milliseconds:=55000);
end $$;
revoke all on function commerce_internal.dispatch_due_invoice_emails() from public,anon,authenticated,service_role;
select cron.schedule('altapure-invoice-email-retry','*/10 * * * *','select commerce_internal.dispatch_due_invoice_emails();');
