-- ============================================================================
-- 14 years of history: employees, equipment, production logs, maintenance logs,
-- downtime events, static costs, 2014-01-01 to today. Idempotent.
-- ============================================================================

-- 1. Historical employees
with mines as (
  select id, name, team_name from public.mines
  where name in ('Client Mine A','Client Mine B','Client Mine C')
),
extra(first, last, position, shift, rate, hire_offset_days, active_flag, mine_name) as (values
  ('Sipho',     'Mahlangu',  'Operator',   'morning'::shift_slot,  92.00::numeric, 3800, false, 'Client Mine A'),
  ('Andile',    'Khumalo',   'Driller',    'morning'::shift_slot, 108.00::numeric, 3500, false, 'Client Mine A'),
  ('Bongani',   'Ndlovu',    'Loader',     'midday'::shift_slot,   88.00::numeric, 3200, false, 'Client Mine A'),
  ('Jabu',      'Sithole',   'Supervisor', 'midday'::shift_slot,  142.00::numeric, 3000, false, 'Client Mine A'),
  ('Lucky',     'Mokoena',   'Operator',   'night'::shift_slot,   102.00::numeric, 2800, false, 'Client Mine A'),
  ('Pieter',    'Botha',     'Driller',    'morning'::shift_slot, 115.00::numeric, 2600, false, 'Client Mine B'),
  ('Johannes',  'van der Merwe','Operator','morning'::shift_slot,  94.00::numeric, 2400, false, 'Client Mine B'),
  ('Kagiso',    'Molefe',    'Loader',     'midday'::shift_slot,   90.00::numeric, 2200, false, 'Client Mine B'),
  ('Sizwe',     'Dlamini',   'Supervisor', 'midday'::shift_slot,  146.00::numeric, 2000, false, 'Client Mine B'),
  ('Mandla',    'Zulu',      'Operator',   'night'::shift_slot,   100.00::numeric, 1800, false, 'Client Mine B'),
  ('Tebogo',    'Mabaso',    'Driller',    'morning'::shift_slot, 111.00::numeric, 1600, false, 'Client Mine C'),
  ('Nkosinathi','Nkosi',     'Operator',   'morning'::shift_slot,  96.00::numeric, 1400, false, 'Client Mine C'),
  ('Themba',    'Ngcobo',    'Loader',     'midday'::shift_slot,   89.00::numeric, 1200, false, 'Client Mine C'),
  ('Lucas',     'Radebe',    'Supervisor', 'midday'::shift_slot,  144.00::numeric, 1000, false, 'Client Mine C'),
  ('Dumisani',  'Mahlaba',   'Operator',   'night'::shift_slot,   104.00::numeric,  800, false, 'Client Mine C')
)
insert into public.employees (full_name, employee_no, position, mine_id, shift, team_name, hourly_rate, active, hire_date)
select
  x.first || ' ' || x.last,
  'REEF-' || lpad((100 + row_number() over ())::text, 3, '0'),
  x.position, m.id, x.shift, m.team_name, x.rate, x.active_flag,
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