-- T10 part B: a month-end report that a late entry has changed shows as out of date.
--
-- The monthly report (T24) is worked out from the records each time it is asked for, and
-- nothing kept a note of having produced it. The task sheet assumed "the system already stores
-- a fingerprint of the records each report was built from"; it did not. This adds that note:
--
--   * report_runs: one row per site and month whose report has been produced, with when, by
--     whom, and a fingerprint of the records it was built from (counts, totals and the latest
--     change, across every table the report reads).
--   * A trigger on each of those tables. When an entry dated in a reported month is added,
--     changed or removed after the report was made, the report is marked out of date, with when
--     and what changed it. It is in the database, so it holds however the entry arrives.
--
-- Only a report made after its month had ended is marked. A report of the month still running
-- is expected to change as the month's entries arrive; that run is recorded as not final.

create table if not exists public.report_runs (
  id uuid primary key default gen_random_uuid(),
  mine_id uuid not null references public.mines(id) on delete cascade,
  month date not null check (month = date_trunc('month', month)::date),
  fingerprint text not null,
  generated_by uuid,
  generated_at timestamptz not null default now(),
  -- False when the month had not ended at generated_at (in South African time).
  month_complete boolean not null,
  stale_since timestamptz,
  stale_reason text,
  unique (mine_id, month)
);

alter table public.report_runs enable row level security;
revoke all on public.report_runs from anon, authenticated;
grant select on public.report_runs to authenticated;

-- The same people who may read reports: owners and managers.
drop policy if exists "report_runs: read by owner and manager" on public.report_runs;
create policy "report_runs: read by owner and manager"
  on public.report_runs
  for select
  to authenticated
  using (
    exists (
      select 1 from public.user_roles ur
      where ur.user_id = auth.uid() and ur.role in ('owner', 'manager')
    )
  );

-- 1. The fingerprint: what the report for one site and month is built from, in one string. If
--    any entry it reads is added, changed or removed, the string changes.

create or replace function public.report_fingerprint(_mine uuid, _month date)
returns text
language sql
stable
security definer
set search_path = public
as $$
  with bounds as (
    select _month as from_day, (_month + interval '1 month')::date as to_day
  )
  select md5(concat_ws('|',
    (select concat_ws(',', count(*), coalesce(sum(tons_produced), 0), coalesce(sum(magnetite_cost), 0),
                      coalesce(sum(overtime_cost), 0), max(updated_at))
       from production_logs, bounds where mine_id = _mine and date >= from_day and date < to_day),
    (select concat_ws(',', count(*), coalesce(sum(total_cost), 0), max(updated_at))
       from fuel_slips, bounds where mine_id = _mine and date >= from_day and date < to_day),
    (select concat_ws(',', count(*), coalesce(sum(m.total_cost), 0), max(m.updated_at))
       from maintenance_logs m join equipment e on e.id = m.equipment_id, bounds
      where e.mine_id = _mine and m.date >= from_day and m.date < to_day),
    (select concat_ws(',', count(*), coalesce(sum(duration_hours), 0), max(updated_at))
       from downtime_events, bounds
      where mine_id = _mine and start_time >= from_day and start_time < to_day),
    (select concat_ws(',', count(*), coalesce(sum(amount), 0), max(updated_at))
       from static_costs where (mine_id = _mine or mine_id is null) and month = _month)
  ));
$$;

revoke all on function public.report_fingerprint(uuid, date) from public, anon, authenticated;

-- 2. Recording a run. Called by the API each time it produces the monthly report. It replaces
--    the site and month's previous run, so a report made again after going out of date is
--    current again. Returns the previous run (if any) and the new one.

