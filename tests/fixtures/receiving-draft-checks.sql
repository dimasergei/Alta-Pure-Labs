\set ON_ERROR_STOP on
-- Run after native-gateway-checks.sql in its isolated database.
\i supabase/migrations/20261110181709_receiving_method_drafts.sql
set role service_role;
do $$
declare v_id uuid:=gen_random_uuid(); p jsonb; n integer;
begin
 p:=jsonb_build_object('id',v_id,'version',0,'kind','bank_transfer','provider_key','bank_transfer','label','Fixture draft','currency','USD','payee','Fixture receiver','instructions','Not real receiving instructions','acceptance_reference','Owner draft; eligibility pending','active',false,'display_order',20,'sale_scope','both');
 perform public.commerce_save_receiving_draft(p,'isolated-draft-test');
 if (select active from public.commerce_payment_methods where id=v_id) then raise exception 'Draft became active'; end if;
 if not exists(select 1 from public.commerce_events where method_id=v_id and action='receiving_draft_saved' and details->>'provider_approval_asserted'='false') then raise exception 'Missing honest audit'; end if;
 begin
  perform public.commerce_save_receiving_draft(p||jsonb_build_object('version',1,'active',true),'isolated-draft-test');
  raise exception 'Draft activated' using errcode='22000';
 exception when invalid_parameter_value then null; end;
 begin
  perform public.commerce_save_receiving_draft(p,'isolated-draft-test');
  raise exception 'Stale draft overwritten' using errcode='22000';
 exception when serialization_failure then null; end;
 begin
  perform public.commerce_provider_command('save_method',p||jsonb_build_object('version',1,'active',true),'isolated-draft-test');
  raise exception 'Unverified route activated' using errcode='22000';
 exception when invalid_parameter_value then null; end;
 perform public.commerce_provider_command('save_method',p||jsonb_build_object('version',1,'active',true,'business_confirmed',true,'catalog_accepted',true),'isolated-draft-test');
 begin
  perform public.commerce_save_receiving_draft(p||jsonb_build_object('version',2),'isolated-draft-test');
  raise exception 'Active route edited by draft path' using errcode='22000';
 exception when invalid_parameter_value then null; end;
 if not (select active from public.commerce_payment_methods where id=v_id) then raise exception 'Active method changed'; end if;
 if has_function_privilege('anon','public.commerce_save_receiving_draft(jsonb,text)','execute') or has_function_privilege('authenticated','public.commerce_save_receiving_draft(jsonb,text)','execute') then raise exception 'Browser role can save receivers'; end if;
end $$;
reset role;
