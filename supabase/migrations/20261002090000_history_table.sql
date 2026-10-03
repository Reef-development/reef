-- T6: a record of who changed what, and why.
--
-- The first version of this migration added the history table and expected the API to
-- write to it after every update. A review found two problems with that:
--
--   1. The API runs as the caller's own token (by design — the API holds no service-role
--      key), so its INSERT into history was refused by RLS. The error was caught and
--      logged, and the update still returned 200. Every edit in production would have
--      silently lost its audit trail while looking completely fine.
--
--   2. A best-effort write after the update is not atomic. If the process died between
--      the UPDATE and the history INSERT, the change was real but the record of it was
--      not.
--
-- Both are fixed here with a database trigger. The trigger is SECURITY DEFINER, so it
-- runs with the table owner's privileges and bypasses RLS to write the history row. It
-- runs inside the same transaction as the UPDATE, so either both land or neither does.
-- It fires for any client — the API, a direct-Supabase write, an admin SQL session.
--
-- The reason comes from a session variable set by the RPC that performs the update. The
-- RPC is the only way to update a versioned table from the API. It sets the reason with
-- set_config(..., true), which is transaction-local, so no reason can leak between
-- requests even on a pooled connection.
--
-- A third problem was also raised: this migration's RLS policies reference
-- profiles.plant, which T14 adds. If T6 ran before T14, the migration would fail. The
-- column is now added here defensively with IF NOT EXISTS, so the order does not matter.

-- 1. The history table.

create table if not exists public.history (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  row_id uuid not null,
  changed_by uuid not null,
  changed_at timestamp with time zone not null default now(),
  reason text not null,
  plant text,
  old_values jsonb not null default '{}'::jsonb,
  new_values jsonb not null default '{}'::jsonb,
  version integer not null
);

create index if not exists history_row_idx on public.history (table_name, row_id, changed_at desc);
create index if not exists history_actor_idx on public.history (changed_by, changed_at desc);

-- 2. Ensure profiles.plant exists. T14 adds it, but T6 references it. IF NOT EXISTS
--    makes this a no-op if T14 already ran, and creates the column if it did not.

alter table public.profiles add column if not exists plant text;

-- 3. Row-level security on history. The trigger bypasses RLS to write, so there is no
--    INSERT policy for authenticated users. Reads are filtered by plant.

alter table public.history enable row level security;

-- Drop the older INSERT policy from the first version of this migration. That version
-- expected a service-role writer; there is no such writer in this project, and the
-- trigger handles writes now. Dropping it keeps the fresh-clone path identical to what
-- has already been applied to the dev database.
drop policy if exists "history: append by service" on public.history;

drop policy if exists "history: read by owner" on public.history;
create policy "history: read by owner"
  on public.history
  for select
  to authenticated
  using (
    exists (
      select 1 from public.user_roles ur
      where ur.user_id = auth.uid() and ur.role = 'owner'
    )
  );

drop policy if exists "history: read by own plant" on public.history;
create policy "history: read by own plant"
  on public.history
  for select
  to authenticated
  using (
    plant is not null
    and exists (
      select 1 from public.user_roles ur
      where ur.user_id = auth.uid() and ur.role = 'manager'
    )
    and plant = (
      select p.plant from public.profiles p where p.id = auth.uid()
    )
  );

-- No UPDATE or DELETE policy, for any role. Once written, a history row cannot be
-- changed or removed by a signed-in user. This is what makes the table append-only.

-- 4. The trigger function. It reads the reason from the session variable set by the
--    calling RPC, diffs the row, and inserts a history row. If the reason is missing, it
--    raises, which rolls the whole update back.

create or replace function public.write_history_on_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _reason text;
  _actor uuid;
  _old jsonb := '{}'::jsonb;
  _new jsonb := '{}'::jsonb;
  _key text;
  _plant text;
