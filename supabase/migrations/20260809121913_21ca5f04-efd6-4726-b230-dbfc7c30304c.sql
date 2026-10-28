CREATE TYPE public.shift_slot AS ENUM ('morning','midday','night');
CREATE TYPE public.attendance_status AS ENUM ('present','absent','late','leave','sick');

CREATE TABLE public.employees (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  employee_no text unique,
  position text,
  phone text,
  id_number text,
  hire_date date,
  mine_id uuid references public.mines(id) on delete set null,
  shift public.shift_slot not null default 'morning',
  team_name text,
  hourly_rate numeric not null default 0,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employees TO authenticated;
GRANT ALL ON public.employees TO service_role;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Managers manage employees" ON public.employees FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = ANY (ARRAY['owner'::public.app_role,'manager'::public.app_role])))
WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = ANY (ARRAY['owner'::public.app_role,'manager'::public.app_role])));
CREATE POLICY "Staff read employees" ON public.employees FOR SELECT TO authenticated USING (true);

CREATE TABLE public.employee_transfers (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  from_mine_id uuid references public.mines(id) on delete set null,
  to_mine_id uuid references public.mines(id) on delete set null,
  transfer_date date not null default current_date,
  reason text,
  created_at timestamptz not null default now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_transfers TO authenticated;
GRANT ALL ON public.employee_transfers TO service_role;
ALTER TABLE public.employee_transfers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Managers manage transfers" ON public.employee_transfers FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = ANY (ARRAY['owner'::public.app_role,'manager'::public.app_role])))
WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = ANY (ARRAY['owner'::public.app_role,'manager'::public.app_role])));
CREATE POLICY "Staff read transfers" ON public.employee_transfers FOR SELECT TO authenticated USING (true);

CREATE TABLE public.attendance (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  mine_id uuid references public.mines(id) on delete set null,
  date date not null default current_date,
  shift public.shift_slot not null default 'morning',
  status public.attendance_status not null default 'present',
  hours_worked numeric not null default 0,
  overtime_hours numeric not null default 0,
  tons_contributed numeric not null default 0,
  notes text,
  logged_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, date, shift)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance TO authenticated;
GRANT ALL ON public.attendance TO service_role;
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Managers manage attendance" ON public.attendance FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = ANY (ARRAY['owner'::public.app_role,'manager'::public.app_role])))
WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = ANY (ARRAY['owner'::public.app_role,'manager'::public.app_role])));
CREATE POLICY "Staff read attendance" ON public.attendance FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff insert attendance" ON public.attendance FOR INSERT TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid()));

ALTER TABLE public.production_logs ADD COLUMN IF NOT EXISTS shift public.shift_slot;
ALTER TABLE public.production_logs ADD COLUMN IF NOT EXISTS team_name text;

CREATE TRIGGER trg_employees_updated BEFORE UPDATE ON public.employees FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_attendance_updated BEFORE UPDATE ON public.attendance FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_attendance_emp_date ON public.attendance(employee_id, date);
CREATE INDEX idx_employees_mine ON public.employees(mine_id);