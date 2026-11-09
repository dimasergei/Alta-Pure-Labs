-- AltaPure enterprise inventory schema, disposable test fixture and proposed production DDL.
-- No existing order, supplier, payment, or batch tables are altered.
-- All new objects are service-only, RLS enabled, and deny browser roles.
create table if not exists public.enterprise_inventory_lots (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  sku_key text not null check (sku_key ~ '^[a-z0-9-]{2,120}$'),
  lot_number text not null check (length(trim(lot_number)) between 1 and 120),
  fulfillment_site text not null check (length(trim(fulfillment_site)) between 1 and 120),
  status text not null default 'quarantine'
    check (status in ('quarantine','released','hold','recalled','depleted')),
  on_hand integer not null default 0 check (on_hand >= 0),
  reserved integer not null default 0 check (reserved >= 0),
  damaged integer not null default 0 check (damaged >= 0),
  evidence_reference text,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint enterprise_lot_counts_valid check (reserved + damaged <= on_hand),
  constraint enterprise_release_evidence_required check (
    status <> 'released' or (
      nullif(trim(coalesce(evidence_reference,'')), '') is not null
      and nullif(trim(coalesce(reviewed_by,'')), '') is not null
      and reviewed_at is not null
    )
  ),
  unique (supplier_id, sku_key, lot_number, fulfillment_site)
);
create index if not exists enterprise_lots_sku_status_idx
  on public.enterprise_inventory_lots (sku_key, status);
create table if not exists public.enterprise_quality_documents (
  id uuid primary key default gen_random_uuid(),
  lot_id uuid not null references public.enterprise_inventory_lots(id) on delete restrict,
  report_id text not null check (length(trim(report_id)) between 2 and 120),
  lab_name text not null check (length(trim(lab_name)) between 2 and 180),
  report_date date,
  storage_object_key text not null check (length(trim(storage_object_key)) between 3 and 500),
  verification_url text,
  status text not null default 'pending'
    check (status in ('pending','verified','rejected','withdrawn')),
  publication_approved boolean not null default false,
  reviewer text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint enterprise_quality_publication_requires_review check (
    publication_approved = false or (
      status = 'verified' and nullif(trim(coalesce(reviewer,'')), '') is not null
      and reviewed_at is not null
    )
  ),
  unique (lot_id, report_id)
);
create table if not exists public.enterprise_inventory_events (
  id uuid primary key default gen_random_uuid(),
  lot_id uuid not null references public.enterprise_inventory_lots(id) on delete restrict,
  event_kind text not null
    check (event_kind in ('receipt','reserve','release','damage','adjustment','ship','recall','quality_hold')),
  quantity integer not null check (quantity > 0),
  idempotency_key text not null unique check (length(trim(idempotency_key)) between 8 and 180),
  actor_reference text not null check (length(trim(actor_reference)) between 2 and 180),
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists enterprise_inventory_events_lot_idx
  on public.enterprise_inventory_events (lot_id, created_at desc);

alter table public.enterprise_inventory_lots enable row level security;
alter table public.enterprise_quality_documents enable row level security;
alter table public.enterprise_inventory_events enable row level security;

revoke all on public.enterprise_inventory_lots from public, anon, authenticated;
revoke all on public.enterprise_quality_documents from public, anon, authenticated;
revoke all on public.enterprise_inventory_events from public, anon, authenticated;

grant select, insert, update, delete on public.enterprise_inventory_lots to service_role;
grant select, insert, update, delete on public.enterprise_quality_documents to service_role;
revoke update, delete, truncate, references, trigger on public.enterprise_inventory_events from service_role;
grant select, insert on public.enterprise_inventory_events to service_role;
-- Intentionally no UPDATE/DELETE on inventory events for service_role.