begin
  _reason := coalesce(current_setting('app.change_reason', true), '');
  if _reason = '' then
    raise exception 'A reason is required when changing a record'
      using errcode = 'check_violation';
  end if;

  _actor := coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid);

  for _key in select jsonb_object_keys(to_jsonb(new)) loop
    if (to_jsonb(old) -> _key) is distinct from (to_jsonb(new) -> _key) then
      _old := _old || jsonb_build_object(_key, to_jsonb(old) -> _key);
      _new := _new || jsonb_build_object(_key, to_jsonb(new) -> _key);
    end if;
  end loop;

  if (to_jsonb(new) ? 'plant') then
    _plant := to_jsonb(new) ->> 'plant';
  end if;

  insert into public.history (
    table_name, row_id, changed_by, reason, plant, old_values, new_values, version
  ) values (
    TG_TABLE_NAME,
    (to_jsonb(new) ->> 'id')::uuid,
    _actor,
    _reason,
    _plant,
    _old,
    _new,
    coalesce((to_jsonb(new) ->> 'version')::integer, 0)
  );

  return new;
end;
$$;

-- 5. Attach the trigger to every table that has a version column. The IF EXISTS check
--    keeps the migration order-independent: some of these tables are added by T14.

do $$
declare
  _table text;
  _tables text[] := array[
    'mines',
    'stock_items',
    'stock_levels',
    'purchase_orders',
    'clients',
    'suppliers'
  ];
begin
  foreach _table in array _tables loop
    if exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = _table
    ) then
      execute format('drop trigger if exists write_history_on_update on public.%I', _table);
      execute format(
        'create trigger write_history_on_update
         after update on public.%I
         for each row execute function public.write_history_on_update()',
        _table
      );
    end if;
  end loop;
end;
$$;

-- 6. One RPC per versioned table. The RPC sets the reason, runs the UPDATE, and returns
--    the updated row. The trigger fires inside the RPC's transaction and reads the
--    reason. If the reason is missing or empty, the trigger raises and the whole thing
--    rolls back — there is no code path that lets the update land without its audit row.

-- mines
create or replace function public.update_mines(
  p_id uuid,
  p_patch jsonb,
  p_expected_version integer,
  p_reason text
) returns setof public.mines
language plpgsql
security invoker
as $$
begin
  perform set_config('app.change_reason', p_reason, true);
  return query
  update public.mines set
    name = coalesce((p_patch ->> 'name'), name),
    client_id = coalesce((p_patch ->> 'client_id')::uuid, client_id),
    location = coalesce((p_patch ->> 'location'), location),
    team_name = coalesce((p_patch ->> 'team_name'), team_name),
    target_cost_per_ton = coalesce((p_patch ->> 'target_cost_per_ton')::numeric, target_cost_per_ton),
    active = coalesce((p_patch ->> 'active')::boolean, active),
    version = version + 1,
    updated_at = now()
  where id = p_id and version = p_expected_version
  returning *;
end;
$$;

-- stock_items
create or replace function public.update_stock_items(
  p_id uuid,
  p_patch jsonb,
  p_expected_version integer,
  p_reason text
) returns setof public.stock_items
language plpgsql
security invoker
as $$
begin
  perform set_config('app.change_reason', p_reason, true);
  return query
  update public.stock_items set
    name = coalesce((p_patch ->> 'name'), name),
    sku = coalesce((p_patch ->> 'sku'), sku),
    unit = coalesce((p_patch ->> 'unit'), unit),
    unit_cost = coalesce((p_patch ->> 'unit_cost')::numeric, unit_cost),
    supplier_id = coalesce((p_patch ->> 'supplier_id')::uuid, supplier_id),
    version = version + 1,
    updated_at = now()
  where id = p_id and version = p_expected_version
  returning *;
end;
$$;

