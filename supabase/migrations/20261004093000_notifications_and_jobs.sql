-- T24. Notifications, and the scheduled sweep that raises them.
--
-- The service reminder is the one notification nobody asks for. Every other figure in this
-- system exists because a person captured it; a machine falling due is a date passing, and no
-- row is written when a date passes. So only something running on a schedule will ever notice,
-- and only a record of each run will ever show that it stopped running.

-- ---------- Notifications ----------

CREATE TYPE public.notification_kind AS ENUM ('service_due');

CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind public.notification_kind NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  equipment_id uuid REFERENCES public.equipment(id) ON DELETE CASCADE,
  mine_id uuid REFERENCES public.mines(id) ON DELETE SET NULL,
  -- What makes this notification the same one as a previous notification. Required, so that the
  -- suppression rule below can be a plain unique constraint rather than a partial index. A
  -- genuinely one-off notification carries a key of its own rather than carrying none.
  dedupe_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  emailed_at timestamptz
);

-- The suppression rule, as a plain constraint on every row.
--
-- The obvious design is a partial index carrying WHERE dedupe_key IS NOT NULL, so that a
-- notification with no key may repeat. It was rejected on purpose. PostgreSQL only uses a
-- partial index for ON CONFLICT when the statement repeats the same WHERE clause, and the
-- API reaches this table through PostgREST, whose on_conflict parameter takes column names and
-- has no way to express an index predicate. The insert would therefore never match the index
-- and would fail with 42P10 every time, which no in-memory test can catch.
--
-- Requiring the key instead makes the constraint plain, makes it matchable, and makes the
-- invariant stronger: every notification can say what would make it a repeat.
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_dedupe UNIQUE (user_id, dedupe_key);

CREATE INDEX idx_notifications_user_unread
  ON public.notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;

GRANT SELECT, UPDATE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- A person reads their own notifications and nobody else's, whatever their role. There is no
-- INSERT policy for authenticated on purpose: notifications are raised by the sweep, which runs
-- as the service role. Nobody can send themselves, or anybody else, a notification.
CREATE POLICY "Users read own notifications" ON public.notifications FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users mark own notifications read" ON public.notifications FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ---------- Job runs ----------

CREATE TABLE public.job_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job text NOT NULL,
  -- The calendar day the run is for, in REEF's own time zone, not the day it happened to start.
  ran_for date NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  outcome text,
  detail text,
  UNIQUE (job, ran_for)
);

-- A day with no row is a day the sweep did not run. That is the whole point of the table: the
-- absence is the evidence, so the rows are never deleted.
CREATE INDEX idx_job_runs_for ON public.job_runs (job, ran_for DESC);

GRANT SELECT ON public.job_runs TO authenticated;
GRANT ALL ON public.job_runs TO service_role;
ALTER TABLE public.job_runs ENABLE ROW LEVEL SECURITY;

-- The role is checked by reading user_roles directly rather than through has_role(), because
-- migration 20260726151633 revokes has_role from `authenticated`: a policy that called it would
-- fail with "permission denied for function has_role" for the very owner it is meant to admit.
-- Every other policy in this schema checks a role the same way.
CREATE POLICY "Owners read job runs" ON public.job_runs FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'owner'::public.app_role
    )
  );
