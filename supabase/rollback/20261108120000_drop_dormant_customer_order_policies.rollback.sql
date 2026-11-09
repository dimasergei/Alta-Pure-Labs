-- Exact original predicates from migration 20261108050000_customer_accounts_order_access.sql.
BEGIN;

CREATE POLICY customer_read_own_store_orders
ON public.store_orders
FOR SELECT
TO authenticated
USING (
  lower(customer_email) = lower(coalesce(auth.jwt()->>'email',''))
);

CREATE POLICY customer_read_own_store_order_items
ON public.store_order_items
FOR SELECT
TO authenticated
USING (
  exists(
    select 1
    from public.store_orders
    where store_orders.id = store_order_items.order_id
      and lower(store_orders.customer_email) =
          lower(coalesce(auth.jwt()->>'email',''))
  )
);

COMMIT;
