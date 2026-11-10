-- Save owner-provided receiving details privately without asserting provider approval.
-- Existing activation rules and all financial records remain unchanged.
create function public.commerce_save_receiving_draft(p_data jsonb,p_actor text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare v_id uuid; v_version integer; m public.commerce_payment_methods%rowtype;
begin
 if p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>8000
  or length(coalesce(p_actor,'')) not between 8 and 180
  or p_data->>'active' is distinct from 'false'
  or coalesce(p_data->>'kind','') not in ('bank_transfer','interac')
  or p_data->>'provider_key' is distinct from p_data->>'kind'
  or coalesce(p_data->>'currency','') not in ('USD','CAD')
  or (p_data->>'kind'='interac' and p_data->>'currency'<>'CAD')
  or coalesce(p_data->>'sale_scope','') not in ('goods','membership','both')
 then raise exception 'Inactive receiving draft required' using errcode='22023'; end if;
 v_id:=(p_data->>'id')::uuid; v_version:=(p_data->>'version')::integer;
 if v_id is null or v_version is null or v_version<0 then raise exception 'Draft ID and version required' using errcode='22023'; end if;
 select * into m from public.commerce_payment_methods where id=v_id for update;
 if found then
  if m.version<>v_version then raise exception 'Method changed' using errcode='40001'; end if;
  if m.active or m.native_provider is not null or m.kind<>p_data->>'kind' or m.currency<>p_data->>'currency' or m.provider_key<>p_data->>'provider_key' then
   raise exception 'Only an inactive matching manual route can be edited as a draft' using errcode='22023'; end if;
  update public.commerce_payment_methods set label=p_data->>'label',payee=p_data->>'payee',instructions=p_data->>'instructions',
   acceptance_reference=p_data->>'acceptance_reference',version=version+1,updated_at=now(),
   display_order=(p_data->>'display_order')::integer,sale_scope=p_data->>'sale_scope' where id=v_id;
 else
  if v_version<>0 then raise exception 'Draft not found' using errcode='P0002'; end if;
  insert into public.commerce_payment_methods(id,kind,label,currency,payee,instructions,acceptance_reference,active,provider_key,display_order,sale_scope)
   values(v_id,p_data->>'kind',p_data->>'label',p_data->>'currency',p_data->>'payee',p_data->>'instructions',p_data->>'acceptance_reference',false,p_data->>'provider_key',(p_data->>'display_order')::integer,p_data->>'sale_scope');
 end if;
 insert into public.commerce_events(method_id,action,actor,details) values(v_id,'receiving_draft_saved',p_actor,jsonb_build_object('active',false,'provider_approval_asserted',false));
 return jsonb_build_object('id',v_id,'saved',true,'active',false);
end $$;
revoke all on function public.commerce_save_receiving_draft(jsonb,text) from public,anon,authenticated;
grant execute on function public.commerce_save_receiving_draft(jsonb,text) to service_role;
