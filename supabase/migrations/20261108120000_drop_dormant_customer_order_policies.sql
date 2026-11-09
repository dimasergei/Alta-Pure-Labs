-- Migration 3: remove customer SELECT policies unused by the server-mediated
-- customer orders API. RLS remains enabled and table privileges are unchanged.
BEGIN;

DROP POLICY IF EXISTS customer_read_own_store_orders
ON public.store_orders;

DROP POLICY IF EXISTS customer_read_own_store_order_items
ON public.store_order_items;

COMMIT;
