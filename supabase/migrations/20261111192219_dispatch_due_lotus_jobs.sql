create or replace function commerce_internal.dispatch_due_invoice_emails()
returns bigint language plpgsql set search_path to 'pg_catalog','pg_temp' as $$
declare signing_key text; ts text; nonce text; signature text;
begin
 if not exists(select 1 from public.commerce_notifications where state in ('queued','failed','sending') and next_attempt_at<=now())
 and not exists(select 1 from public.commerce_supplier_jobs j where j.status in ('queued','retry','working','submitted') and j.next_attempt_at<=now() and (j.lease_until is null or j.lease_until<now()) and exists(select 1 from public.commerce_supplier_settings where enabled and verified_at is not null and max_order_cents>0)) then return null; end if;
 select decrypted_secret into signing_key from vault.decrypted_secrets where name='altapure_invoice_worker';
 if signing_key is null or length(signing_key)<32 then return null; end if;
 ts:=floor(extract(epoch from clock_timestamp()))::bigint::text;
 nonce:=gen_random_uuid()::text;
 signature:=encode(extensions.hmac(convert_to('invoice-email-retry'||chr(10)||ts||chr(10)||nonce,'UTF8'),convert_to(signing_key,'UTF8'),'sha256'),'hex');
 return net.http_post(url:='https://altapurelabs.com/api/customer-config?commerce=worker',
 headers:=jsonb_build_object('Content-Type','application/json','x-commerce-job-time',ts,'x-commerce-job-nonce',nonce,'x-commerce-job-signature',signature),
 body:='{}'::jsonb,timeout_milliseconds:=55000);
end $$;