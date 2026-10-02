-- T8: optimistic concurrency. Every editable record carries a version number that the
-- database raises on each update. A client must send the version it read; the API applies the
-- update only WHERE version matches, so the second of two overlapping saves changes nothing
-- and is refused instead of silently overwriting the first.

CREATE OR REPLACE FUNCTION public.bump_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Ignore whatever the client sent: the version only ever moves forward by one.
  NEW.version := OLD.version + 1;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.bump_version() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'clients', 'mines', 'equipment', 'suppliers',
    'stock_items', 'purchase_orders', 'po_lines',
    'maintenance_logs', 'maintenance_parts',
    'production_logs', 'static_costs', 'downtime_events',
    'employees', 'attendance', 'employee_transfers', 'fuel_slips'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_version ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_version BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.bump_version()',
      t, t
    );
  END LOOP;
END;
$$;
