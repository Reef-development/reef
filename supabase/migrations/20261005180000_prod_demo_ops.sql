-- ============================================================================
-- Suppliers, purchase orders (with lines) and fuel slips, 2014-01-01 to today.
-- Idempotent — safe to re-run. Applied to reef-prod on 2026-10-05.
-- ============================================================================

-- 1. Suppliers
insert into public.suppliers (name, contact_name, email, phone, notes)
select v.name, v.contact_name, v.email, v.phone, v.notes
from (values
  ('Engen Fuels',           'Pieter Smit',    'sales@engen.example',      '+27 11 555 0101', 'Diesel and petrol'),
  ('Sasol Oil',             'Nomvula Dlamini','orders@sasol.example',     '+27 11 555 0202', 'Bulk diesel supply'),
  ('Barloworld CAT',        'Andrew Botha',   'parts@barloworld.example', '+27 11 555 0303', 'Machine parts and filters'),
  ('Tiger Wheel & Tyre',    'Sipho Ngwenya',  'mining@tiger.example',     '+27 11 555 0404', 'OTR tyres'),
  ('Continental Belting',   'Marie du Toit',  'sales@beltco.example',     '+27 11 555 0505', 'Conveyor belts and rollers'),
  ('Fasteners Direct',      'Riaan Pretorius','quotes@fasteners.example', '+27 11 555 0606', 'Bolts, hoses, fittings')
) as v(name, contact_name, email, phone, notes)
where not exists (select 1 from public.suppliers s where s.name = v.name);

-- 2. Purchase orders + lines.
--    guard_po_lines() forbids line changes once the PO leaves draft, and
--    guard_po_status() forbids jumping straight to received. So: insert as draft,
--    add the lines, then step through the allowed transitions.
do $$
declare
  v_mine_id uuid;
  v_supplier_id uuid;
  v_po_id uuid;
  v_final_status po_status;
  v_created timestamptz;
  v_total numeric(14,2);
  v_lines int;
  v_line_total numeric(14,2);
  v_qty numeric(10,2);
  v_unit numeric(12,2);
  d date;
  i int;
  j int;
  statuses po_status[] := array['received'::po_status, 'received'::po_status, 'received'::po_status,
                                 'received'::po_status, 'received'::po_status, 'received'::po_status,
                                 'received'::po_status, 'received'::po_status,
                                 'ordered'::po_status, 'approved'::po_status,
                                 'draft'::po_status, 'cancelled'::po_status];
begin
  for d in select generate_series('2014-01-01'::date, current_date, '1 month')::date loop
    for i in 1..3 loop
      if exists (
        select 1 from public.purchase_orders po
        where date_trunc('month', po.created_at) = date_trunc('month', d::timestamptz)
          and po.notes = 'Historical seed ' || i
      ) then
        continue;
      end if;

      select id into v_mine_id from public.mines
        where name in ('Client Mine A','Client Mine B','Client Mine C')
        order by random() limit 1;

      select id into v_supplier_id from public.suppliers order by random() limit 1;

      v_final_status := statuses[1 + (random() * 11)::int];
      v_created := (d::timestamp + (random() * interval '27 days'))::timestamptz;

      insert into public.purchase_orders
        (supplier_id, status, total_cost, notes, created_at, plant)
      values
        (v_supplier_id, 'draft'::po_status, 0, 'Historical seed ' || i, v_created, 'Main Plant')
      returning id into v_po_id;

      v_lines := 1 + (random() * 3)::int;
      v_total := 0;
      for j in 1..v_lines loop
        v_qty := (1 + random() * 40)::numeric(10,2);
        v_unit := (150 + random() * 3500)::numeric(12,2);
        v_line_total := (v_qty * v_unit)::numeric(14,2);
        v_total := v_total + v_line_total;

        insert into public.po_lines (po_id, stock_item_id, qty, unit_cost)
        values (
          v_po_id,
          (select id from public.stock_items order by random() limit 1),
          v_qty,
          v_unit
        );
      end loop;

      update public.purchase_orders set total_cost = v_total where id = v_po_id;

      if v_final_status in ('approved','ordered','received') then
        update public.purchase_orders
        set status = 'approved'::po_status,
            approved_at = v_created + interval '2 days'
        where id = v_po_id;
      end if;

      if v_final_status in ('ordered','received') then
        update public.purchase_orders
        set status = 'ordered'::po_status,
            ordered_at = v_created + interval '4 days'
        where id = v_po_id;
      end if;

      if v_final_status = 'received' then
        update public.purchase_orders
        set status = 'received'::po_status,
            received_at = v_created + interval '12 days'
        where id = v_po_id;
      end if;

      if v_final_status = 'cancelled' then
        update public.purchase_orders
        set status = 'cancelled'::po_status
        where id = v_po_id;
      end if;
    end loop;
  end loop;
end $$;

-- 3. Fuel slips — one per mine per day since 2014.
insert into public.fuel_slips
  (date, mine_id, equipment_id, vehicle_label, slip_no, fuel_type,
   litres, cost_per_litre, total_cost, odometer, hours_reading, employee_id, notes, photo_urls)
select
  d::date,
  m.id,
  eq.id,
  eq.name,
  'FS-' || to_char(d, 'YYYYMMDD') || '-' || substr(m.name, -1),
  'diesel',
  litres,
  cpl,
  (litres * cpl)::numeric(14,2),
  case when random() < 0.5 then (10000 + random() * 900000)::numeric(12,2) else null end,
  case when random() < 0.5 then (1000 + random() * 40000)::numeric(10,2) else null end,
  (select id from public.employees
     where mine_id = m.id and active = true
     order by random() limit 1),
  'Historical seed',
  '{}'::text[]
from public.mines m
cross join generate_series('2014-01-01'::date, current_date, '1 day') d
cross join lateral (
  select
    (case when extract(dow from d) in (0,6)
          then 400 + random() * 800
          else 800 + random() * 1700
     end)::numeric(10,2) as litres,
    (10.50 + ((current_date - '2014-01-01'::date)::numeric / 365.25) * 0.93
      + (random() - 0.5) * 0.8
    )::numeric(6,2) as cpl
) f
cross join lateral (
  select e.id, e.name from public.equipment e
  where e.mine_id = m.id
  order by random()
  limit 1
) eq
where m.name in ('Client Mine A','Client Mine B','Client Mine C')
  and not exists (
    select 1 from public.fuel_slips fs
    where fs.date = d::date
      and fs.mine_id = m.id
      and fs.notes = 'Historical seed'
  );