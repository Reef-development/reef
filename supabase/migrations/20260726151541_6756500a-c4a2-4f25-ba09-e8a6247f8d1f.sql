-- helper
CREATE OR REPLACE FUNCTION public.is_manager(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _uid AND role IN ('owner','manager'));
$$;

REVOKE ALL ON FUNCTION public.is_manager(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_manager(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.receive_po() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consume_stock_on_maintenance() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;

-- drop permissive policies
DROP POLICY IF EXISTS "Authed manage clients" ON public.clients;
DROP POLICY IF EXISTS "Authed manage suppliers" ON public.suppliers;
DROP POLICY IF EXISTS "Authed manage mines" ON public.mines;
DROP POLICY IF EXISTS "Authed manage equipment" ON public.equipment;
DROP POLICY IF EXISTS "Authed manage stock" ON public.stock_items;
DROP POLICY IF EXISTS "Authed manage POs" ON public.purchase_orders;
DROP POLICY IF EXISTS "Authed manage PO lines" ON public.po_lines;
DROP POLICY IF EXISTS "Authed manage static costs" ON public.static_costs;
DROP POLICY IF EXISTS "Authed manage production" ON public.production_logs;
DROP POLICY IF EXISTS "Authed manage maintenance" ON public.maintenance_logs;
DROP POLICY IF EXISTS "Authed manage maintenance parts" ON public.maintenance_parts;
DROP POLICY IF EXISTS "Authenticated can read downtime" ON public.downtime_events;

-- management-only tables
CREATE POLICY "Managers manage clients" ON public.clients FOR ALL TO authenticated
  USING (public.is_manager(auth.uid())) WITH CHECK (public.is_manager(auth.uid()));
CREATE POLICY "Managers manage suppliers" ON public.suppliers FOR ALL TO authenticated
  USING (public.is_manager(auth.uid())) WITH CHECK (public.is_manager(auth.uid()));
CREATE POLICY "Managers manage static costs" ON public.static_costs FOR ALL TO authenticated
  USING (public.is_manager(auth.uid())) WITH CHECK (public.is_manager(auth.uid()));
CREATE POLICY "Managers manage POs" ON public.purchase_orders FOR ALL TO authenticated
  USING (public.is_manager(auth.uid())) WITH CHECK (public.is_manager(auth.uid()));
CREATE POLICY "Managers manage PO lines" ON public.po_lines FOR ALL TO authenticated
  USING (public.is_manager(auth.uid())) WITH CHECK (public.is_manager(auth.uid()));

-- reference tables: all staff read, managers write
CREATE POLICY "Staff read mines" ON public.mines FOR SELECT TO authenticated USING (true);
CREATE POLICY "Managers manage mines" ON public.mines FOR ALL TO authenticated
  USING (public.is_manager(auth.uid())) WITH CHECK (public.is_manager(auth.uid()));

CREATE POLICY "Staff read equipment" ON public.equipment FOR SELECT TO authenticated USING (true);
CREATE POLICY "Managers manage equipment" ON public.equipment FOR ALL TO authenticated
  USING (public.is_manager(auth.uid())) WITH CHECK (public.is_manager(auth.uid()));

CREATE POLICY "Staff read stock" ON public.stock_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff update stock quantities" ON public.stock_items FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY "Managers manage stock" ON public.stock_items FOR ALL TO authenticated
  USING (public.is_manager(auth.uid())) WITH CHECK (public.is_manager(auth.uid()));

-- operational logs: staff read + insert, managers modify/delete
CREATE POLICY "Staff read production" ON public.production_logs FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff insert production" ON public.production_logs FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Managers manage production" ON public.production_logs FOR ALL TO authenticated
  USING (public.is_manager(auth.uid())) WITH CHECK (public.is_manager(auth.uid()));

CREATE POLICY "Staff read maintenance" ON public.maintenance_logs FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff insert maintenance" ON public.maintenance_logs FOR INSERT TO authenticated
  WITH CHECK (logged_by IS NULL OR logged_by = auth.uid());
CREATE POLICY "Managers manage maintenance" ON public.maintenance_logs FOR ALL TO authenticated
  USING (public.is_manager(auth.uid())) WITH CHECK (public.is_manager(auth.uid()));

CREATE POLICY "Staff read maintenance parts" ON public.maintenance_parts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff insert maintenance parts" ON public.maintenance_parts FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Managers manage maintenance parts" ON public.maintenance_parts FOR ALL TO authenticated
  USING (public.is_manager(auth.uid())) WITH CHECK (public.is_manager(auth.uid()));

CREATE POLICY "Staff read downtime" ON public.downtime_events FOR SELECT TO authenticated
  USING (public.is_manager(auth.uid()) OR logged_by = auth.uid());

-- storage: owner or managers can read photos
DROP POLICY IF EXISTS "Authenticated read reef-photos" ON storage.objects;
CREATE POLICY "Owner or managers read reef-photos" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'reef-photos' AND (auth.uid() = owner OR public.is_manager(auth.uid())));