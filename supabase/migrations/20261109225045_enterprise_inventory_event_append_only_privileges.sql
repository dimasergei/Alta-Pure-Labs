-- Applied to Supabase production on 2026-11-09; reconcile with remote migration history.
revoke update, delete, truncate, references, trigger on table public.enterprise_inventory_events from service_role;
grant select, insert on table public.enterprise_inventory_events to service_role;