-- stock_levels
create or replace function public.update_stock_levels(
  p_id uuid,
  p_patch jsonb,
  p_expected_version integer,
  p_reason text
) returns setof public.stock_levels
language plpgsql
security invoker
as $$
begin
  perform set_config('app.change_reason', p_reason, true);
  return query
  update public.stock_levels set
    qty_on_hand = coalesce((p_patch ->> 'qty_on_hand')::numeric, qty_on_hand),
    reorder_point = coalesce((p_patch ->> 'reorder_point')::numeric, reorder_point),
    reorder_qty = coalesce((p_patch ->> 'reorder_qty')::numeric, reorder_qty),
    version = version + 1,
    updated_at = now()
  where id = p_id and version = p_expected_version
  returning *;
end;
$$;

-- purchase_orders
create or replace function public.update_purchase_orders(
  p_id uuid,
  p_patch jsonb,
  p_expected_version integer,
  p_reason text
) returns setof public.purchase_orders
language plpgsql
security invoker
as $$
begin
  perform set_config('app.change_reason', p_reason, true);
  return query
  update public.purchase_orders set
    supplier_id = coalesce((p_patch ->> 'supplier_id')::uuid, supplier_id),
    status = coalesce((p_patch ->> 'status')::public.po_status, status),
    total_cost = coalesce((p_patch ->> 'total_cost')::numeric, total_cost),
    notes = coalesce((p_patch ->> 'notes'), notes),
    version = version + 1,
    updated_at = now()
  where id = p_id and version = p_expected_version
  returning *;
end;
$$;

-- clients
create or replace function public.update_clients(
  p_id uuid,
  p_patch jsonb,
  p_expected_version integer,
  p_reason text
) returns setof public.clients
language plpgsql
security invoker
as $$
begin
  perform set_config('app.change_reason', p_reason, true);
  return query
  update public.clients set
    name = coalesce((p_patch ->> 'name'), name),
    contact_name = coalesce((p_patch ->> 'contact_name'), contact_name),
    contact_email = coalesce((p_patch ->> 'contact_email'), contact_email),
    contact_phone = coalesce((p_patch ->> 'contact_phone'), contact_phone),
    contract_start = coalesce((p_patch ->> 'contract_start')::date, contract_start),
    contract_end = coalesce((p_patch ->> 'contract_end')::date, contract_end),
    contract_revenue_monthly = coalesce((p_patch ->> 'contract_revenue_monthly')::numeric, contract_revenue_monthly),
    active = coalesce((p_patch ->> 'active')::boolean, active),
    notes = coalesce((p_patch ->> 'notes'), notes),
    version = version + 1,
    updated_at = now()
  where id = p_id and version = p_expected_version
  returning *;
end;
$$;

-- suppliers
create or replace function public.update_suppliers(
  p_id uuid,
  p_patch jsonb,
  p_expected_version integer,
  p_reason text
) returns setof public.suppliers
language plpgsql
security invoker
as $$
begin
  perform set_config('app.change_reason', p_reason, true);
  return query
  update public.suppliers set
    name = coalesce((p_patch ->> 'name'), name),
    contact_name = coalesce((p_patch ->> 'contact_name'), contact_name),
    email = coalesce((p_patch ->> 'email'), email),
    phone = coalesce((p_patch ->> 'phone'), phone),
    notes = coalesce((p_patch ->> 'notes'), notes),
    version = version + 1,
    updated_at = now()
  where id = p_id and version = p_expected_version
  returning *;
end;
$$;

-- 7. Grants. The RPCs run as the caller (security invoker) so RLS still applies to the
--    UPDATE inside them. Only signed-in users may call them.

grant execute on function public.update_mines(uuid, jsonb, integer, text) to authenticated;
grant execute on function public.update_stock_items(uuid, jsonb, integer, text) to authenticated;
grant execute on function public.update_stock_levels(uuid, jsonb, integer, text) to authenticated;
grant execute on function public.update_purchase_orders(uuid, jsonb, integer, text) to authenticated;
grant execute on function public.update_clients(uuid, jsonb, integer, text) to authenticated;
grant execute on function public.update_suppliers(uuid, jsonb, integer, text) to authenticated;