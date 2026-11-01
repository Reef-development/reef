-- ============================================================================
-- Worker purchases: money a worker spends out of pocket that REEF reimburses.
-- Applied to reef-prod on 2026-10-08.
-- ============================================================================

-- Link each signed-in user to the employee record they represent. Without this,
-- a worker can't be matched to their own purchase claims.
alter table public.profiles
  add column if not exists employee_id uuid references public.employees(id);

create table if not exists public.worker_purchases (
  id              uuid primary key default gen_random_uuid(),
  worker_id       uuid not null references public.employees(id),
  mine_id         uuid references public.mines(id),
  plant           text references public.plants(name),
  stock_item_id   uuid references public.stock_items(id),
  date            date not null,
  description     text not null,
  category        text not null,
  amount          numeric(14,2) not null,
  receipt_urls    text[] not null default '{}',
  notes           text,
  status          text not null default 'pending',
  paid_on         date,
  paid_by         uuid references auth.users(id),
  voided_reason   text,
  logged_by       uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  version         integer not null default 1,
  constraint worker_purchases_status_check
    check (status in ('pending', 'paid', 'voided')),
  constraint worker_purchases_amount_check
    check (amount > 0)
);

create index if not exists idx_worker_purchases_worker
  on public.worker_purchases (worker_id, date desc);

create index if not exists idx_worker_purchases_plant_status
  on public.worker_purchases (plant, status, date desc);

create index if not exists idx_worker_purchases_status_date
  on public.worker_purchases (status, date desc);

alter table public.worker_purchases enable row level security;

drop policy if exists "Owners read all purchases" on public.worker_purchases;
create policy "Owners read all purchases"
  on public.worker_purchases for select
  to authenticated
  using (
    exists (
      select 1 from public.user_roles ur
      where ur.user_id = auth.uid() and ur.role = 'owner'
    )
  );

drop policy if exists "Managers read purchases at their plant" on public.worker_purchases;
create policy "Managers read purchases at their plant"
  on public.worker_purchases for select
  to authenticated
  using (
    exists (
      select 1 from public.user_roles ur
      where ur.user_id = auth.uid() and ur.role in ('manager', 'supervisor')
    )
    and plant is not null
    and plant = (
      select plant from public.profiles where id = auth.uid() limit 1
    )
  );

drop policy if exists "Workers read own purchases" on public.worker_purchases;
create policy "Workers read own purchases"
  on public.worker_purchases for select
  to authenticated
  using (
    exists (
      select 1 from public.user_roles ur
      where ur.user_id = auth.uid() and ur.role = 'worker'
    )
    and worker_id = (
      select employee_id from public.profiles
      where id = auth.uid() and employee_id is not null
      limit 1
    )
  );

drop policy if exists "Signed-in users create purchases" on public.worker_purchases;
create policy "Signed-in users create purchases"
  on public.worker_purchases for insert
  to authenticated
  with check (
    auth.uid() is not null
    and amount > 0
    and date <= current_date + interval '1 day'
  );

drop policy if exists "Owners update purchases" on public.worker_purchases;
create policy "Owners update purchases"
  on public.worker_purchases for update
  to authenticated
  using (
    exists (
      select 1 from public.user_roles ur
      where ur.user_id = auth.uid() and ur.role = 'owner'
    )
  )
  with check (
    exists (
      select 1 from public.user_roles ur
      where ur.user_id = auth.uid() and ur.role = 'owner'
    )
  );

drop trigger if exists trg_worker_purchases_version on public.worker_purchases;
create trigger trg_worker_purchases_version
  before update on public.worker_purchases
  for each row execute function public.bump_version();

drop trigger if exists trg_worker_purchases_updated on public.worker_purchases;
create trigger trg_worker_purchases_updated
  before update on public.worker_purchases
  for each row execute function public.update_updated_at_column();

drop trigger if exists write_history_on_update on public.worker_purchases;
create trigger write_history_on_update
  after update on public.worker_purchases
  for each row execute function public.write_history_on_update();

comment on table public.worker_purchases is
  'Money a worker spends out of pocket that REEF reimburses. Pending, paid, or voided.';
comment on column public.worker_purchases.category is
  'Free text. Form suggests: parts, fuel, consumables, tools, other.';
comment on column public.worker_purchases.stock_item_id is
  'Optional. Set when the purchase was for stock that will be added to inventory.';