-- T14B: booking stock out and the reorder request.
--
-- REEF corrected the earlier assumption that a worker could not book parts out.
-- Every role may read stock and book stock out. Booking stock out records who took
-- the item, what they took, how many and when, and reduces the quantity on hand.
--
-- Falling to the reorder point does NOT create a purchase order. It creates a
-- reorder request instead. Only authorised management may turn that request into
-- a purchase order.

-- ---------- Stock bookings ----------

CREATE TABLE public.stock_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_item_id uuid NOT NULL
    REFERENCES public.stock_items(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL
    REFERENCES auth.users(id) ON DELETE RESTRICT,
  plant text NOT NULL,
  qty numeric(14,2) NOT NULL CHECK (qty > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_stock_bookings_plant_created
  ON public.stock_bookings (plant, created_at DESC);

GRANT SELECT ON public.stock_bookings TO authenticated;
GRANT ALL ON public.stock_bookings TO service_role;

ALTER TABLE public.stock_bookings ENABLE ROW LEVEL SECURITY;

-- Owners may see every booking. Everybody else may see bookings for their own plant.
CREATE POLICY "stock_bookings: read by plant"
  ON public.stock_bookings
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role = 'owner'
    )
    OR plant = (
      SELECT p.plant
      FROM public.profiles p
      WHERE p.id = auth.uid()
    )
  );

-- There is deliberately no direct INSERT policy for authenticated users.
-- Bookings are written only through record_stock_usage(), which determines the
-- caller and plant itself instead of trusting values supplied by the browser.


-- ---------- Reorder requests ----------

CREATE TABLE public.reorder_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_item_id uuid NOT NULL
    REFERENCES public.stock_items(id) ON DELETE RESTRICT,
  plant text NOT NULL,
  requested_qty numeric(14,2) NOT NULL CHECK (requested_qty > 0),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'converted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  converted_at timestamptz,
  purchase_order_id uuid
    REFERENCES public.purchase_orders(id) ON DELETE SET NULL
);

-- At most one open request for an item at a plant. Repeated stock bookings while
-- the item remains below its reorder point must not create a pile of requests.
CREATE UNIQUE INDEX reorder_requests_one_open_per_item_plant
  ON public.reorder_requests (stock_item_id, plant)
  WHERE status = 'open';

CREATE INDEX idx_reorder_requests_plant_status
  ON public.reorder_requests (plant, status, created_at DESC);

GRANT SELECT ON public.reorder_requests TO authenticated;
GRANT ALL ON public.reorder_requests TO service_role;

ALTER TABLE public.reorder_requests ENABLE ROW LEVEL SECURITY;

-- A reorder request is an ordering queue, so only management may read it.
-- Managers are limited to their own plant; the owner may see all plants.
CREATE POLICY "reorder_requests: read by plant"
  ON public.reorder_requests
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role = 'owner'
    )
    OR (
      EXISTS (
        SELECT 1
        FROM public.user_roles ur
        WHERE ur.user_id = auth.uid()
          AND ur.role = 'manager'
      )
      AND plant = (
        SELECT p.plant
        FROM public.profiles p
        WHERE p.id = auth.uid()
      )
    )
  );


-- There is deliberately no direct INSERT policy. A reorder request is raised by
-- ensure_reorder() after stock crosses its threshold.


-- ---------- Reorder rule ----------