create or replace function public.record_report_run(_mine uuid, _month date)
returns table (
  previous_generated_at timestamptz,
  previous_stale_since timestamptz,
  previous_stale_reason text,
  generated_at timestamptz,
  month_complete boolean,
  fingerprint text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  _prev public.report_runs;
  _complete boolean;
  _row public.report_runs;
begin
  if not exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role in ('owner', 'manager')
  ) then
    raise exception 'Only owners and managers produce reports' using errcode = '42501';
  end if;
  if _month <> date_trunc('month', _month)::date then
    raise exception 'A report month starts on the first day' using errcode = '22023';
  end if;

  select * into _prev from public.report_runs where mine_id = _mine and month = _month;
  _complete := (now() at time zone 'Africa/Johannesburg')::date >= (_month + interval '1 month')::date;

  insert into public.report_runs (mine_id, month, fingerprint, generated_by, generated_at, month_complete)
  values (_mine, _month, public.report_fingerprint(_mine, _month), auth.uid(), now(), _complete)
  on conflict (mine_id, month) do update
    set fingerprint = excluded.fingerprint,
        generated_by = excluded.generated_by,
        generated_at = excluded.generated_at,
        month_complete = excluded.month_complete,
        stale_since = null,
        stale_reason = null
  returning * into _row;

  return query select _prev.generated_at, _prev.stale_since, _prev.stale_reason,
                      _row.generated_at, _row.month_complete, _row.fingerprint;
end;
$$;

revoke all on function public.record_report_run(uuid, date) from public, anon;
grant execute on function public.record_report_run(uuid, date) to authenticated;

-- 3. Marking out of date. Each source table says which site and day an entry belongs to; the
--    report for that month, if one was made after the month ended, is marked, once, with the
--    first change that did it.

create or replace function public.mark_report_stale(_mine uuid, _day date, _what text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if _day is null then return; end if;
  update public.report_runs
     set stale_since = now(),
         stale_reason = _what
   where month = date_trunc('month', _day)::date
     and (mine_id = _mine or _mine is null)
     and month_complete
     and stale_since is null;
end;
$$;

revoke all on function public.mark_report_stale(uuid, date, text) from public, anon, authenticated;

create or replace function public.report_source_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _verb text := case tg_op when 'INSERT' then 'added' when 'UPDATE' then 'changed' else 'removed' end;
  _label text := case tg_table_name
    when 'production_logs' then 'production entry'
    when 'fuel_slips' then 'fuel slip'
    when 'maintenance_logs' then 'repair'
    when 'downtime_events' then 'downtime entry'
    when 'static_costs' then 'fixed cost'
    else tg_table_name end;
  _r jsonb;
  _mine uuid;
  _day date;
begin
  -- An update can move an entry to another month or site, so the old and the new place are
  -- both checked.
  foreach _r in array array_remove(array[
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end
  ], null) loop
    _mine := nullif(_r ->> 'mine_id', '')::uuid;
    _day := case tg_table_name
      when 'downtime_events' then ((_r ->> 'start_time')::timestamptz at time zone 'Africa/Johannesburg')::date
      when 'static_costs' then (_r ->> 'month')::date
      else (_r ->> 'date')::date
    end;
    if tg_table_name = 'maintenance_logs' then
      select e.mine_id into _mine from public.equipment e where e.id = (_r ->> 'equipment_id')::uuid;
    end if;
    -- A fixed cost with no site is company-wide and counts in every site's report; anything
    -- else with no site is in no site's report.
    continue when _mine is null and tg_table_name <> 'static_costs';
    perform public.mark_report_stale(
      _mine,
      _day,
      format('A %s dated %s was %s after this report was made.', _label, to_char(_day, 'FMDD Mon YYYY'), _verb)
    );
  end loop;
  return coalesce(new, old);
end;
$$;

revoke all on function public.report_source_changed() from public, anon, authenticated;

do $$
declare
  _table text;
begin
  foreach _table in array array['production_logs', 'fuel_slips', 'maintenance_logs', 'downtime_events', 'static_costs'] loop
    execute format('drop trigger if exists trg_%s_report_stale on public.%I', _table, _table);
    execute format(
      'create trigger trg_%s_report_stale after insert or update or delete on public.%I
       for each row execute function public.report_source_changed()',
      _table, _table
    );
  end loop;
end;
$$;
