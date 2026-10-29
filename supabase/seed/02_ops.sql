-- ============================================================================
-- 14 years of history: employees, equipment, production logs, maintenance logs,
-- downtime events, static costs, 2014-01-01 to today. Idempotent.
--
-- Applied to reef-prod on 2026-10-05. Runs before the ops migration
-- (20261005180000), so it creates the plant and the mines that the ops
-- migration's purchase_orders and fuel_slips reference.
-- ============================================================================

-- 0. Plant — mines and purchase orders reference it by name.
insert into public.plants (name, active)
select 'Main Plant', true
where not exists (select 1 from public.plants where name = 'Main Plant');

-- 0b. Clients — the mines below point at them.
insert into public.clients (name, contact_name, email, contract_start, contract_end, contract_revenue_monthly, active)
select v.name, v.contact_name, v.email, v.start, v.finish, v.revenue, true
from (values
  ('Client A', 'Site Manager A', 'ops.a@example.com', '2024-01-01'::date, '2026-12-31'::date, 1250000.00::numeric),
  ('Client B', 'Site Manager B', 'ops.b@example.com', '2024-03-01'::date, '2026-12-31'::date,  980000.00::numeric),
  ('Client C', 'Site Manager C', 'ops.c@example.com', '2024-06-01'::date, '2026-12-31'::date, 1475000.00::numeric)
) as v(name, contact_name, email, start, finish, revenue)
where not exists (select 1 from public.clients c where c.name = v.name);

-- 0c. Mines — purchase orders, fuel slips and production logs reference them.
insert into public.mines (name, client_id, location, plant, target_cost_per_ton, active, team_name)
select v.name, c.id, 'Mpumalanga', 'Main Plant', v.target, true, v.team
from (values
  ('Client Mine A', 'Client A', 185.00::numeric, 'Team A'),
  ('Client Mine B', 'Client B', 192.00::numeric, 'Team B'),
  ('Client Mine C', 'Client C', 178.00::numeric, 'Team C')
) as v(name, client_name, target, team)
join public.clients c on c.name = v.client_name
where not exists (select 1 from public.mines m where m.name = v.name);

-- 0d. Stock items — po_lines reference them.
insert into public.stock_items (name, sku, unit, unit_cost, plant)
select v.name, v.sku, v.unit, v.cost, 'Main Plant'
from (values
  ('Magnetite (DMS grade)', 'MAG-DMS',   't',     2850.00::numeric),
  ('Diesel 50ppm',          'DSL-50',    'L',       22.40::numeric),
  ('Hydraulic oil ISO 46',  'HYD-46',    'L',       78.00::numeric),
  ('Oil filter — CAT',      'FLT-OIL-C', 'each',   340.00::numeric),
  ('Air filter — CAT',      'FLT-AIR-C', 'each',   480.00::numeric),
  ('Tyre 29.5R25',          'TYR-295',   'each', 18500.00::numeric),
  ('Conveyor belt 800mm',   'CVB-800',   'm',      920.00::numeric),
  ('Screen mesh 10mm',      'SCR-10',    'each',  1650.00::numeric),
  ('Wear plate 8mm',        'WPL-8',     'each',  2400.00::numeric),
  ('Hydraulic hose 1/2"',   'HSH-12',    'm',      285.00::numeric)
) as v(name, sku, unit, cost)
where not exists (select 1 from public.stock_items si where si.sku = v.sku);

