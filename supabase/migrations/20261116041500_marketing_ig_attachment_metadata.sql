-- Keep signed Meta attachment metadata with each private Instagram message.
-- The URLs can expire; the admin API refreshes them from Meta when opened.
alter table public.ap_marketing_ig_messages
  add column if not exists attachments jsonb not null default '[]'::jsonb;

alter table public.ap_marketing_ig_messages
  add constraint ap_marketing_ig_messages_attachments_array
  check (case when jsonb_typeof(attachments) = 'array'
    then jsonb_array_length(attachments) <= 12 else false end);
