-- Research Builder plans are separate from the regular cart and its promotions.
-- Only a verified recurring payment event can activate a plan or add a paid cycle.
create table if not exists public.research_subscriptions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references auth.users(id) on delete restrict,
  customer_email text not null,
  status text not null default 'pending_payment' check (status in ('pending_payment','active','past_due','cancel_pending','canceled')),
  currency text not null default 'USD' check (currency = 'USD'),
  lines jsonb not null,
  shipping_address jsonb not null,
  retail_cents integer not null check (retail_cents >= 0),
  discount_cents integer not null check (discount_cents >= 0),
  monthly_cents integer not null check (monthly_cents > 0),
  shipping_cents integer not null default 0 check (shipping_cents = 0),
  bundled_item text not null default 'BAC Water 3ML',
  minimum_paid_cycles integer not null default 3 check (minimum_paid_cycles = 3),
  paid_cycles integer not null default 0 check (paid_cycles >= 0),
  first_delivery_shipped_at timestamptz,
  provider text check (provider is null or provider = 'nmi'),
  provider_subscription_id text unique,
  next_billing_at timestamptz,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint research_price_math check (retail_cents - discount_cents = monthly_cents)
);

create index if not exists research_subscriptions_customer_created_idx
  on public.research_subscriptions(customer_id, created_at desc);

create table if not exists public.research_subscription_cycles (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.research_subscriptions(id) on delete restrict,
  cycle_number integer not null check (cycle_number > 0),
  provider_transaction_id text not null unique,
  amount_cents integer not null check (amount_cents > 0),
  status text not null check (status in ('paid','refunded')),
  paid_at timestamptz not null,
  shipped_at timestamptz,
  tracking_number text,
  created_at timestamptz not null default now(),
  unique(subscription_id, cycle_number)
);

alter table public.research_subscriptions enable row level security;
alter table public.research_subscription_cycles enable row level security;
revoke all on public.research_subscriptions from public, anon, authenticated;
revoke all on public.research_subscription_cycles from public, anon, authenticated;
grant select, insert, update on public.research_subscriptions to service_role;
grant select, insert, update on public.research_subscription_cycles to service_role;