-- 0e. Stock levels for the items above.
insert into public.stock_levels (stock_item_id, plant, qty_on_hand, reorder_point, reorder_qty)
select si.id, 'Main Plant',
  case si.sku
    when 'MAG-DMS' then 24.0   when 'DSL-50' then 3400.0 when 'HYD-46' then 480.0
    when 'FLT-OIL-C' then 8.0  when 'FLT-AIR-C' then 12.0 when 'TYR-295' then 3.0
    when 'CVB-800' then 145.0  when 'SCR-10' then 6.0   when 'WPL-8' then 14.0
    when 'HSH-12' then 62.0
  end,
  case si.sku
    when 'MAG-DMS' then 10.0   when 'DSL-50' then 1500.0 when 'HYD-46' then 200.0
    when 'FLT-OIL-C' then 10.0 when 'FLT-AIR-C' then 6.0 when 'TYR-295' then 4.0
    when 'CVB-800' then 50.0   when 'SCR-10' then 4.0   when 'WPL-8' then 8.0
    when 'HSH-12' then 40.0
  end,
  case si.sku
    when 'MAG-DMS' then 20.0   when 'DSL-50' then 3000.0 when 'HYD-46' then 400.0
    when 'FLT-OIL-C' then 20.0 when 'FLT-AIR-C' then 12.0 when 'TYR-295' then 6.0
    when 'CVB-800' then 100.0  when 'SCR-10' then 8.0   when 'WPL-8' then 16.0
    when 'HSH-12' then 80.0
  end
from public.stock_items si
where si.plant = 'Main Plant'
  and not exists (
    select 1 from public.stock_levels sl
    where sl.stock_item_id = si.id and sl.plant = 'Main Plant'
  );

