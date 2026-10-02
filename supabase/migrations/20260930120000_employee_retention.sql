-- T11A. Retention periods, as REEF instructed them.
--
-- REEF answered in writing: an identity number is kept for five years after the person leaves,
-- and all other employee information for seven to ten years. Two things were missing before
-- this migration. There was no leaving date, so neither period had anything to be measured
-- from; and nothing in the database said which rule covered which column, so the rule lived
-- only in a document. The periods themselves are settings in the API, not values here, because
-- REEF may move them.

ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS left_on date;

COMMENT ON COLUMN public.employees.left_on IS
  'The date employment ended. Both retention periods are measured from it. Null while the person is still employed.';

-- Only leavers have a period running, so the index carries only them.
CREATE INDEX IF NOT EXISTS idx_employees_left_on
  ON public.employees (left_on)
  WHERE left_on IS NOT NULL;

-- Which rule covers which column, recorded where the column is, so that somebody reading the
-- table can see it without finding the privacy document first. shared/src/retention.ts is the
-- statement the code acts on; these comments exist so the two cannot quietly disagree.
COMMENT ON COLUMN public.employees.id_number IS
  'Personal information. Retention: identity period, five years after left_on, then cleared. The row itself stays.';
COMMENT ON COLUMN public.employees.full_name IS
  'Personal information. Retention: record period, seven years after left_on.';
COMMENT ON COLUMN public.employees.employee_no IS
  'Personal information. Retention: record period, seven years after left_on.';
COMMENT ON COLUMN public.employees.phone IS
  'Personal information. Retention: record period, seven years after left_on.';
COMMENT ON COLUMN public.employees.hourly_rate IS
  'Personal information. Retention: record period, seven years after left_on.';
COMMENT ON COLUMN public.employees.notes IS
  'Personal information, free text. Retention: record period, seven years after left_on.';
