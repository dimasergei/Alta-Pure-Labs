-- Customer reads are mediated by the authenticated server API.
create index if not exists store_orders_customer_email_lower_idx on public.store_orders(lower(customer_email));
alter table public.store_orders enable row level security;
alter table public.store_order_items enable row level security;
drop policy if exists customer_read_own_store_orders on public.store_orders;
create policy customer_read_own_store_orders on public.store_orders for select to authenticated
using(lower(customer_email)=lower(coalesce(auth.jwt()->>'email','')));
drop policy if exists customer_read_own_store_order_items on public.store_order_items;
create policy customer_read_own_store_order_items on public.store_order_items for select to authenticated
using(exists(select 1 from public.store_orders where store_orders.id=store_order_items.order_id and lower(store_orders.customer_email)=lower(coalesce(auth.jwt()->>'email',''))));
-- Prevent direct client reads of internal order columns; service_role server access is unchanged.
revoke all on table public.store_orders from anon,authenticated;
revoke all on table public.store_order_items from anon,authenticated;
