-- T6: a record of who changed what, and why.
--
-- Every change to a versioned record writes one row to `history`: the table, the row's id,
-- who changed it, when, the reason, and only the values that changed (before and after).
--
-- How the reason gets here. The API updates a record through `update_versioned`, which puts
-- the caller's reason on the transaction (set_config(..., true), so it cannot leak into
-- another request on a pooled connection) and runs the UPDATE. A trigger on the table reads
-- the reason and writes the history row in the same transaction, so a change and the record
-- of it land together or not at all. The trigger is SECURITY DEFINER because a signed-in user
-- may not write to `history` directly.
--
-- The API refuses a change without a reason (the schema requires it, and so does
-- `update_versioned`). Two other kinds of change still happen without one, and must not be
-- refused, because refusing them broke other features when this was tested on a real
-- database:
--   * A change made by another trigger: logging a repair part takes it off stock, receiving a
--     purchase order adds to stock, adding a line recalculates the order total. These are
--     recorded as automatic. If the change that set them off came through the API, they
--     carry its reason instead, since they are part of the same change.
--   * A change made straight against Supabase, by screens not yet moved to the API (WBS 5.2).
--     These are recorded as "not given", so the history still shows that something changed
--     and who changed it.
--
-- This file is safe to run again on a database that has an earlier version of it applied:
-- every statement replaces or drops what it creates first.

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

-- "Show me the history of this record", newest first.
create index if not exists history_row_idx on public.history (table_name, row_id, changed_at desc);
-- "What has this person changed."
create index if not exists history_actor_idx on public.history (changed_by, changed_at desc);

-- 2. Who may read it. An owner reads everything. A manager reads changes to records at their
--    own plant. A worker reads nothing. Rows are written only by the trigger, and there is no
--    update or delete policy for anyone, so a signed-in user cannot alter or remove history.
--
--    The manager's plant is read with to_jsonb(p) ->> 'plant' rather than p.plant, so this
--    works whether or not T14 (which adds profiles.plant) has run yet. Before T14 the value
--    is null and a manager simply sees nothing.

alter table public.history enable row level security;

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
    and plant = (select to_jsonb(p) ->> 'plant' from public.profiles p where p.id = auth.uid())
  );

-- Supabase grants every new table to anon and authenticated by default. Take the writes back,
-- so a forged or rewritten history row is refused outright, not just filtered by a policy.
revoke all on public.history from anon, authenticated;
grant select on public.history to authenticated;

-- 3. The trigger. It writes one row per changed record, with only the columns that changed.
--    `version` and `updated_at` change on every save, so they are left out; a save that
--    changes nothing else writes no row.

create or replace function public.write_history_on_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _reason text;
  _old jsonb := '{}'::jsonb;
  _new jsonb := '{}'::jsonb;
  _key text;
begin
  _reason := nullif(btrim(coalesce(current_setting('app.change_reason', true), '')), '');
  if _reason is null then
    -- pg_trigger_depth() is 1 for a statement a person ran, and higher when another
    -- trigger issued this update.
    _reason := case
      when pg_trigger_depth() > 1 then 'Automatic: updated by the system after a related change'
      else 'Not given: changed outside the API'
    end;
  end if;

  for _key in select jsonb_object_keys(to_jsonb(new)) loop
    if _key not in ('version', 'updated_at')
      and (to_jsonb(old) -> _key) is distinct from (to_jsonb(new) -> _key) then
      _old := _old || jsonb_build_object(_key, to_jsonb(old) -> _key);
      _new := _new || jsonb_build_object(_key, to_jsonb(new) -> _key);
    end if;
  end loop;

  if _new = '{}'::jsonb then
    return new;
  end if;

  insert into public.history (
    table_name, row_id, changed_by, reason, plant, old_values, new_values, version
  ) values (
    tg_table_name,
    (to_jsonb(new) ->> 'id')::uuid,
    coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid),
    _reason,
    to_jsonb(new) ->> 'plant',
    _old,
    _new,
    coalesce((to_jsonb(new) ->> 'version')::integer, 0)
  );

  return new;
end;
$$;

revoke all on function public.write_history_on_update() from public, anon, authenticated;

-- 4. Attach it to every table that carries a version (T8), so a table added later with a
--    version column only needs this block run again. Found from the catalogue, not a list,
--    so it cannot drift from T8's list.

do $$
declare
  _table text;
begin
  for _table in
    select c.table_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public'
      and c.column_name = 'version'
      and t.table_type = 'BASE TABLE'
      and c.table_name <> 'history'
  loop
    execute format('drop trigger if exists write_history_on_update on public.%I', _table);
    execute format(
      'create trigger write_history_on_update after update on public.%I
       for each row execute function public.write_history_on_update()',
      _table
    );
  end loop;
end;
$$;

-- 5. The one way the API updates a versioned record. It takes the table name, so every
--    versioned table uses the same code and a new column needs no change here.
--
--    * Only tables with a version column are accepted, and the name is quoted with %I.
--    * Only columns that exist on the table and appear in the patch are set; id, version,
--      created_at and updated_at never are. A key sent as null sets the column to null, so a
--      field can be cleared.
--    * Values are typed by jsonb_populate_record against the table's own row type.
--    * SECURITY INVOKER: row-level security still decides what the caller may change.
--    * Returns the updated row, or null when no row matched the id and version (the API then
--      reads the row to tell "someone saved first" from "does not exist").

drop function if exists public.update_mines(uuid, jsonb, integer, text);
drop function if exists public.update_stock_items(uuid, jsonb, integer, text);
drop function if exists public.update_stock_levels(uuid, jsonb, integer, text);
drop function if exists public.update_purchase_orders(uuid, jsonb, integer, text);
drop function if exists public.update_clients(uuid, jsonb, integer, text);
drop function if exists public.update_suppliers(uuid, jsonb, integer, text);

create or replace function public.update_versioned(
  p_table text,
  p_id uuid,
  p_patch jsonb,
  p_expected_version integer,
  p_reason text
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  _columns text;
  _row jsonb;
begin
  if p_table = 'history' or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = p_table and column_name = 'version'
  ) then
    raise exception 'Records in % cannot be changed this way', p_table using errcode = '22023';
  end if;

  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'A reason is required when changing a record' using errcode = '23514';
  end if;

  select string_agg(format('%I', c.column_name), ', ' order by c.ordinal_position)
    into _columns
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = p_table
    and p_patch ? c.column_name
    and c.column_name not in ('id', 'version', 'created_at', 'updated_at');

  if _columns is null then
    -- Nothing to change. Answer as an update would, without writing.
    execute format('select to_jsonb(t) from public.%I t where t.id = $1 and t.version = $2', p_table)
      into _row using p_id, p_expected_version;
    return _row;
  end if;

  perform set_config('app.change_reason', btrim(p_reason), true);

  execute format(
    'update public.%1$I t set (%2$s) = (select %2$s from jsonb_populate_record(null::public.%1$I, $1))
     where t.id = $2 and t.version = $3
     returning to_jsonb(t)',
    p_table, _columns
  ) into _row using p_patch, p_id, p_expected_version;

  return _row;
end;
$$;

revoke all on function public.update_versioned(text, uuid, jsonb, integer, text) from public, anon;
grant execute on function public.update_versioned(text, uuid, jsonb, integer, text) to authenticated;
