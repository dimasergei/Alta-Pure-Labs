-- Candidate COA review audit migration. No production records are created.
create table if not exists public.enterprise_quality_review_events (
 id uuid primary key default gen_random_uuid(),
 report_id uuid not null references public.enterprise_quality_documents(id) on delete restrict,
 previous_status text not null,
 next_status text not null check (next_status in ('rejected','withdrawn')),
 action text not null check (action in ('reject','withdraw')),
 reason text not null check (length(trim(reason)) between 12 and 500),
 actor_reference text not null check (length(trim(actor_reference)) between 2 and 180),
 created_at timestamptz not null default now()
);
create index if not exists enterprise_quality_review_events_report_idx
 on public.enterprise_quality_review_events(report_id,created_at desc);
alter table public.enterprise_quality_review_events enable row level security;
revoke all on public.enterprise_quality_review_events from public, anon, authenticated, service_role;
grant select on public.enterprise_quality_review_events to service_role;

-- The backend cannot bypass the audited transition with a direct UPDATE.
revoke update on public.enterprise_quality_documents from service_role;

create or replace function public.enterprise_review_quality_document(
 p_report_id uuid, p_action text, p_reason text, p_actor_reference text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_previous public.enterprise_quality_documents%rowtype;
        v_next text;
begin
 if p_report_id is null or p_action not in ('reject','withdraw') or
    p_reason is null or length(trim(p_reason)) not between 12 and 500 or
    p_actor_reference is null or length(trim(p_actor_reference)) not between 2 and 180 then
  raise exception 'Invalid review request.' using errcode='22023';
 end if;
 select * into v_previous from public.enterprise_quality_documents
 where id=p_report_id for update;
 if not found then
  raise exception 'Quality document not found.' using errcode='P0002';
 end if;
 if p_action='reject' and v_previous.status<>'pending' then
  raise exception 'Only pending reports may be rejected.' using errcode='P0001';
 end if;
 if p_action='withdraw' and v_previous.status not in ('pending','verified') then
  raise exception 'Report cannot be withdrawn.' using errcode='P0001';
 end if;
 v_next:=case when p_action='reject' then 'rejected' else 'withdrawn' end;
 update public.enterprise_quality_documents
 set status=v_next,publication_approved=false,reviewer=null,reviewed_at=null
 where id=p_report_id;
 insert into public.enterprise_quality_review_events
  (report_id,previous_status,next_status,action,reason,actor_reference)
 values (p_report_id,v_previous.status,v_next,p_action,trim(p_reason),trim(p_actor_reference));
 return jsonb_build_object('id',p_report_id,'status',v_next,'publication_approved',false);
end $$;
revoke all on function public.enterprise_review_quality_document(uuid,text,text,text)
 from public, anon, authenticated;
grant execute on function public.enterprise_review_quality_document(uuid,text,text,text)
 to service_role;
