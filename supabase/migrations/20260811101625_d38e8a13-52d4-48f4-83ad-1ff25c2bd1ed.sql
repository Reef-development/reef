CREATE TABLE public.fuel_slips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL DEFAULT current_date,
  mine_id uuid REFERENCES public.mines(id) ON DELETE SET NULL,
  equipment_id uuid REFERENCES public.equipment(id) ON DELETE SET NULL,
  vehicle_label text,
  slip_no text,
  fuel_type text NOT NULL DEFAULT 'diesel',
  litres numeric NOT NULL DEFAULT 0,
  cost_per_litre numeric NOT NULL DEFAULT 0,
  total_cost numeric NOT NULL DEFAULT 0,
  odometer numeric,
  hours_reading numeric,
  employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  notes text,
  photo_urls text[] NOT NULL DEFAULT '{}',
  logged_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.fuel_slips TO authenticated;
GRANT ALL ON public.fuel_slips TO service_role;

ALTER TABLE public.fuel_slips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff read fuel slips" ON public.fuel_slips
FOR SELECT TO authenticated USING (true);

CREATE POLICY "Staff insert fuel slips" ON public.fuel_slips
FOR INSERT TO authenticated WITH CHECK (logged_by IS NULL OR logged_by = auth.uid());

CREATE POLICY "Owners/managers update fuel slips" ON public.fuel_slips
FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = ANY (ARRAY['owner'::app_role,'manager'::app_role])))
WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = ANY (ARRAY['owner'::app_role,'manager'::app_role])));

CREATE POLICY "Owners delete fuel slips" ON public.fuel_slips
FOR DELETE TO authenticated
USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'owner'::app_role));

CREATE TRIGGER trg_fuel_slips_updated BEFORE UPDATE ON public.fuel_slips
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_fuel_slips_equipment ON public.fuel_slips(equipment_id);
CREATE INDEX idx_fuel_slips_date ON public.fuel_slips(date DESC);