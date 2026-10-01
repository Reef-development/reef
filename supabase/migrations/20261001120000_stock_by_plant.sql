
-- T14: the plant filter, enforced at the database level.
--
-- The API filters stock by plant in its own repository, but the prototype screens under
-- src/ read stock_items directly from Supabase. A filter that only lives in the API is
-- bypassed by any client that talks to Supabase directly. Row-level security is the only
-- place the rule cannot be skipped.
--
-- The old "Staff read stock" policy had qual = true, which let every signed-in user read
-- every row, whatever plant they belong to. It is replaced here with a plant-aware rule.

drop policy if exists "Staff read stock" on public.stock_items;

create policy "Staff read own plant stock"
  on public.stock_items
  for select
  to authenticated
  using (
    -- The owner sees every plant.
    exists (
      select 1 from public.user_roles ur
      where ur.user_id = auth.uid() and ur.role = 'owner'
    )
    -- Everyone else sees only their own plant. The plant comes from the caller's own
    -- profile, so a user cannot lie about which plant they belong to.
    or plant = (
      select p.plant from public.profiles p
      where p.id = auth.uid()
    )
  );