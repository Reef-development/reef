-- T9: Reefie answer number-check log
-- Records every time Reefie's drafted answer is checked against the fetched figures, so the
-- fallback rate can be seen over time (not just whether any single answer passed or failed).

CREATE TABLE IF NOT EXISTS public.reefie_answer_checks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,

    thread_id uuid REFERENCES public.reefie_threads(id) ON DELETE SET NULL,

    passed boolean NOT NULL,

    -- Numbers pulled out of the draft that could not be matched to any fetched figure. Empty
    -- when passed = true.
    unverified_numbers jsonb NOT NULL DEFAULT '[]'::jsonb,

    created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.reefie_answer_checks
ENABLE ROW LEVEL SECURITY;

-- Only owners and managers can see the check log (it can reveal what a user asked about).
CREATE POLICY "Managers can read reefie answer checks"
ON public.reefie_answer_checks
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

-- The API logs a check under the calling user's own id.
CREATE POLICY "Users can create own reefie answer check"
ON public.reefie_answer_checks
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
);

-- Append-only, same reasoning as T11's audit table: nobody, including owners, should be able to
-- quietly erase evidence that a fallback happened. No UPDATE or DELETE policy is added.
