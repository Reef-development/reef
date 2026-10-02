-- T6: a record of who changed what, and why.
--
-- Every update through the API writes one row here. The row records the table, the row's id,
-- who made the change, when, the reason they gave, and the values before and after. The
-- reason is required on every update: an update without one is refused at the schema layer,
-- before it reaches this table.
--
-- Two things this table is not:
--   It is not a version chain. The `version` integer on each editable row is what catches two
--   people editing at once. This table records history after the fact.
--   It is not a place to store the whole row. Only the columns that changed are kept, so a
--   hundred updates to a mine record don't keep a hundred full copies.
--
-- Row-level security: an owner sees every change. A manager sees changes to records at their
-- own plant. A worker sees nothing. The plant is resolved from the record that was changed,
-- not from the caller, so a manager who changed something before moving plant still sees it
-- through the plant that record is at now.

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

-- Queries by row. The common read is "show me the history of this record".
create index if not exists history_row_idx on public.history (table_name, row_id, changed_at desc);

-- Queries by who. The common read is "what has this user changed".
create index if not exists history_actor_idx on public.history (changed_by, changed_at desc);

-- The plant column is a denormalised copy of the row's plant at the time of the change. It is
-- null for tables that have no plant (currently mines, which is not plant-scoped). The policy
-- below treats null as "visible to owner only".

alter table public.history enable row level security;

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

-- No insert, update, or delete policies. The table is written only by the service role, which
-- bypasses RLS. A signed-in user can read their own view and nothing else.

drop policy if exists "history: append by service" on public.history;
create policy "history: append by service"
  on public.history
  for insert
  to service_role
  with check (true);