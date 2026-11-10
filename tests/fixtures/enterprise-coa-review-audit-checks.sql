\set ON_ERROR_STOP on
-- Run after enterprise-inventory-schema-checks.sql in disposable PostgreSQL 17.
\i tests/fixtures/enterprise-coa-review-audit.sql
insert into public.enterprise_quality_documents(lot_id,report_id,lab_name,storage_object_key)
select id,'AUDIT-TEST-REPORT','Fixture laboratory','external-reference/fixture'
from public.enterprise_inventory_lots where lot_number='FIXTURE-LOT-1';
do $$
declare v_report uuid; v_out jsonb; v_n integer;
begin
 select id into v_report from public.enterprise_quality_documents where report_id='AUDIT-TEST-REPORT';
 v_out:=public.enterprise_review_quality_document(
  v_report,'reject','Independent laboratory identity not confirmed','fixture-quality-reviewer');
 if v_out->>'status'<>'rejected' then raise exception 'Review did not reject'; end if;
 select count(*) into v_n from public.enterprise_quality_review_events
 where report_id=v_report and action='reject' and reason='Independent laboratory identity not confirmed';
 if v_n<>1 then raise exception 'Missing immutable review audit event'; end if;
 begin
  perform public.enterprise_review_quality_document(
   v_report,'withdraw','This report was already rejected','fixture-quality-reviewer');
  raise exception 'Invalid second transition succeeded' using errcode='22000';
 exception when sqlstate 'P0001' then null;
 end;
 if (select count(*) from public.enterprise_quality_review_events where report_id=v_report)<>1 then
  raise exception 'Failed transition wrote audit event';
 end if;
end $$;
do $$
begin
 if has_function_privilege('anon','public.enterprise_review_quality_document(uuid,text,text,text)','EXECUTE') or
    has_function_privilege('authenticated','public.enterprise_review_quality_document(uuid,text,text,text)','EXECUTE') then
   raise exception 'Browser roles can review quality documents';
 end if;
 if has_table_privilege('service_role','public.enterprise_quality_documents','UPDATE') then
   raise exception 'Backend can bypass audited review';
 end if;
 if has_table_privilege('service_role','public.enterprise_quality_review_events','INSERT') or
    has_table_privilege('service_role','public.enterprise_quality_review_events','UPDATE') or
    has_table_privilege('service_role','public.enterprise_quality_review_events','DELETE') then
   raise exception 'Backend can mutate audit ledger directly';
 end if;
end $$;
select 'coa_review_audit_fixture_passed' as result;