-- 1. Employees — the 42 current roster plus 15 historical.
with mines as (
  select id, name, team_name from public.mines
  where name in ('Client Mine A','Client Mine B','Client Mine C')
),
active_roster(full_name, employee_no, position, shift, hourly_rate, hire_date, mine_name) as (values
  ('Thabo Mokoena',    'REEF-001', 'Operator',   'morning'::shift_slot,  95.00::numeric, '2023-02-15'::date, 'Client Mine A'),
  ('Sipho Ndlovu',     'REEF-002', 'Driller',    'morning'::shift_slot, 110.00::numeric, '2022-11-01'::date, 'Client Mine A'),
  ('Jabu Dlamini',     'REEF-003', 'Loader',     'morning'::shift_slot,  90.00::numeric, '2024-01-10'::date, 'Client Mine A'),
  ('Lucky Khumalo',    'REEF-004', 'Supervisor', 'morning'::shift_slot, 145.00::numeric, '2021-06-20'::date, 'Client Mine A'),
  ('Bongani Sithole',  'REEF-005', 'Operator',   'morning'::shift_slot,  95.00::numeric, '2023-08-05'::date, 'Client Mine A'),
  ('Pieter van Wyk',   'REEF-006', 'Operator',   'midday'::shift_slot,   98.00::numeric, '2022-04-12'::date, 'Client Mine A'),
  ('Johannes Mahlangu','REEF-007', 'Driller',    'midday'::shift_slot,  112.00::numeric, '2023-05-30'::date, 'Client Mine A'),
  ('Andile Zulu',      'REEF-008', 'Loader',     'midday'::shift_slot,   92.00::numeric, '2024-02-20'::date, 'Client Mine A'),
  ('Kagiso Modise',    'REEF-009', 'Supervisor', 'midday'::shift_slot,  150.00::numeric, '2021-09-15'::date, 'Client Mine A'),
  ('Sizwe Mthethwa',   'REEF-010', 'Operator',   'midday'::shift_slot,   96.00::numeric, '2023-11-08'::date, 'Client Mine A'),
  ('Mandla Zwane',     'REEF-011', 'Operator',   'night'::shift_slot,   105.00::numeric, '2023-03-22'::date, 'Client Mine A'),
  ('Tebogo Molefe',    'REEF-012', 'Driller',    'night'::shift_slot,   118.00::numeric, '2022-07-14'::date, 'Client Mine A'),
  ('Nkosinathi Baloyi','REEF-013', 'Loader',     'night'::shift_slot,   100.00::numeric, '2024-03-05'::date, 'Client Mine A'),
  ('Themba Nkosi',     'REEF-014', 'Supervisor', 'night'::shift_slot,   155.00::numeric, '2021-12-01'::date, 'Client Mine A'),
  ('Lucas Mahlaba',    'REEF-015', 'Operator',   'morning'::shift_slot,  97.00::numeric, '2023-01-20'::date, 'Client Mine B'),
  ('Dumisani Ncala',   'REEF-016', 'Driller',    'morning'::shift_slot, 115.00::numeric, '2022-09-12'::date, 'Client Mine B'),
  ('Simon Ngcobo',     'REEF-017', 'Loader',     'morning'::shift_slot,  93.00::numeric, '2024-04-02'::date, 'Client Mine B'),
  ('Christopher Peters','REEF-018','Supervisor', 'morning'::shift_slot, 148.00::numeric, '2021-03-08'::date, 'Client Mine B'),
  ('Ayanda Mbatha',    'REEF-019', 'Operator',   'morning'::shift_slot,  99.00::numeric, '2023-07-19'::date, 'Client Mine B'),
  ('Katlego Mokwena',  'REEF-020', 'Operator',   'midday'::shift_slot,  101.00::numeric, '2022-06-25'::date, 'Client Mine B'),
  ('Vusi Nkosi',       'REEF-021', 'Driller',    'midday'::shift_slot,  116.00::numeric, '2023-10-11'::date, 'Client Mine B'),
  ('Trevor Naidoo',    'REEF-022', 'Loader',     'midday'::shift_slot,   95.00::numeric, '2024-05-07'::date, 'Client Mine B'),
  ('Given Maluleke',   'REEF-023', 'Supervisor', 'midday'::shift_slot,  152.00::numeric, '2021-08-30'::date, 'Client Mine B'),
  ('Lwazi Khanyile',   'REEF-024', 'Operator',   'midday'::shift_slot,   98.00::numeric, '2023-04-03'::date, 'Client Mine B'),
  ('Musa Hadebe',      'REEF-025', 'Operator',   'night'::shift_slot,   108.00::numeric, '2023-02-17'::date, 'Client Mine B'),
  ('Bheki Mnguni',     'REEF-026', 'Driller',    'night'::shift_slot,   120.00::numeric, '2022-11-27'::date, 'Client Mine B'),
  ('Sabelo Ndaba',     'REEF-027', 'Loader',     'night'::shift_slot,   102.00::numeric, '2024-06-14'::date, 'Client Mine B'),
  ('Dennis Khumalo',   'REEF-028', 'Supervisor', 'night'::shift_slot,   158.00::numeric, '2021-10-05'::date, 'Client Mine B'),
  ('Tumelo Sebola',    'REEF-029', 'Operator',   'morning'::shift_slot,  96.00::numeric, '2023-06-08'::date, 'Client Mine C'),
  ('Abram Molefe',     'REEF-030', 'Driller',    'morning'::shift_slot, 113.00::numeric, '2022-08-22'::date, 'Client Mine C'),
  ('Lawrence Mbatha',  'REEF-031', 'Loader',     'morning'::shift_slot,  91.00::numeric, '2024-07-01'::date, 'Client Mine C'),
  ('Justice Mtshali',  'REEF-032', 'Supervisor', 'morning'::shift_slot, 149.00::numeric, '2021-05-18'::date, 'Client Mine C'),
  ('Bethuel Radebe',   'REEF-033', 'Operator',   'morning'::shift_slot,  97.00::numeric, '2023-09-25'::date, 'Client Mine C'),
  ('Elliot Mahlangu',  'REEF-034', 'Operator',   'midday'::shift_slot,   99.00::numeric, '2022-10-03'::date, 'Client Mine C'),
  ('Nathi Gumede',     'REEF-035', 'Driller',    'midday'::shift_slot,  117.00::numeric, '2023-12-15'::date, 'Client Mine C'),
  ('Steven Mokoena',   'REEF-036', 'Loader',     'midday'::shift_slot,   94.00::numeric, '2024-08-20'::date, 'Client Mine C'),
  ('Phillip Sithole',  'REEF-037', 'Supervisor', 'midday'::shift_slot,  151.00::numeric, '2021-11-12'::date, 'Client Mine C'),
  ('Bongani Nene',     'REEF-038', 'Operator',   'midday'::shift_slot,   97.00::numeric, '2023-03-30'::date, 'Client Mine C'),
  ('Mlungisi Zungu',   'REEF-039', 'Operator',   'night'::shift_slot,   107.00::numeric, '2023-05-06'::date, 'Client Mine C'),
  ('Sipho Mabaso',     'REEF-040', 'Driller',    'night'::shift_slot,   119.00::numeric, '2022-12-19'::date, 'Client Mine C'),
  ('Welcome Ncube',    'REEF-041', 'Loader',     'night'::shift_slot,   101.00::numeric, '2024-09-08'::date, 'Client Mine C'),
  ('Robert Maake',     'REEF-042', 'Supervisor', 'night'::shift_slot,   156.00::numeric, '2021-07-27'::date, 'Client Mine C')
)
insert into public.employees (full_name, employee_no, position, mine_id, shift, team_name, hourly_rate, active, hire_date)
select
  a.full_name, a.employee_no, a.position, m.id, a.shift, m.team_name, a.hourly_rate, true, a.hire_date
