-- T14 hardening: make the plant rule impossible to bypass.
--
-- The first T14 migration replaced one read policy on stock_items. A review found three
-- other holes: two policies on stock_items with no plant filter, and one on profiles that
-- lets a user change their own plant, which then defeats the plant check on every query.
-- This migration closes all of them, and adds the columns the earlier migration assumed
-- were already there but never created in the repo's history.
--
-- Every statement is idempotent. Running it against a database that already has the
-- columns, or the policies, is safe.

-- 1. The two columns the earlier migration assumed existed. Adding them here means a
--    fresh clone of the repo builds a schema the code can actually use.

alter table public.stock_items
  add column if not exists plant text;

alter table public.profiles
  add column if not exists plant text;

-- Make stock_items.plant required. Every existing row has a plant (verified before this
-- migration was written). profiles.plant stays nullable on purpose: the owner has no
-- plant and sees every plant, and the RLS policies test for the owner role explicitly.

alter table public.stock_items alter column plant set not null;

-- 2. Rewrite the three leaky policies on stock_items.
--
--    "Managers manage stock" had cmd=ALL with no plant filter, so a manager at plant A
--    could read, insert, update, delete any plant's stock.
--    "Staff update stock quantities" had cmd=UPDATE with qual = (uid=uid) — always true,
--    so any signed-in user including a worker could update any row.
--    "Staff read own plant stock" was correct, but is replaced here for consistency with
--    the naming scheme used on the other two tables.

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

-- Update: same shape. The plant column of the row must match the caller's plant (or the
-- caller is owner), AND the new plant value must match the caller's plant (or owner). That
-- second check stops a manager from moving stock to another plant via a PATCH.
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

-- 3. Same hardening on stock_levels, so the new table matches the rule the first one
--    should have had from the start.

drop policy if exists "stock_levels: read by plant" on public.stock_levels;
drop policy if exists "stock_levels: write by plant" on public.stock_levels;

create policy "stock_levels: read by plant"
  on public.stock_levels for select to authenticated
  using (
    exists (
      select 1 from public.user_roles ur
      where ur.user_id = auth.uid() and ur.role = 'owner'
    )
    or plant = (select p.plant from public.profiles p where p.id = auth.uid())
  );

create policy "stock_levels: insert by plant"
  on public.stock_levels for insert to authenticated
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

create policy "stock_levels: update by plant"
  on public.stock_levels for update to authenticated
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

create policy "stock_levels: delete by plant"
  on public.stock_levels for delete to authenticated
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

-- 4. Same hardening on purchase_orders. A PO carries cost and supplier data, so a worker
--    cannot see or create one at all. Owner and manager only, with the plant filter on
--    every command.

drop policy if exists "purchase_orders: read by plant" on public.purchase_orders;
drop policy if exists "purchase_orders: write by plant" on public.purchase_orders;
drop policy if exists "Managers manage POs" on public.purchase_orders;

create policy "purchase_orders: read by plant"
  on public.purchase_orders for select to authenticated
  using (
    exists (
      select 1 from public.user_roles ur
      where ur.user_id = auth.uid() and ur.role = 'owner'
    )
    or (
      exists (
        select 1 from public.user_roles ur
        where ur.user_id = auth.uid() and ur.role = 'manager'
      )
      and plant = (select p.plant from public.profiles p where p.id = auth.uid())
    )
  );

create policy "purchase_orders: insert by plant"
  on public.purchase_orders for insert to authenticated
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

create policy "purchase_orders: update by plant"
  on public.purchase_orders for update to authenticated
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

create policy "purchase_orders: delete by plant"
  on public.purchase_orders for delete to authenticated
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

-- 5. Lock profiles.plant against user edits.
--
--    "Users update own profile" lets a user update their own row. Without a column-level
--    guard, that means they can set plant = 'B' and pass the plant check on every query
--    that reads profiles.plant. The trigger below refuses any change to plant except by
--    the service role (i.e. the API, running under its own key).

create or replace function public.profiles_protect_plant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- auth.role() returns the JWT role. The service role bypasses this check; everyone else
  -- (anon, authenticated) can never change plant once it is set.
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

-- 6. Also refuse any attempt by a non-service role to change a stock_items row's plant.
--    The RLS policy above already stops this at the row level, but the trigger makes the
--    intent explicit and catches the case where RLS is later misconfigured.

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