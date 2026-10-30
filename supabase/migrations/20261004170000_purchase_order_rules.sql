-- T22 (purchasing): the rules a purchase order follows, kept in the database so a direct PATCH
-- or the prototype cannot skip them.
--
--   * Its lines can only be added, changed or removed while it is a draft, and only for stock at
--     the order's own plant. A manager can only touch lines on orders they can see (T14's
--     plant rule on purchase_orders carries through).
--   * Its total is always the sum of its lines, never typed in.
--   * Its status moves one way:
--         draft    -> approved | cancelled
--         approved -> ordered | received | cancelled      ("ordered" is optional)
--         ordered  -> received | cancelled
--     Received and cancelled are final. Receiving adds the stock once (receive_po), and because
--     received is final, the same delivery can never be received twice.
--   * An order with no lines cannot be approved.
--
-- po_transition is the one call the API uses to move an order on. It takes an optional reason,
-- which the history (T6) records when it is present.

-- 1. Lines belong to an order the caller can see, and only managers and the owner touch them.

drop policy if exists "Managers manage PO lines" on public.po_lines;
create policy "Managers manage PO lines"
  on public.po_lines
  for all
  to authenticated
  using (
    exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role in ('owner', 'manager'))
    and exists (select 1 from public.purchase_orders po where po.id = po_lines.po_id)
  )
  with check (
    exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role in ('owner', 'manager'))
    and exists (select 1 from public.purchase_orders po where po.id = po_lines.po_id)
  );

-- 2. Lines change only on a draft, and only for stock at the order's plant.

create or replace function public.guard_po_lines()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _po uuid := coalesce(new.po_id, old.po_id);
  _status public.po_status;
  _plant text;
begin
  select status, plant into _status, _plant from public.purchase_orders where id = _po;
  if not found then
    -- The order itself is being deleted, and its lines go with it.
    return coalesce(new, old);
  end if;
  if _status is distinct from 'draft' then
    raise exception 'Lines can only be changed while the order is a draft. This order is %.', _status
      using errcode = 'RF409';
  end if;
  if tg_op <> 'DELETE' and new.stock_item_id is not null
     and (select plant from public.stock_items where id = new.stock_item_id) is distinct from _plant then
    raise exception 'That stock item is not at this order''s plant' using errcode = 'RF404';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_po_lines_guard on public.po_lines;
create trigger trg_po_lines_guard
  before insert or update or delete on public.po_lines
  for each row execute function public.guard_po_lines();

-- 3. The total is the sum of the lines.

create or replace function public.po_total(_po uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(qty * unit_cost), 0) from public.po_lines where po_id = _po;
$$;

create or replace function public.refresh_po_total()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.purchase_orders
     set total_cost = public.po_total(id)
   where id = coalesce(new.po_id, old.po_id)
     and total_cost is distinct from public.po_total(id);
  return null;
end;
$$;

drop trigger if exists trg_po_lines_total on public.po_lines;
create trigger trg_po_lines_total
  after insert or update or delete on public.po_lines
  for each row execute function public.refresh_po_total();

-- 4. Status moves one way, and the total cannot be typed in.

create or replace function public.guard_po_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.total_cost := public.po_total(new.id);

  if new.status is distinct from old.status then
    if not (
      (old.status = 'draft' and new.status in ('approved', 'cancelled'))
      or (old.status = 'approved' and new.status in ('ordered', 'received', 'cancelled'))
      or (old.status = 'ordered' and new.status in ('received', 'cancelled'))
    ) then
      raise exception 'An order that is % cannot be marked %.', old.status, new.status
        using errcode = 'RF409';
    end if;
    if new.status = 'approved' and not exists (select 1 from public.po_lines where po_id = new.id) then
      raise exception 'An order with no lines cannot be approved.' using errcode = 'RF409';
    end if;
  end if;
  return new;
end;
$$;

-- Named to run before receive_po's trigger, so a refused change never adds stock.
drop trigger if exists trg_po_a_guard on public.purchase_orders;
create trigger trg_po_a_guard
  before update on public.purchase_orders
  for each row execute function public.guard_po_status();

revoke all on function public.guard_po_lines() from public, anon, authenticated;
revoke all on function public.refresh_po_total() from public, anon, authenticated;
revoke all on function public.guard_po_status() from public, anon, authenticated;
revoke all on function public.po_total(uuid) from public, anon, authenticated;

-- 5. Moving an order on. SECURITY INVOKER, so T14's plant rule decides whether the caller can
--    see and change it. Returns the order, or nothing when the caller cannot see it.

create or replace function public.po_transition(_po uuid, _to text, _reason text default null)
returns setof public.purchase_orders
language plpgsql
security invoker
set search_path = public
as $$
declare
  _current public.po_status;
begin
  select status into _current from public.purchase_orders where id = _po for update;
  if not found then
    return;
  end if;
  if _current::text = _to then
    raise exception 'This order is already %.', _to using errcode = 'RF409';
  end if;
  if _to = 'cancelled' and nullif(btrim(coalesce(_reason, '')), '') is null then
    raise exception 'A reason is required when cancelling an order' using errcode = '23514';
  end if;
  if nullif(btrim(coalesce(_reason, '')), '') is not null then
    perform set_config('app.change_reason', btrim(_reason), true);
  end if;

  return query
    update public.purchase_orders
       set status = _to::public.po_status
     where id = _po
    returning *;
end;
$$;

revoke all on function public.po_transition(uuid, text, text) from public, anon;
grant execute on function public.po_transition(uuid, text, text) to authenticated;
