-- T14 (part 2): purchase orders carry a plant, and reorder levels become per-plant.
--
-- REEF confirmed two things in writing:
--   1. Each plant's stock is managed separately. A part can be out at one plant while another
--      has plenty, so reorder levels belong per plant, not per part. The part itself (name, sku,
--      unit, supplier) stays shared; only the levels move.
--   2. Purchase orders are management documents. Employees cannot place them; only authorised
--      management can. A purchase order is always for one plant.

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

-- 3. Row-level security on stock_levels, same rule as stock_items.
--    A signed-in user sees a stock level if it belongs to their plant, or if they are the owner.

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

DROP POLICY IF EXISTS "stock_levels: write by plant" ON public.stock_levels;
CREATE POLICY "stock_levels: write by plant"
  ON public.stock_levels
  FOR ALL
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