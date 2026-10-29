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
-- The identity number no longer lives on employees: T11 moved it into
-- employee_personal_information, which application users cannot read at all. The comment
-- therefore goes where the column now is.
COMMENT ON COLUMN public.employee_personal_information.id_number IS
  'Personal information. Retention: identity period, five years after the employee''s left_on, then cleared. The employee row itself stays.';
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

-- Which leavers still have an identity number stored.
--
-- The retention report needs a yes or no per person and nothing more. Reading the number to
-- answer a question about the number would put identity numbers into a response body, a server
-- log and a browser cache for no reason, and application users are revoked from that table in
-- any case. This answers from inside the database, returns no numbers, and refuses anybody but
-- the owner, in the same shape as T11's own disclosure function.
CREATE OR REPLACE FUNCTION public.employees_holding_identity_number()
RETURNS TABLE (employee_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Read user_roles directly rather than through has_role(), which is revoked from
  -- `authenticated` by migration 20260726151633.
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid() AND ur.role = 'owner'::public.app_role
  ) THEN
    RAISE EXCEPTION 'Only the owner may read the retention report'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT epi.employee_id
  FROM public.employee_personal_information epi
  WHERE epi.id_number IS NOT NULL
    AND epi.id_number <> '';
END;
$$;

REVOKE ALL ON FUNCTION public.employees_holding_identity_number() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.employees_holding_identity_number() TO authenticated, service_role;
