-- T11 security hardening:
-- Restrict managers to personal information belonging to employees at their own plant.
-- Owners retain access across all plants.

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
  _allowed := EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = _user_id
      AND (
        ur.role = 'owner'
        OR (
          ur.role = 'manager'
          AND EXISTS (
            SELECT 1
            FROM public.employees e
            JOIN public.mines m
              ON m.id = e.mine_id
            JOIN public.profiles p
              ON p.id = _user_id
            WHERE e.id = _employee_id
              AND p.plant IS NOT NULL
              AND m.plant = p.plant
          )
        )
      )
  );

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

  IF NOT _allowed THEN
    RETURN NULL;
  END IF;

  SELECT id_number
  INTO _id_number
  FROM public.employee_personal_information
  WHERE employee_id = _employee_id;

  RETURN _id_number;
END;
$$;

REVOKE ALL ON FUNCTION public.disclose_personal_information(uuid)
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.disclose_personal_information(uuid)
TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.set_employee_id_number(
  _employee_id uuid,
  _id_number text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_id uuid := auth.uid();
  _allowed boolean := false;
BEGIN
  _allowed := EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = _user_id
      AND (
        ur.role = 'owner'
        OR (
          ur.role = 'manager'
          AND EXISTS (
            SELECT 1
            FROM public.employees e
            JOIN public.mines m
              ON m.id = e.mine_id
            JOIN public.profiles p
              ON p.id = _user_id
            WHERE e.id = _employee_id
              AND p.plant IS NOT NULL
              AND m.plant = p.plant
          )
        )
      )
  );

  IF NOT _allowed THEN
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

REVOKE ALL ON FUNCTION public.set_employee_id_number(uuid, text)
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.set_employee_id_number(uuid, text)
TO authenticated, service_role;
