-- Daily operations: the money and stock rules move into the database, so every client (web,
-- mobile, a script) gets the same answer and none of them can send a total that disagrees
-- with its own parts.

-- ---------------------------------------------------------------------------
-- 1. Fuel slip total = litres x price per litre. Never taken from the client.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fuel_slip_total()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.total_cost := round(coalesce(NEW.litres, 0) * coalesce(NEW.cost_per_litre, 0), 2);
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_fuel_slips_total ON public.fuel_slips;
CREATE TRIGGER trg_fuel_slips_total BEFORE INSERT OR UPDATE ON public.fuel_slips
  FOR EACH ROW EXECUTE FUNCTION public.fuel_slip_total();

-- ---------------------------------------------------------------------------
-- 2. Maintenance: parts cost is the sum of the parts; total = labour + parts.
-- ---------------------------------------------------------------------------

-- A part logged without a price takes the stock item's current unit cost.
CREATE OR REPLACE FUNCTION public.maintenance_part_default_cost()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF coalesce(NEW.unit_cost, 0) = 0 AND NEW.stock_item_id IS NOT NULL THEN
    SELECT unit_cost INTO NEW.unit_cost FROM public.stock_items WHERE id = NEW.stock_item_id;
    NEW.unit_cost := coalesce(NEW.unit_cost, 0);
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_maintenance_parts_cost ON public.maintenance_parts;
CREATE TRIGGER trg_maintenance_parts_cost BEFORE INSERT ON public.maintenance_parts
  FOR EACH ROW EXECUTE FUNCTION public.maintenance_part_default_cost();

-- Keeps the log's parts_cost equal to its parts. SECURITY DEFINER because a worker may add
-- parts to a repair they log but may not otherwise update the log row.
CREATE OR REPLACE FUNCTION public.refresh_maintenance_parts_cost()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  log_id uuid := coalesce(NEW.maintenance_id, OLD.maintenance_id);
BEGIN
  UPDATE public.maintenance_logs
     SET parts_cost = coalesce((SELECT sum(qty * unit_cost) FROM public.maintenance_parts WHERE maintenance_id = log_id), 0)
   WHERE id = log_id;
  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS trg_maintenance_parts_refresh ON public.maintenance_parts;
CREATE TRIGGER trg_maintenance_parts_refresh AFTER INSERT OR UPDATE OR DELETE ON public.maintenance_parts
  FOR EACH ROW EXECUTE FUNCTION public.refresh_maintenance_parts_cost();

CREATE OR REPLACE FUNCTION public.maintenance_log_total()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.total_cost := coalesce(NEW.labour_cost, 0) + coalesce(NEW.parts_cost, 0);
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_maintenance_logs_total ON public.maintenance_logs;
CREATE TRIGGER trg_maintenance_logs_total BEFORE INSERT OR UPDATE ON public.maintenance_logs
  FOR EACH ROW EXECUTE FUNCTION public.maintenance_log_total();

-- A part removed from a repair (logged in error) goes back on the shelf.
CREATE OR REPLACE FUNCTION public.return_stock_on_part_removed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.stock_item_id IS NOT NULL THEN
    UPDATE public.stock_items SET qty_on_hand = qty_on_hand + OLD.qty WHERE id = OLD.stock_item_id;
  END IF;
  RETURN OLD;
END; $$;

DROP TRIGGER IF EXISTS trg_maintenance_parts_return ON public.maintenance_parts;
CREATE TRIGGER trg_maintenance_parts_return AFTER DELETE ON public.maintenance_parts
  FOR EACH ROW EXECUTE FUNCTION public.return_stock_on_part_removed();

-- ---------------------------------------------------------------------------
-- 3. One reorder rule, used by both repairs and plain stock usage.
-- ---------------------------------------------------------------------------