from active_roster a
join mines m on m.name = a.mine_name
where not exists (select 1 from public.employees e where e.employee_no = a.employee_no);

-- Historical (non-active) staff
with mines as (
  select id, name, team_name from public.mines
  where name in ('Client Mine A','Client Mine B','Client Mine C')
),
extra(first, last, position, shift, rate, hire_offset_days, mine_name) as (values
  ('Sipho',     'Mahlangu',  'Operator',   'morning'::shift_slot,  92.00::numeric, 3800, 'Client Mine A'),
  ('Andile',    'Khumalo',   'Driller',    'morning'::shift_slot, 108.00::numeric, 3500, 'Client Mine A'),
  ('Bongani',   'Ndlovu',    'Loader',     'midday'::shift_slot,   88.00::numeric, 3200, 'Client Mine A'),
  ('Jabu',      'Sithole',   'Supervisor', 'midday'::shift_slot,  142.00::numeric, 3000, 'Client Mine A'),
  ('Lucky',     'Mokoena',   'Operator',   'night'::shift_slot,   102.00::numeric, 2800, 'Client Mine A'),
  ('Pieter',    'Botha',     'Driller',    'morning'::shift_slot, 115.00::numeric, 2600, 'Client Mine B'),
  ('Johannes',  'van der Merwe','Operator','morning'::shift_slot,  94.00::numeric, 2400, 'Client Mine B'),
  ('Kagiso',    'Molefe',    'Loader',     'midday'::shift_slot,   90.00::numeric, 2200, 'Client Mine B'),
  ('Sizwe',     'Dlamini',   'Supervisor', 'midday'::shift_slot,  146.00::numeric, 2000, 'Client Mine B'),
  ('Mandla',    'Zulu',      'Operator',   'night'::shift_slot,   100.00::numeric, 1800, 'Client Mine B'),
  ('Tebogo',    'Mabaso',    'Driller',    'morning'::shift_slot, 111.00::numeric, 1600, 'Client Mine C'),
  ('Nkosinathi','Nkosi',     'Operator',   'morning'::shift_slot,  96.00::numeric, 1400, 'Client Mine C'),
  ('Themba',    'Ngcobo',    'Loader',     'midday'::shift_slot,   89.00::numeric, 1200, 'Client Mine C'),
  ('Lucas',     'Radebe',    'Supervisor', 'midday'::shift_slot,  144.00::numeric, 1000, 'Client Mine C'),
  ('Dumisani',  'Mahlaba',   'Operator',   'night'::shift_slot,   104.00::numeric,  800, 'Client Mine C')
)
insert into public.employees (full_name, employee_no, position, mine_id, shift, team_name, hourly_rate, active, hire_date)
select
  x.first || ' ' || x.last,
  'REEF-' || lpad((100 + row_number() over ())::text, 3, '0'),
  x.position, m.id, x.shift, m.team_name, x.rate, false,
  current_date - x.hire_offset_days
