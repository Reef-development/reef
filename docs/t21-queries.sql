-- T21: the queries the reports run, written down so the benchmark is
-- repeatable and so the reviewer can check the shape.
--
-- Each query has the pagination limit the app should apply. The screens today
-- fetch the whole table and paginate in the browser; that is a separate
-- finding and not fixed in this task. What we measure here is what the query
-- would cost if it were asked for the rows it actually needs.
--
-- Run each with EXPLAIN (ANALYZE, BUFFERS) against the dev database after
-- seeding with scripts/seed-perf.mjs.

-- 1. The dashboard's most recent production read.
--    The screen shows the current month; the newest rows first.
select *
from public.production_logs
where date >= date_trunc('month', current_date)
order by date desc
limit 100;

-- 2. The per-mine recent read.
--    Analytics drills into one mine; the newest rows for that mine.
select *
from public.production_logs
where mine_id = '00000000-0000-0000-0000-000000000001'
  and date >= current_date - interval '30 days'
order by date desc
limit 100;

-- 3. The site comparison aggregate.
--    Total tonnage and cost per mine for the last twelve months. This is the
--    query the site-comparison report actually needs; it should run in under
--    500ms.
select
  mine_id,
  sum(tons_produced)::numeric as tons,
  sum(magnetite_cost)::numeric as magnetite_cost,
  sum(overtime_cost)::numeric as overtime_cost,
  count(*)::int as rows_counted
from public.production_logs
where date >= current_date - interval '12 months'
group by mine_id
order by tons desc;