-- If an item is at or below its reorder point, make sure a draft order line exists for it.
-- This is the logic that was inside consume_stock_on_maintenance, lifted out unchanged so
-- stock usage can call it too (before, usage never triggered a reorder).
CREATE OR REPLACE FUNCTION public.ensure_reorder(_item uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  item RECORD;
  existing_po UUID;
BEGIN
  SELECT * INTO item FROM public.stock_items WHERE id = _item;
  IF NOT FOUND OR item.qty_on_hand > item.reorder_point OR item.reorder_qty <= 0 THEN RETURN; END IF;

  SELECT po.id INTO existing_po
    FROM public.purchase_orders po
    JOIN public.po_lines pl ON pl.po_id = po.id
   WHERE po.status = 'draft'
     AND po.supplier_id IS NOT DISTINCT FROM item.supplier_id
     AND pl.stock_item_id = item.id
   LIMIT 1;
  IF existing_po IS NOT NULL THEN RETURN; END IF;

  SELECT id INTO existing_po FROM public.purchase_orders
   WHERE status = 'draft' AND supplier_id IS NOT DISTINCT FROM item.supplier_id
   ORDER BY created_at DESC LIMIT 1;
  IF existing_po IS NULL THEN
    INSERT INTO public.purchase_orders (supplier_id, status, notes)
    VALUES (item.supplier_id, 'draft', 'Auto-generated: stock below reorder point')
    RETURNING id INTO existing_po;
  END IF;

  INSERT INTO public.po_lines (po_id, stock_item_id, qty, unit_cost)
  VALUES (existing_po, item.id, item.reorder_qty, item.unit_cost);

  UPDATE public.purchase_orders
     SET total_cost = coalesce((SELECT sum(qty * unit_cost) FROM public.po_lines WHERE po_id = existing_po), 0)
   WHERE id = existing_po;
END; $$;

REVOKE ALL ON FUNCTION public.ensure_reorder(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.consume_stock_on_maintenance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.stock_item_id IS NULL THEN RETURN NEW; END IF;
  UPDATE public.stock_items SET qty_on_hand = qty_on_hand - NEW.qty WHERE id = NEW.stock_item_id;
  PERFORM public.ensure_reorder(NEW.stock_item_id);
  RETURN NEW;
END; $$;

-- ---------------------------------------------------------------------------
-- 4. Stock usage as one operation. The prototype read the quantity in the browser, subtracted,
--    and wrote the result back: two workers at once lost an update, and no reorder fired.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_stock_usage(_item uuid, _qty numeric)
RETURNS public.stock_items LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  result public.stock_items;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Your account has no role' USING ERRCODE = '42501';
  END IF;
  IF _qty IS NULL OR _qty <= 0 THEN
    RAISE EXCEPTION 'Quantity must be more than zero' USING ERRCODE = '22023';
  END IF;

  -- Subtract in the UPDATE itself, so concurrent usage adds up instead of overwriting.
  -- Stock may go below zero: the part was physically used, and refusing the entry would only
  -- lose the record. A negative count is a signal to recount, and the reorder still fires.
  UPDATE public.stock_items SET qty_on_hand = qty_on_hand - _qty WHERE id = _item RETURNING * INTO result;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such stock item' USING ERRCODE = 'RF404';
  END IF;

  PERFORM public.ensure_reorder(_item);
  RETURN result;
END; $$;

REVOKE ALL ON FUNCTION public.record_stock_usage(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_stock_usage(uuid, numeric) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. A repair and its parts saved together, or not at all.
--    SECURITY INVOKER: the caller's own row-level security applies to both inserts.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_maintenance_log(_log jsonb, _parts jsonb DEFAULT '[]'::jsonb)
RETURNS public.maintenance_logs LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  created public.maintenance_logs;
  part jsonb;
BEGIN
  INSERT INTO public.maintenance_logs (
    equipment_id, date, description, labour_hours, labour_cost, downtime_hours,
    next_due_date, next_due_tons, performed_by, photo_urls, logged_by
  )
  SELECT r.equipment_id, coalesce(r.date, current_date), r.description,
         coalesce(r.labour_hours, 0), coalesce(r.labour_cost, 0), coalesce(r.downtime_hours, 0),
         r.next_due_date, r.next_due_tons, r.performed_by, coalesce(r.photo_urls, '{}'), auth.uid()
    FROM jsonb_populate_record(NULL::public.maintenance_logs, _log) AS r
  RETURNING * INTO created;

  FOR part IN SELECT value FROM jsonb_array_elements(coalesce(_parts, '[]'::jsonb)) LOOP
    INSERT INTO public.maintenance_parts (maintenance_id, stock_item_id, qty, unit_cost)
    VALUES (created.id, (part->>'stock_item_id')::uuid, (part->>'qty')::numeric, coalesce((part->>'unit_cost')::numeric, 0));
  END LOOP;

  -- Re-read so the returned row carries the parts cost and total the triggers worked out.
  SELECT * INTO created FROM public.maintenance_logs WHERE id = created.id;
  RETURN created;
END; $$;

REVOKE ALL ON FUNCTION public.create_maintenance_log(jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_maintenance_log(jsonb, jsonb) TO authenticated;
