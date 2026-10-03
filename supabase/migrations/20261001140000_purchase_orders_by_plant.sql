-- T14 (part 2): purchase orders carry a plant, and reorder levels become per-plant.
--
-- REEF confirmed two things in writing:
--   1. Each plant's stock is managed separately. A part can be out at one plant while another
--      has plenty, so reorder levels belong per plant, not per part. The part itself (name, sku,
--      unit, supplier) stays shared; only the levels move.
--   2. Purchase orders are management documents. Employees cannot place them; only authorised
--      management can. A purchase order is always for one plant.
--
-- This migration owns the stock_levels table, the purchase_orders.plant column, and the
-- Row Level Security policies for both. The stock_items columns and policies live in
-- 20261001120000_stock_by_plant.sql, which runs first and is self-contained.

-- 1. The levels move off stock_items into their own table, one row per part per plant.

CREATE TABLE IF NOT EXISTS public.stock_levels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_item_id uuid NOT NULL REFERENCES public.stock_items(id) ON DELETE CASCADE,
  plant text NOT NULL,
  qty_on_hand numeric NOT NULL DEFAULT 0,
  reorder_point numeric NOT NULL DEFAULT 0,
  reorder_qty numeric NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (stock_item_id, plant)
);

-- Carry the existing single-plant figures across so no data is lost.
INSERT INTO public.stock_levels (stock_item_id, plant, qty_on_hand, reorder_point, reorder_qty)
SELECT id, plant, qty_on_hand, reorder_point, reorder_qty
FROM public.stock_items
WHERE plant IS NOT NULL
ON CONFLICT (stock_item_id, plant) DO NOTHING;

-- The quantity columns stay on stock_items for now. The prototype's screens under src/ read
-- them, and REEF uses the prototype — the API is not deployed until T25. Migrating those
-- screens to stock_levels is Tayler's T14A; a follow-up migration drops the columns once
-- T14A lands. Until then both schemas exist: stock_items keeps the old columns for the
-- prototype, stock_levels is the source of truth for the API.

-- 2. Purchase orders carry the plant they are for. There are no existing purchase orders,
--    so the column can be required from the start.

ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS plant text NOT NULL;

-- 3. Row-level security on stock_levels. Four policies, one per command, each carrying
--    the plant filter. The owner override is explicit: the owner sees every plant.

ALTER TABLE public.stock_levels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stock_levels: read by plant" ON public.stock_levels;
CREATE POLICY "stock_levels: read by plant"
  ON public.stock_levels
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'owner'
    )
    OR plant = (
      SELECT p.plant FROM public.profiles p
      WHERE p.id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "stock_levels: insert by plant" ON public.stock_levels;
CREATE POLICY "stock_levels: insert by plant"
  ON public.stock_levels
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role IN ('owner', 'manager')
    )
    AND (
      EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = auth.uid() AND ur.role = 'owner'
      )
      OR plant = (
        SELECT p.plant FROM public.profiles p
        WHERE p.id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "stock_levels: update by plant" ON public.stock_levels;
CREATE POLICY "stock_levels: update by plant"
  ON public.stock_levels
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role IN ('owner', 'manager')
    )
    AND (
      EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = auth.uid() AND ur.role = 'owner'
      )
      OR plant = (
        SELECT p.plant FROM public.profiles p
        WHERE p.id = auth.uid()
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role IN ('owner', 'manager')
    )
    AND (
      EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = auth.uid() AND ur.role = 'owner'
      )
      OR plant = (
        SELECT p.plant FROM public.profiles p
        WHERE p.id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "stock_levels: delete by plant" ON public.stock_levels;
CREATE POLICY "stock_levels: delete by plant"
  ON public.stock_levels
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role IN ('owner', 'manager')
    )
    AND (
      EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = auth.uid() AND ur.role = 'owner'
      )
      OR plant = (
        SELECT p.plant FROM public.profiles p
        WHERE p.id = auth.uid()
      )
    )
  );

-- 4. Row-level security on purchase_orders. A PO carries cost and supplier data, so a
--    worker cannot see or create one at all. Owner and manager only, with the plant
--    filter on every command.

ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Managers manage POs" ON public.purchase_orders;
DROP POLICY IF EXISTS "purchase_orders: read by plant" ON public.purchase_orders;
DROP POLICY IF EXISTS "purchase_orders: write by plant" ON public.purchase_orders;

CREATE POLICY "purchase_orders: read by plant"
  ON public.purchase_orders
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'owner'
    )
    OR (
      EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = auth.uid() AND ur.role = 'manager'
      )
      AND plant = (
        SELECT p.plant FROM public.profiles p
        WHERE p.id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "purchase_orders: insert by plant" ON public.purchase_orders;
CREATE POLICY "purchase_orders: insert by plant"
  ON public.purchase_orders
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role IN ('owner', 'manager')
    )
    AND (
      EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = auth.uid() AND ur.role = 'owner'
      )
      OR plant = (
        SELECT p.plant FROM public.profiles p
        WHERE p.id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "purchase_orders: update by plant" ON public.purchase_orders;
CREATE POLICY "purchase_orders: update by plant"
  ON public.purchase_orders
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role IN ('owner', 'manager')
    )
    AND (
      EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = auth.uid() AND ur.role = 'owner'
      )
      OR plant = (
        SELECT p.plant FROM public.profiles p
        WHERE p.id = auth.uid()
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role IN ('owner', 'manager')
    )
    AND (
      EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = auth.uid() AND ur.role = 'owner'
      )
      OR plant = (
        SELECT p.plant FROM public.profiles p
        WHERE p.id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "purchase_orders: delete by plant" ON public.purchase_orders;
CREATE POLICY "purchase_orders: delete by plant"
  ON public.purchase_orders
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role IN ('owner', 'manager')
    )
    AND (
      EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = auth.uid() AND ur.role = 'owner'
      )
      OR plant = (
        SELECT p.plant FROM public.profiles p
        WHERE p.id = auth.uid()
      )
    )
  );