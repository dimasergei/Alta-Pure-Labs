\set ON_ERROR_STOP on
-- Run after invoice-notification-checks.sql in disposable PostgreSQL only.
\i supabase/migrations/20261110061802_signed_invoice_worker.sql
set role service_role;
do $$ declare n uuid:=gen_random_uuid(); begin
 if not public.commerce_consume_notification_job(n,now()) then raise exception 'Fresh nonce rejected'; end if;
 if public.commerce_consume_notification_job(n,now()) then raise exception 'Nonce replay accepted'; end if;
 if public.commerce_consume_notification_job(gen_random_uuid(),now()-interval '61 seconds') then raise exception 'Old nonce accepted'; end if;
 if public.commerce_consume_notification_job(gen_random_uuid(),now()+interval '10 seconds') then raise exception 'Future nonce accepted'; end if;
end $$;
reset role;
do $$ begin
 if has_function_privilege('anon','public.commerce_consume_notification_job(uuid,timestamptz)','EXECUTE') or has_function_privilege('authenticated','public.commerce_consume_notification_job(uuid,timestamptz)','EXECUTE') then raise exception 'Browser can authorize jobs'; end if;
 if has_table_privilege('service_role','commerce_internal.notification_job_nonces','SELECT,INSERT,UPDATE,DELETE') then raise exception 'Backend has direct nonce table access'; end if;
end $$;
select 'notification_job_nonce_passed' as result;
