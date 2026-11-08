create table if not exists public.order_status_notifications (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null
    references public.store_orders (id)
    on delete cascade,
  customer_email text not null,
  notification_type text not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  last_error text,
  provider_message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,

  constraint order_status_notifications_type_allowed
    check (notification_type in (
      'processing',
      'partially_shipped',
      'shipped',
      'delivered',
      'canceled'
    )),

  constraint order_status_notifications_status_allowed
    check (status in (
      'pending',
      'sent',
      'failed',
      'canceled'
    ))
);

create unique index if not exists order_status_notifications_unique_active
  on public.order_status_notifications (
    order_id,
    notification_type
  )
  where status in ('pending', 'sent');

create index if not exists order_status_notifications_pending_idx
  on public.order_status_notifications (status, created_at)
  where status = 'pending';

create index if not exists order_status_notifications_order_idx
  on public.order_status_notifications (order_id);
