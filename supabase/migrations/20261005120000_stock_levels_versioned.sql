-- T14A: a stock level is edited like every other record.
--
-- T14 added stock_levels without the version column every editable table has had since T8, so
-- the API's version check on a level referred to a column that did not exist and every edit of a
-- quantity or reorder point failed. It also had no history trigger, so those edits, the most
-- frequent change to stock, were not recorded with their reason.
--
-- This gives stock_levels the same three things the other tables have: a version that rises on
-- every save (bump_version, T8), the history trigger (T6), and so a way to be updated through
-- update_versioned with a reason.

alter table public.stock_levels add column if not exists version integer not null default 1;

drop trigger if exists trg_stock_levels_version on public.stock_levels;
create trigger trg_stock_levels_version
  before update on public.stock_levels
  for each row execute function public.bump_version();

drop trigger if exists write_history_on_update on public.stock_levels;
create trigger write_history_on_update
  after update on public.stock_levels
  for each row execute function public.write_history_on_update();

-- Supabase grants new tables to signed-in users by default; say so here, so the table works the
-- same everywhere. Row-level security (T14) still decides which plant's rows each person reaches.
grant select, insert, update, delete on public.stock_levels to authenticated;
