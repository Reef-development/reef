-- T22 follow-up for T14: the stock rules work on each plant's own levels.
--
-- T14 moved quantities and reorder levels to stock_levels, one row per part per plant, but the
-- rules that change stock still changed stock_items.qty_on_hand: a repair part taken off the
-- shelf, a part returned, stock usage, a delivery received, and the reorder rule. Left alone,
-- the two counts would drift apart after the first change.
--
-- After this migration:
--   * Every rule changes the level at the item's own plant (a stock item belongs to one plant).
--   * The reorder rule reads that level, and a draft order it raises carries the plant.
--   * Recording usage refuses an item from another plant as "no such stock item", the same
--     not-found answer the API gives, so it does not confirm the item exists.
--   * stock_levels and the old quantity columns on stock_items are kept equal in both
--     directions. T14 keeps those columns because the prototype under src/ still reads and
--     writes them. When the prototype is retired, drop the two sync triggers and the columns.

-- 1. The level for an item at its own plant, made from the item's old figures if it has none.

create or replace function public.stock_level_of(_item uuid)
returns public.stock_levels
language plpgsql
security definer
set search_path = public
as $$
declare
  _level public.stock_levels;
begin
  insert into public.stock_levels (stock_item_id, plant, qty_on_hand, reorder_point, reorder_qty)
  select s.id, s.plant, s.qty_on_hand, s.reorder_point, s.reorder_qty
  from public.stock_items s
  where s.id = _item
  on conflict (stock_item_id, plant) do nothing;

  select l.* into _level
  from public.stock_levels l
  join public.stock_items s on s.id = l.stock_item_id and s.plant = l.plant
  where l.stock_item_id = _item;
  return _level;
end;
$$;

-- 2. Add to or take from an item's stock, at its plant. Subtracting inside the UPDATE means two
--    changes at once add up instead of one overwriting the other.

create or replace function public.adjust_stock(_item uuid, _delta numeric)
returns public.stock_levels
language plpgsql
security definer
set search_path = public
as $$
declare
  _level public.stock_levels;
begin
  perform public.stock_level_of(_item);
  update public.stock_levels l
     set qty_on_hand = l.qty_on_hand + _delta
    from public.stock_items s
   where s.id = _item and l.stock_item_id = s.id and l.plant = s.plant
  returning l.* into _level;
  return _level;
end;
$$;

revoke all on function public.stock_level_of(uuid) from public, anon, authenticated;
revoke all on function public.adjust_stock(uuid, numeric) from public, anon, authenticated;

-- 3. The reorder rule, reading the plant's level. Unchanged otherwise: if the item is at or
--    below its reorder point, make sure a draft order line exists for it, on a draft for the
--    same supplier and the same plant.

