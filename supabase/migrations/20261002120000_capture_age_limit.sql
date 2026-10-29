-- T10: refuse very old entries.
--
-- An entry captured long after the day it describes changes figures that have already been
-- reported and acted on. The owner sets how old an entry may be when it arrives (60 days by
-- default); the API refuses anything older with a reason the worker can read, and this
-- trigger is the second line of defence for any client that writes to the database directly.
--
-- The rule binds signed-in users only. Data-loading scripts and migrations run as other
-- roles and are not limited, so history can still be loaded on purpose (e.g. T21's
-- three years of test data).

-- ---------------------------------------------------------------------------
-- 1. Settings the owner can change.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  description text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

GRANT SELECT ON public.settings TO authenticated;
GRANT UPDATE (value, updated_at, updated_by) ON public.settings TO authenticated;
GRANT ALL ON public.settings TO service_role;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "settings: read by staff" ON public.settings;
CREATE POLICY "settings: read by staff" ON public.settings FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "settings: change by owner" ON public.settings;
CREATE POLICY "settings: change by owner" ON public.settings FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'owner'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'owner'));

-- A setting's value must make sense, whoever writes it.
CREATE OR REPLACE FUNCTION public.validate_setting()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.key = 'capture_max_age_days' THEN
    IF jsonb_typeof(NEW.value) <> 'number'
       OR (NEW.value #>> '{}')::numeric <> trunc((NEW.value #>> '{}')::numeric)
       OR (NEW.value #>> '{}')::int NOT BETWEEN 1 AND 365 THEN
      RAISE EXCEPTION 'The capture age limit must be a whole number of days from 1 to 365'
        USING ERRCODE = '22023';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_settings_validate ON public.settings;
CREATE TRIGGER trg_settings_validate BEFORE INSERT OR UPDATE ON public.settings
  FOR EACH ROW EXECUTE FUNCTION public.validate_setting();

INSERT INTO public.settings (key, value, description)
VALUES ('capture_max_age_days', '60', 'How many days old an entry may be when it is captured.')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. The limit, and the trigger that applies it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.capture_max_age_days()
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT (value #>> '{}')::int FROM public.settings WHERE key = 'capture_max_age_days'), 60);
$$;

CREATE OR REPLACE FUNCTION public.refuse_late_capture()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  max_age integer;
  today date := (now() AT TIME ZONE 'Africa/Johannesburg')::date;
  age integer;
BEGIN
  IF current_user <> 'authenticated' OR NEW.date IS NULL THEN
    RETURN NEW;
  END IF;
  max_age := public.capture_max_age_days();
  age := today - NEW.date;
  IF age > max_age THEN
    RAISE EXCEPTION 'This entry is dated %, which is % days ago. Entries older than % days can''t be captured. If it still needs recording, speak to your site manager.',
      to_char(NEW.date, 'DD Mon YYYY'), age, max_age
      USING ERRCODE = 'RF422';
  END IF;
  RETURN NEW;
END; $$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['production_logs', 'fuel_slips', 'maintenance_logs'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_capture_age ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_capture_age BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.refuse_late_capture()',
      t, t
    );
  END LOOP;
END;
$$;
