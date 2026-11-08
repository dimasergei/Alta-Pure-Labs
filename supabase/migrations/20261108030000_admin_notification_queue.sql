alter table public.order_status_notifications
  add column if not exists event_key text;

update public.order_status_notifications
set event_key = 'legacy:' || id::text
where event_key is null;

alter table public.order_status_notifications
  alter column event_key set not null;

alter table public.order_status_notifications
  drop constraint if exists order_status_notifications_type_allowed;

alter table public.order_status_notifications
  add constraint order_status_notifications_type_allowed
  check (notification_type in (
    'confirmation',
    'processing',
    'partially_shipped',
    'shipped',
    'tracking_updated',
    'delivered',
    'canceled'
  ));

drop index if exists public.order_status_notifications_unique_active;

create unique index order_status_notifications_unique_active
  on public.order_status_notifications (
    order_id,
    notification_type,
    event_key
  )
  where status in ('pending', 'sent');