-- This replaces the old implementation that automatically created a draft purchase
-- order. Crossing the reorder level now creates only a request.
CREATE OR REPLACE FUNCTION public.ensure_reorder(_item uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  item record;
  level public.stock_levels;
BEGIN
  SELECT *
    INTO item
    FROM public.stock_items
   WHERE id = _item;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  level := public.stock_level_of(_item);

  IF level.qty_on_hand > level.reorder_point
     OR level.reorder_qty <= 0 THEN
    RETURN;
  END IF;

  INSERT INTO public.reorder_requests (
    stock_item_id,
    plant,
    requested_qty
  )
  VALUES (
    item.id,
    item.plant,
    level.reorder_qty
  )
  ON CONFLICT (stock_item_id, plant)
    WHERE status = 'open'
  DO NOTHING;
END;
$$;


-- ---------- Stock booking ----------

-- Every role may use this function, but the function itself determines the caller
-- and plant. A worker cannot use it to alter stock at another plant.
CREATE OR REPLACE FUNCTION public.record_stock_usage(_item uuid, _qty numeric)
RETURNS public.stock_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result public.stock_items;
  _plant text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Your account has no role'
      USING errcode = '42501';
  END IF;

  IF _qty IS NULL OR _qty <= 0 THEN
    RAISE EXCEPTION 'Quantity must be more than zero'
      USING errcode = '22023';
  END IF;

  SELECT plant
    INTO _plant
    FROM public.stock_items
   WHERE id = _item;

  IF _plant IS NULL
     OR (
       NOT EXISTS (
         SELECT 1
         FROM public.user_roles
         WHERE user_id = auth.uid()
           AND role = 'owner'
       )
       AND _plant IS DISTINCT FROM (
         SELECT to_jsonb(p) ->> 'plant'
         FROM public.profiles p
         WHERE p.id = auth.uid()
       )
     ) THEN
    RAISE EXCEPTION 'No such stock item'
      USING errcode = 'RF404';
  END IF;

  -- Record who took what, how many, and when before changing the stock figure.
  INSERT INTO public.stock_bookings (
    stock_item_id,
    user_id,
    plant,
    qty
  )
  VALUES (
    _item,
    auth.uid(),
    _plant,
    _qty
  );

  -- The physical use is recorded even when it makes the quantity negative.
  PERFORM public.adjust_stock(_item, -_qty);

  -- Reaching the threshold creates a request only. It never creates a PO.
  PERFORM public.ensure_reorder(_item);

  SELECT *
    INTO result
    FROM public.stock_items
   WHERE id = _item;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.record_stock_usage(uuid, numeric)
  FROM public, anon;

GRANT EXECUTE ON FUNCTION public.record_stock_usage(uuid, numeric)
  TO authenticated;


-- ---------- Convert request to purchase order ----------

-- Management turns an open request into a draft purchase order. The database repeats
-- the management and plant checks so the rule still holds even if the API is bypassed.
CREATE OR REPLACE FUNCTION public.convert_reorder_request(_request uuid)
RETURNS public.purchase_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  request_row public.reorder_requests;
  item public.stock_items;
  new_po public.purchase_orders;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role IN ('owner', 'manager')
  ) THEN
    RAISE EXCEPTION 'You do not have permission to raise a purchase order'
      USING errcode = '42501';
  END IF;

  SELECT *
    INTO request_row
    FROM public.reorder_requests
   WHERE id = _request
   FOR UPDATE;

  IF NOT FOUND OR request_row.status <> 'open' THEN
    RAISE EXCEPTION 'No such open reorder request'
      USING errcode = 'RF404';
  END IF;

  IF NOT EXISTS (
       SELECT 1
       FROM public.user_roles ur
       WHERE ur.user_id = auth.uid()
         AND ur.role = 'owner'
     )
     AND request_row.plant IS DISTINCT FROM (
       SELECT p.plant
       FROM public.profiles p
       WHERE p.id = auth.uid()
     ) THEN
    RAISE EXCEPTION 'No such open reorder request'
      USING errcode = 'RF404';
  END IF;

  SELECT *
    INTO item
    FROM public.stock_items
   WHERE id = request_row.stock_item_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such stock item'
      USING errcode = 'RF404';
  END IF;

  INSERT INTO public.purchase_orders (
    supplier_id,
    status,
    notes,
    plant
  )
  VALUES (
    item.supplier_id,
    'draft',
    'Created from reorder request ' || request_row.id,
    request_row.plant
  )
  RETURNING *
    INTO new_po;

  INSERT INTO public.po_lines (
    po_id,
    stock_item_id,
    qty,
    unit_cost
  )
  VALUES (
    new_po.id,
    request_row.stock_item_id,
    request_row.requested_qty,
    item.unit_cost
  );

  UPDATE public.purchase_orders
     SET total_cost = request_row.requested_qty * item.unit_cost
   WHERE id = new_po.id
  RETURNING *
    INTO new_po;

  UPDATE public.reorder_requests
     SET status = 'converted',
         converted_at = now(),
         purchase_order_id = new_po.id
   WHERE id = request_row.id;

  RETURN new_po;
END;
$$;

REVOKE ALL ON FUNCTION public.convert_reorder_request(uuid)
  FROM public, anon;

GRANT EXECUTE ON FUNCTION public.convert_reorder_request(uuid)
  TO authenticated;