create or replace function public.ensure_reorder(_item uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  item record;
  level public.stock_levels;
  existing_po uuid;
begin
  select * into item from public.stock_items where id = _item;
  if not found then return; end if;
  level := public.stock_level_of(_item);
  if level.qty_on_hand > level.reorder_point or level.reorder_qty <= 0 then return; end if;

  select po.id into existing_po
    from public.purchase_orders po
    join public.po_lines pl on pl.po_id = po.id
   where po.status = 'draft'
     and po.plant = item.plant
     and po.supplier_id is not distinct from item.supplier_id
     and pl.stock_item_id = item.id
   limit 1;
  if existing_po is not null then return; end if;

  select id into existing_po from public.purchase_orders
   where status = 'draft' and plant = item.plant
     and supplier_id is not distinct from item.supplier_id
   order by created_at desc limit 1;
  if existing_po is null then
    insert into public.purchase_orders (supplier_id, status, notes, plant)
    values (item.supplier_id, 'draft', 'Auto-generated: stock below reorder point', item.plant)
    returning id into existing_po;
  end if;

  insert into public.po_lines (po_id, stock_item_id, qty, unit_cost)
  values (existing_po, item.id, level.reorder_qty, item.unit_cost);

  update public.purchase_orders
     set total_cost = coalesce((select sum(qty * unit_cost) from public.po_lines where po_id = existing_po), 0)
   where id = existing_po;
end;
$$;

-- 4. The rules that change stock now go through adjust_stock.

create or replace function public.consume_stock_on_maintenance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.stock_item_id is null then return new; end if;
  perform public.adjust_stock(new.stock_item_id, -new.qty);
  perform public.ensure_reorder(new.stock_item_id);
  return new;
end;
$$;

create or replace function public.return_stock_on_part_removed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.stock_item_id is not null then
    perform public.adjust_stock(old.stock_item_id, old.qty);
  end if;
  return old;
end;
$$;

create or replace function public.receive_po()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  line record;
begin
  if new.status = 'received' and (old.status is distinct from 'received') then
    for line in select stock_item_id, qty from public.po_lines where po_id = new.id and stock_item_id is not null loop
      perform public.adjust_stock(line.stock_item_id, line.qty);
    end loop;
    new.received_at := now();
  end if;
  if new.status = 'approved' and old.status is distinct from 'approved' then
    new.approved_at := now();
  end if;
  if new.status = 'ordered' and old.status is distinct from 'ordered' then
    new.ordered_at := now();
  end if;
  return new;
end;
$$;

-- 5. Stock usage. It runs with elevated rights so it can change the level, so it checks the
--    plant itself: a worker or manager can only use stock at their own plant. An item at another
--    plant answers "no such stock item", like the API.

create or replace function public.record_stock_usage(_item uuid, _qty numeric)
returns public.stock_items
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.stock_items;
  _plant text;
begin
  if not exists (select 1 from public.user_roles where user_id = auth.uid()) then
    raise exception 'Your account has no role' using errcode = '42501';
  end if;
  if _qty is null or _qty <= 0 then
    raise exception 'Quantity must be more than zero' using errcode = '22023';
  end if;

  select plant into _plant from public.stock_items where id = _item;
  if _plant is null
     or (
       not exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'owner')
       and _plant is distinct from (select to_jsonb(p) ->> 'plant' from public.profiles p where p.id = auth.uid())
     ) then
    raise exception 'No such stock item' using errcode = 'RF404';
  end if;

  -- Stock may go below zero: the part was physically used, and refusing the entry would only
  -- lose the record. A negative count is a signal to recount, and the reorder still fires.
  perform public.adjust_stock(_item, -_qty);
  perform public.ensure_reorder(_item);
  select * into result from public.stock_items where id = _item;
  return result;
end;
$$;

revoke all on function public.record_stock_usage(uuid, numeric) from public, anon;
grant execute on function public.record_stock_usage(uuid, numeric) to authenticated;

-- 6. Keep the two counts equal until the prototype stops using stock_items' columns. Each side
--    only writes when the value differs, so a change bounces once and stops. A new item does
--    not get a level from this: the API adds the item and then its level, and a level made
--    here first would make that second step fail. The rules above make one when they need it.

create or replace function public.sync_level_to_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.stock_items s
     set qty_on_hand = new.qty_on_hand,
         reorder_point = new.reorder_point,
         reorder_qty = new.reorder_qty
   where s.id = new.stock_item_id
     and s.plant = new.plant
     and (s.qty_on_hand, s.reorder_point, s.reorder_qty)
         is distinct from (new.qty_on_hand, new.reorder_point, new.reorder_qty);
  return new;
end;
$$;

create or replace function public.sync_item_to_level()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.stock_levels l
     set qty_on_hand = new.qty_on_hand,
         reorder_point = new.reorder_point,
         reorder_qty = new.reorder_qty
   where l.stock_item_id = new.id
     and l.plant = new.plant
     and (l.qty_on_hand, l.reorder_point, l.reorder_qty)
         is distinct from (new.qty_on_hand, new.reorder_point, new.reorder_qty);
  -- An item the prototype made has no level yet; its first change makes one.
  if not found then
    perform public.stock_level_of(new.id);
  end if;
  return new;
end;
$$;

revoke all on function public.sync_level_to_item() from public, anon, authenticated;
revoke all on function public.sync_item_to_level() from public, anon, authenticated;

drop trigger if exists trg_stock_levels_sync_item on public.stock_levels;
create trigger trg_stock_levels_sync_item
  after insert or update of qty_on_hand, reorder_point, reorder_qty on public.stock_levels
  for each row execute function public.sync_level_to_item();

drop trigger if exists trg_stock_items_sync_level on public.stock_items;
create trigger trg_stock_items_sync_level
  after update of qty_on_hand, reorder_point, reorder_qty on public.stock_items
  for each row execute function public.sync_item_to_level();

-- Items that exist already get their level now, so nothing waits for its first change.
select public.stock_level_of(id) from public.stock_items;
