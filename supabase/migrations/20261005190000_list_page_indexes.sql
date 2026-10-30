-- Indexes on the date columns the list pages sort and filter by.
create index if not exists idx_production_logs_date on public.production_logs (date desc);
create index if not exists idx_downtime_events_start on public.downtime_events (start_time desc);
create index if not exists idx_maintenance_logs_date on public.maintenance_logs (date desc);
create index if not exists idx_static_costs_month on public.static_costs (month desc);
create index if not exists idx_purchase_orders_created on public.purchase_orders (created_at desc);
create index if not exists idx_fuel_slips_date on public.fuel_slips (date desc);