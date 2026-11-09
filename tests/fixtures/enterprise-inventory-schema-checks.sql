\set ON_ERROR_STOP on
-- Disposable PostgreSQL 17 database only. This fixture creates no production records.
do $$
begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
end $$;
create extension if not exists pgcrypto;
create table if not exists public.suppliers (
 id uuid primary key default gen_random_uuid(),
 name text not null
);
\i tests/fixtures/enterprise-inventory-schema.sql
-- Simulate Supabase's existing default service_role table grants, then verify migration corrects them.
grant update, delete on public.enterprise_inventory_events to service_role;
-- Reapplication should be idempotent and remove excessive service-role rights.
\i tests/fixtures/enterprise-inventory-schema.sql
do $$
declare t text;
begin
 foreach t in array array['enterprise_inventory_lots','enterprise_quality_documents','enterprise_inventory_events'] loop
  if not (select relrowsecurity from pg_class where oid=('public.'||t)::regclass) then
   raise exception 'RLS missing on %', t;
  end if;
  if has_table_privilege('anon','public.'||t,'SELECT') or
     has_table_privilege('authenticated','public.'||t,'SELECT') or
     has_table_privilege('anon','public.'||t,'INSERT') or
     has_table_privilege('authenticated','public.'||t,'INSERT') then
   raise exception 'Browser role has unexpected privileges on %',t;
  end if;
  if not has_table_privilege('service_role','public.'||t,'SELECT') then
   raise exception 'Service role cannot select %',t;
  end if;
 end loop;
 if has_table_privilege('service_role','public.enterprise_inventory_events','UPDATE') or
    has_table_privilege('service_role','public.enterprise_inventory_events','DELETE') then
   raise exception 'Inventory event ledger must be append-only for service role';
 end if;
end $$;
insert into public.suppliers(id) values
 ('10000000-0000-4000-8000-000000000001');
-- Default quarantine; no automatic release or public COA.
insert into public.enterprise_inventory_lots(
 supplier_id,sku_key,lot_number,fulfillment_site,on_hand
) values (
 '10000000-0000-4000-8000-000000000001','fixture-sku-10mg','FIXTURE-LOT-1','fixture-site',10
);
do $$
declare n int;
begin
 select count(*) into n from public.enterprise_inventory_lots where status='quarantine';
 if n<>1 then raise exception 'Expected exactly one quarantined lot'; end if;
end $$;
-- The following are intentional constraint violations; ensure none are accepted.
do $$
begin
 begin
  insert into public.enterprise_inventory_lots(supplier_id,sku_key,lot_number,fulfillment_site,status,on_hand)
  values ('10000000-0000-4000-8000-000000000001','fixture-sku-10mg','BAD-RELEASE','fixture-site','released',1);
  raise exception 'Released lot without evidence unexpectedly accepted';
 exception when check_violation then null;
 end;
 begin
  insert into public.enterprise_inventory_lots(supplier_id,sku_key,lot_number,fulfillment_site,on_hand,reserved)
  values ('10000000-0000-4000-8000-000000000001','fixture-sku-10mg','BAD-STOCK','fixture-site',1,2);
  raise exception 'Oversold lot unexpectedly accepted';
 exception when check_violation then null;
 end;
 begin
  insert into public.enterprise_quality_documents(lot_id,report_id,lab_name,storage_object_key,status,publication_approved)
  select id,'FIXTURE-REPORT','Fixture laboratory','private/fixture.pdf','pending',true
  from public.enterprise_inventory_lots limit 1;
  raise exception 'Unverified COA publication unexpectedly accepted';
 exception when check_violation then null;
 end;
end $$;
insert into public.enterprise_inventory_events(lot_id,event_kind,quantity,idempotency_key,actor_reference)
select id,'receipt',10,'fixture-receipt-0001','fixture-admin' from public.enterprise_inventory_lots limit 1;
do $$
begin
 begin
  insert into public.enterprise_inventory_events(lot_id,event_kind,quantity,idempotency_key,actor_reference)
  select id,'receipt',10,'fixture-receipt-0001','fixture-admin' from public.enterprise_inventory_lots limit 1;
  raise exception 'Duplicate idempotency key unexpectedly accepted';
 exception when unique_violation then null;
 end;
end $$;
select 'enterprise_inventory_schema_fixture_passed' as result;