from extra x
join mines m on m.name = x.mine_name
where not exists (
  select 1 from public.employees e where e.full_name = x.first || ' ' || x.last
);

-- 2. Historical equipment
with mines as (
  select id, name from public.mines
  where name in ('Client Mine A','Client Mine B','Client Mine C')
),
seed(name, type, install_offset_days, expected_life, tons_since, status, replacement, mine_name) as (values
  ('Drill Rig DR-02',     'drill',     4200, 45000::numeric, 44800::numeric, 'retired',     8500000::numeric, 'Client Mine A'),
  ('Excavator EX-03',     'excavator', 3900, 60000::numeric, 59800::numeric, 'retired',    12500000::numeric, 'Client Mine A'),
  ('Loader LD-07',        'loader',    2800, 40000::numeric, 32000::numeric, 'operational', 6200000::numeric, 'Client Mine A'),
  ('Haul Truck HT-08',    'truck',     2400, 80000::numeric, 62000::numeric, 'operational', 9800000::numeric, 'Client Mine A'),
  ('Dozer DZ-09',         'dozer',     1800, 55000::numeric, 41000::numeric, 'operational',11200000::numeric, 'Client Mine A'),
  ('Water Bowser WB-10',  'bowser',    1200, 50000::numeric, 22000::numeric, 'operational', 3100000::numeric, 'Client Mine A'),
  ('Drill Rig DR-11',     'drill',     4100, 45000::numeric, 43900::numeric, 'retired',     8500000::numeric, 'Client Mine B'),
  ('Excavator EX-12',     'excavator', 3600, 60000::numeric, 48000::numeric, 'operational',12500000::numeric, 'Client Mine B'),
  ('Loader LD-13',        'loader',    3000, 40000::numeric, 38500::numeric, 'operational', 6200000::numeric, 'Client Mine B'),
  ('Haul Truck HT-14',    'truck',     2200, 80000::numeric, 54000::numeric, 'operational', 9800000::numeric, 'Client Mine B'),
  ('Dozer DZ-15',         'dozer',     1600, 55000::numeric, 33000::numeric, 'operational',11200000::numeric, 'Client Mine B'),
  ('Water Bowser WB-16',  'bowser',    1000, 50000::numeric, 18000::numeric, 'operational', 3100000::numeric, 'Client Mine B'),
  ('Drill Rig DR-17',     'drill',     3800, 45000::numeric, 41000::numeric, 'operational', 8500000::numeric, 'Client Mine C'),
  ('Excavator EX-18',     'excavator', 3400, 60000::numeric, 51000::numeric, 'operational',12500000::numeric, 'Client Mine C'),
  ('Loader LD-19',        'loader',    2600, 40000::numeric, 28000::numeric, 'operational', 6200000::numeric, 'Client Mine C'),
  ('Haul Truck HT-20',    'truck',     2000, 80000::numeric, 46000::numeric, 'operational', 9800000::numeric, 'Client Mine C'),
  ('Dozer DZ-21',         'dozer',     1400, 55000::numeric, 28000::numeric, 'operational',11200000::numeric, 'Client Mine C'),
  ('Water Bowser WB-22',  'bowser',     900, 50000::numeric, 14000::numeric, 'operational', 3100000::numeric, 'Client Mine C')
)
insert into public.equipment (name, type, mine_id, install_date, expected_life_tons, tons_since_install, status, replacement_cost)
select s.name, s.type, m.id, current_date - s.install_offset_days,
       s.expected_life, s.tons_since, s.status, s.replacement
from seed s
join mines m on m.name = s.mine_name
where not exists (select 1 from public.equipment e where e.name = s.name);

