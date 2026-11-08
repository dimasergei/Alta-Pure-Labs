create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_name text,
  email text,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint suppliers_name_not_empty
    check (length(btrim(name)) > 0),

  constraint suppliers_email_format
    check (
      email is null
      or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    )
);

create unique index if not exists suppliers_active_name_unique
  on public.suppliers (lower(btrim(name)))
  where active = true;

create table if not exists public.supplier_batches (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null
    references public.suppliers (id)
    on delete restrict,
  name text not null,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint supplier_batches_name_not_empty
    check (length(btrim(name)) > 0),

  constraint supplier_batches_status_allowed
    check (status in ('draft', 'sent', 'fulfilled', 'canceled'))
);

create table if not exists public.supplier_batch_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null
    references public.supplier_batches (id)
    on delete cascade,
  order_id uuid not null
    references public.store_orders (id)
    on delete cascade,
  order_item_id uuid not null
    references public.store_order_items (id)
    on delete cascade,
  product_name text not null,
  variant_size text,
  quantity integer not null,
  supplier_sku text,
  supplier_name text,
  lot_number text,
  fulfillment_notes text,
  created_at timestamptz not null default now(),

  constraint supplier_batch_items_quantity_positive
    check (quantity > 0)
);

create index if not exists supplier_batches_supplier_idx
  on public.supplier_batches (supplier_id);

create index if not exists supplier_batches_created_idx
  on public.supplier_batches (created_at desc);

create index if not exists supplier_batch_items_batch_idx
  on public.supplier_batch_items (batch_id);

create index if not exists supplier_batch_items_order_idx
  on public.supplier_batch_items (order_id);

create index if not exists supplier_batch_items_item_idx
  on public.supplier_batch_items (order_item_id);
