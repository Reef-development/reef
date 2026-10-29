-- T11: Secure personal information access

-- Audit history must remain append-only.
DROP POLICY IF EXISTS "Managers can update personal information audit"
ON public.personal_information_audit;

DROP POLICY IF EXISTS "Managers can delete personal information audit"
ON public.personal_information_audit;

DROP POLICY IF EXISTS "Users can create own personal information audit"
ON public.personal_information_audit;


-- Personal information access is recorded as a disclosure.
ALTER TABLE public.personal_information_audit
ALTER COLUMN action SET DEFAULT 'disclose';

-- Update existing lookup audit rows to use the required action name.
UPDATE public.personal_information_audit
SET action = 'disclose'
WHERE action = 'personal_information_lookup';



-- Store identity numbers separately from general employee records.
CREATE TABLE public.employee_personal_information (
  employee_id uuid PRIMARY KEY
    REFERENCES public.employees(id) ON DELETE CASCADE,
  id_number text
);

ALTER TABLE public.employee_personal_information
ENABLE ROW LEVEL SECURITY;


-- Preserve existing identity numbers before removing the old column.
INSERT INTO public.employee_personal_information (
  employee_id,
  id_number
)
SELECT
  id,
  id_number
FROM public.employees
WHERE id_number IS NOT NULL;


-- Remove identity numbers from the generally readable employee records.
ALTER TABLE public.employees
DROP COLUMN id_number;


-- Personal information must not be directly accessible to application users.
REVOKE ALL ON TABLE public.employee_personal_information
FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public.employee_personal_information
TO service_role;


-- Securely disclose an employee's identity number.
-- Authorization and auditing happen inside the database.
CREATE OR REPLACE FUNCTION public.disclose_personal_information(
  _employee_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_id uuid := auth.uid();
  _allowed boolean := false;
  _id_number text;
BEGIN
  -- Check authorization on the server rather than in React.
  _allowed := public.is_manager(_user_id);

  -- Record both successful and refused disclosure attempts.
  -- The identity number itself is never written to the audit history.
  INSERT INTO public.personal_information_audit (
    user_id,
    employee_id,
    action,
    allowed,
    reason
  )
  VALUES (
    _user_id,
    _employee_id,
    'disclose',
    _allowed,
    CASE
      WHEN _allowed THEN 'Personal information disclosure allowed'
      ELSE 'Personal information disclosure refused'
    END
  );

  -- Refused attempts are recorded above, but no personal information
  -- is returned to the caller.
  IF NOT _allowed THEN
    RETURN NULL;
  END IF;

  -- Only an authorized disclosure reaches the protected table.
  SELECT id_number
  INTO _id_number
  FROM public.employee_personal_information
  WHERE employee_id = _employee_id;

  RETURN _id_number;
END;
$$;


-- Users cannot call the disclosure function anonymously.
REVOKE ALL ON FUNCTION public.disclose_personal_information(uuid)
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.disclose_personal_information(uuid)
TO authenticated, service_role;


-- Securely create or update an employee's identity number.
CREATE OR REPLACE FUNCTION public.set_employee_id_number(
  _employee_id uuid,
  _id_number text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only owners and managers may change personal information.
  IF NOT public.is_manager(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized to update personal information';
  END IF;

  INSERT INTO public.employee_personal_information (
    employee_id,
    id_number
  )
  VALUES (
    _employee_id,
    NULLIF(_id_number, '')
  )
  ON CONFLICT (employee_id)
  DO UPDATE SET
    id_number = EXCLUDED.id_number;
END;
$$;


-- Users cannot call the update function anonymously.
REVOKE ALL ON FUNCTION public.set_employee_id_number(uuid, text)
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.set_employee_id_number(uuid, text)
TO authenticated, service_role;