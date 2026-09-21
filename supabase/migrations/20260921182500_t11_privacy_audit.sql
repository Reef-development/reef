-- T11: Personal information lookup audit

CREATE TABLE IF NOT EXISTS public.personal_information_audit (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,

    employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,

    action text NOT NULL DEFAULT 'personal_information_lookup',

    allowed boolean NOT NULL,

    reason text,

    created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.personal_information_audit
ENABLE ROW LEVEL SECURITY;

-- Only owners and managers can view personal information audit records
CREATE POLICY "Managers can read personal information audit"
ON public.personal_information_audit
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role IN ('owner', 'manager')
  )
);

-- Authenticated users can create an audit record for their own lookup
CREATE POLICY "Users can create own personal information audit"
ON public.personal_information_audit
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
);