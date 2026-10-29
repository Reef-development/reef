-- T21: the indexes the report queries need.
--
-- The three queries T21 benchmarks all filter on date and scan the whole
-- production_logs table today. With 49,275 rows that is 7 to 19 ms per query.
-- At REEF's eventual scale the same queries would take seconds.
--
-- Each index below is justified by an EXPLAIN (ANALYZE) plan recorded in
-- docs/t21-bench-before.txt. The names say which query they help, so a future
-- reader can see whether the index is still earning its keep.
--
-- production_logs is append-heavy: every insert updates every index. Three
-- indexes is a considered cost, not an accident. Two single-purpose indexes
-- on the two paginated reads, plus one covering index for the site
-- comparison so the aggregate runs index-only.

-- 1. Dashboard: newest production rows for the current month.
--    Matches `where date >= X order by date desc limit 100`.
create index if not exists production_logs_date_desc_idx
  on public.production_logs (date desc);

-- 2. Analytics: newest production rows for one mine over the last month.
--    The leading mine_id column lets the planner seek directly to the mine;
--    the date column then walks backward from the newest.
create index if not exists production_logs_mine_date_desc_idx
  on public.production_logs (mine_id, date desc);

-- 3. Site comparison: tonnage and cost per mine for the last twelve months.
--    Covering so the aggregate reads the index and never the table. Column
--    order matters: date is the filter, then the group key, then the three
--    sums. Because production_logs is append-only, the extra width costs
--    little compared to the read it saves.
create index if not exists production_logs_site_comparison_idx
  on public.production_logs (date, mine_id, tons_produced, magnetite_cost, overtime_cost);