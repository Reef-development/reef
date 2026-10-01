-- T14: separate stock by plant.
--
-- This migration is self-contained: it creates the plant columns, installs the
-- plant-aware policies on stock_items, and locks stock_items.plant and profiles.plant
-- against user edits. A fresh database running migrations in timestamp order reaches
-- 140000 (purchase orders and stock_levels) with everything it needs already in place.
--
-- The three earlier policies on stock_items were unsafe:
--   "Staff read stock"             qual = true, so any signed-in user read every row
--   "Managers manage stock"        cmd=ALL, role check, no plant filter
--   "Staff update stock quantities" cmd=UPDATE, qual = (uid=uid), always true
-- All three are dropped and replaced with per-command plant-aware rules.

-- 1. The plant columns the rest of T14 assumes exist.

alter table public.stock_items
  add column if not exists plant text;

alter table public.profiles
  add column if not exists plant text;

-- stock_items.plant is required — every item belongs to exactly one plant.
-- profiles.plant stays nullable: the owner has no plant and sees every plant. The RLS
-- policies test for the owner role explicitly, not for a null plant.
alter table public.stock_items alter column plant set not null;

-- 2. Rewrite the stock_items policies.

drop policy if exists "Staff read stock" on public.stock_items;
drop policy if exists "Managers manage stock" on public.stock_items;
drop policy if exists "Staff update stock quantities" on public.stock_items;
drop policy if exists "Staff read own plant stock" on public.stock_items;

-- Read: owner sees every plant; everyone else sees only their own.
create policy "stock_items: read by plant"
  on public.stock_items for select to authenticated
  using (
    exists (
      select 1 from public.user_roles ur
      where ur.user_id = auth.uid() and ur.role = 'owner'
    )
    or plant = (select p.plant from public.profiles p where p.id = auth.uid())
  );

-- Insert: owner may insert for any plant; manager may insert only for their own plant.
-- A worker is not in the allowed roles, so this policy refuses them outright.
create policy "stock_items: insert by plant"
  on public.stock_items for insert to authenticated
  with check (
    exists (
      select 1 from public.user_roles ur
      where ur.user_id = auth.uid() and ur.role in ('owner', 'manager')
    )
    and (
      exists (
        select 1 from public.user_roles ur
        where ur.user_id = auth.uid() and ur.role = 'owner'
      )
      or plant = (select p.plant from public.profiles p where p.id = auth.uid())
    )
  );

-- Update: the row's plant must match the caller's (or the caller is owner), AND the new
-- plant value must match too. The second check stops a manager from moving a row into
-- another plant via a PATCH.
create policy "stock_items: update by plant"
  on public.stock_items for update to authenticated
  using (
    exists (
      select 1 from public.user_roles ur
      where ur.user_id = auth.uid() and ur.role in ('owner', 'manager')
    )
    and (
      exists (
        select 1 from public.user_roles ur
        where ur.user_id = auth.uid() and ur.role = 'owner'
      )
      or plant = (select p.plant from public.profiles p where p.id = auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.user_roles ur
      where ur.user_id = auth.uid() and ur.role in ('owner', 'manager')
    )
    and (
      exists (
        select 1 from public.user_roles ur
        where ur.user_id = auth.uid() and ur.role = 'owner'
      )
      or plant = (select p.plant from public.profiles p where p.id = auth.uid())
    )
  );

-- Delete: owner or manager, and only for their own plant (unless owner).
create policy "stock_items: delete by plant"
  on public.stock_items for delete to authenticated
  using (
    exists (
      select 1 from public.user_roles ur
      where ur.user_id = auth.uid() and ur.role in ('owner', 'manager')
    )
    and (
      exists (
        select 1 from public.user_roles ur
        where ur.user_id = auth.uid() and ur.role = 'owner'
      )
      or plant = (select p.plant from public.profiles p where p.id = auth.uid())
    )
  );

-- 3. Lock stock_items.plant against user edits. RLS already refuses a plant change at the
--    row level; this trigger is the second line of defence if RLS is ever misconfigured.

create or replace function public.stock_items_protect_plant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.plant is distinct from old.plant and auth.role() <> 'service_role' then
    raise exception 'stock_items.plant cannot be changed once set';
  end if;
  return new;
end;
$$;

drop trigger if exists stock_items_protect_plant_trigger on public.stock_items;
create trigger stock_items_protect_plant_trigger
  before update on public.stock_items
  for each row execute function public.stock_items_protect_plant();

-- 4. Lock profiles.plant against user edits. Without this, a user could set their own
--    plant to any value and defeat every plant-aware check on every table.

create or replace function public.profiles_protect_plant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.plant is distinct from old.plant and auth.role() <> 'service_role' then
    raise exception 'plant cannot be changed by a user';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_plant_trigger on public.profiles;
create trigger profiles_protect_plant_trigger
  before update on public.profiles
  for each row execute function public.profiles_protect_plant();