-- 3. Production logs
insert into public.production_logs (mine_id, date, tons_produced, magnetite_used, magnetite_cost, overtime_hours, overtime_cost, shift, notes)
select
  m.id,
  d::date,
  t.tons::numeric(10,2),
  t.mag::numeric(10,2),
  (t.mag * 2850)::numeric(12,2),
  t.ot::numeric(6,2),
  (t.ot * 380)::numeric(10,2),
  'morning'::shift_slot,
  'Historical seed'
from public.mines m
cross join generate_series('2014-01-01'::date, current_date, '1 day') d
cross join lateral (
  select
    (case
      when extract(dow from d) in (0, 6) then 100 + (random() * 250)
      when random() < 0.08                then  80 + (random() * 150)
      else                                     350 + (random() * 400)
    end)::numeric as tons,
    (case
      when extract(dow from d) in (0, 6) then 3 + (random() * 5)
      else                                     8 + (random() * 15)
    end)::numeric as mag,
    (case
      when random() < 0.3 then random() * 4
      else 0
    end)::numeric as ot
) t
where m.name in ('Client Mine A','Client Mine B','Client Mine C')
  and not exists (
    select 1 from public.production_logs pl
    where pl.mine_id = m.id and pl.date = d::date
  );

-- 4. Maintenance logs
insert into public.maintenance_logs (equipment_id, date, description, labour_hours, labour_cost, parts_cost, total_cost, downtime_hours, performed_by)
select
  e.id,
  (e.install_date + (g.g * interval '60 days'))::date,
  'Scheduled service',
  (2 + random() * 4)::numeric(6,2),
  (800 + random() * 1500)::numeric(12,2),
  (1200 + random() * 6000)::numeric(12,2),
  (2000 + random() * 7500)::numeric(12,2),
  (1 + random() * 4)::numeric(6,2),
  'Workshop'
from public.equipment e
cross join generate_series(1, 60) g(g)
where e.install_date is not null
  and e.install_date + (g.g * interval '60 days') <= current_date
  and not exists (
    select 1 from public.maintenance_logs ml
    where ml.equipment_id = e.id
      and ml.date = (e.install_date + (g.g * interval '60 days'))::date
  );

-- 5. Downtime events
insert into public.downtime_events (mine_id, reason, start_time, duration_hours, estimated_cost, notes, photo_urls)
select
  m.id,
  case (random() * 5)::int
    when 0 then 'breakdown'
    when 1 then 'no_stock'
    when 2 then 'waiting_on_part'
    when 3 then 'planned_maintenance'
    else 'other'
  end,
  (d::timestamp + (random() * interval '20 hours'))::timestamptz,
  (0.5 + random() * 6)::numeric(6,2),
  (1500 + random() * 25000)::numeric(12,2),
  'Historical seed',
  '{}'::text[]
from public.mines m
cross join generate_series('2014-01-01'::date, current_date, '7 days') d
where m.name in ('Client Mine A','Client Mine B','Client Mine C')
  and not exists (
    select 1 from public.downtime_events de
    where de.mine_id = m.id
      and de.start_time::date = d::date
      and de.notes = 'Historical seed'
  );

-- 6. Static costs
insert into public.static_costs (month, mine_id, category, amount)
select
  date_trunc('month', d)::date,
  m.id,
  cat.category,
  (cat.base + (random() * cat.base * 0.15))::numeric(14,2)
from public.mines m
cross join generate_series('2014-01-01'::date, current_date, '1 month') d
cross join (values
  ('Salaries',    185000.00::numeric),
  ('Depreciation', 92000.00::numeric),
  ('Rentals',      45000.00::numeric),
  ('Insurance',    28000.00::numeric),
  ('Overheads',    38000.00::numeric),
  ('Levies',       15000.00::numeric)
) as cat(category, base)
where m.name in ('Client Mine A','Client Mine B','Client Mine C')
  and not exists (
    select 1 from public.static_costs sc
    where sc.mine_id = m.id
      and sc.month = date_trunc('month', d)::date
      and sc.category = cat.category
  );