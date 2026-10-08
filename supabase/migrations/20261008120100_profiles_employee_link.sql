-- ============================================================================
-- Link a signed-in user to the employee record they represent.
--
-- profiles.full_name holds the email address, not the person's name, so there
-- was no way to match a worker to their own records. employee_id fixes that.
-- Existing rows are left NULL — an owner isn't an employee, and existing
-- worker accounts get mapped by hand.
-- ============================================================================

alter table public.profiles
  add column if not exists employee_id uuid references public.employees(id);

comment on column public.profiles.employee_id is
  'The employee this signed-in user represents. NULL for owners and admins.';