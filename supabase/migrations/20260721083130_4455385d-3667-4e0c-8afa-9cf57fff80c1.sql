
-- Add worker role
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'worker';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'manager';

-- Photo attachments on maintenance
ALTER TABLE public.maintenance_logs
  ADD COLUMN IF NOT EXISTS photo_urls text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS logged_by uuid REFERENCES auth.users(id);

-- Downtime events
CREATE TABLE IF NOT EXISTS public.downtime_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mine_id uuid REFERENCES public.mines(id) ON DELETE SET NULL,
  equipment_id uuid REFERENCES public.equipment(id) ON DELETE SET NULL,
  reason text NOT NULL CHECK (reason IN ('breakdown','no_stock','waiting_on_part','planned_maintenance','other')),
  start_time timestamptz NOT NULL DEFAULT now(),
  duration_hours numeric NOT NULL DEFAULT 0,
  estimated_cost numeric NOT NULL DEFAULT 0,
  notes text,
  photo_urls text[] NOT NULL DEFAULT '{}',
  logged_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.downtime_events TO authenticated;
GRANT ALL ON public.downtime_events TO service_role;

ALTER TABLE public.downtime_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read downtime" ON public.downtime_events
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert downtime" ON public.downtime_events
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = logged_by OR logged_by IS NULL);
CREATE POLICY "Owners/managers can update downtime" ON public.downtime_events
  FOR UPDATE TO authenticated USING (
    public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'manager')
  );
CREATE POLICY "Owners can delete downtime" ON public.downtime_events
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'owner'));

CREATE TRIGGER update_downtime_events_updated_at
  BEFORE UPDATE ON public.downtime_events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
