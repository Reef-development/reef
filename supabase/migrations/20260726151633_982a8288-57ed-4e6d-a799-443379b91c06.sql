-- Inline role checks so helper functions need not be callable by users
DROP POLICY IF EXISTS "Managers manage clients" ON public.clients;
CREATE POLICY "Managers manage clients" ON public.clients FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('owner','manager')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('owner','manager')));

DROP POLICY IF EXISTS "Managers manage suppliers" ON public.suppliers;
CREATE POLICY "Managers manage suppliers" ON public.suppliers FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('owner','manager')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('owner','manager')));

DROP POLICY IF EXISTS "Managers manage static costs" ON public.static_costs;
CREATE POLICY "Managers manage static costs" ON public.static_costs FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('owner','manager')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('owner','manager')));

DROP POLICY IF EXISTS "Managers manage POs" ON public.purchase_orders;
CREATE POLICY "Managers manage POs" ON public.purchase_orders FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('owner','manager')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('owner','manager')));

DROP POLICY IF EXISTS "Managers manage PO lines" ON public.po_lines;
CREATE POLICY "Managers manage PO lines" ON public.po_lines FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('owner','manager')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('owner','manager')));

DROP POLICY IF EXISTS "Managers manage mines" ON public.mines;
CREATE POLICY "Managers manage mines" ON public.mines FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('owner','manager')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('owner','manager')));

DROP POLICY IF EXISTS "Managers manage equipment" ON public.equipment;
CREATE POLICY "Managers manage equipment" ON public.equipment FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('owner','manager')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('owner','manager')));

DROP POLICY IF EXISTS "Managers manage stock" ON public.stock_items;
CREATE POLICY "Managers manage stock" ON public.stock_items FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('owner','manager')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('owner','manager')));

DROP POLICY IF EXISTS "Staff update stock quantities" ON public.stock_items;
CREATE POLICY "Staff update stock quantities" ON public.stock_items FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid()));

DROP POLICY IF EXISTS "Managers manage production" ON public.production_logs;
CREATE POLICY "Managers manage production" ON public.production_logs FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('owner','manager')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('owner','manager')));

DROP POLICY IF EXISTS "Staff insert production" ON public.production_logs;
CREATE POLICY "Staff insert production" ON public.production_logs FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid()));

DROP POLICY IF EXISTS "Managers manage maintenance" ON public.maintenance_logs;
CREATE POLICY "Managers manage maintenance" ON public.maintenance_logs FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('owner','manager')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('owner','manager')));

DROP POLICY IF EXISTS "Managers manage maintenance parts" ON public.maintenance_parts;
CREATE POLICY "Managers manage maintenance parts" ON public.maintenance_parts FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('owner','manager')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('owner','manager')));

DROP POLICY IF EXISTS "Staff insert maintenance parts" ON public.maintenance_parts;
CREATE POLICY "Staff insert maintenance parts" ON public.maintenance_parts FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid())
    AND EXISTS (SELECT 1 FROM public.maintenance_logs ml WHERE ml.id = maintenance_id)
  );

DROP POLICY IF EXISTS "Staff read downtime" ON public.downtime_events;
CREATE POLICY "Staff read downtime" ON public.downtime_events FOR SELECT TO authenticated
  USING (logged_by = auth.uid() OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('owner','manager')));

DROP POLICY IF EXISTS "Owners can delete downtime" ON public.downtime_events;
CREATE POLICY "Owners can delete downtime" ON public.downtime_events FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'owner'));

DROP POLICY IF EXISTS "Owners/managers can update downtime" ON public.downtime_events;
CREATE POLICY "Owners/managers can update downtime" ON public.downtime_events FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('owner','manager')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('owner','manager')));

DROP POLICY IF EXISTS "Owner or managers read reef-photos" ON storage.objects;
CREATE POLICY "Owner or managers read reef-photos" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'reef-photos' AND (auth.uid() = owner OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('owner','manager'))));

DROP POLICY IF EXISTS "Delete own or owner/manager reef-photos" ON storage.objects;
CREATE POLICY "Delete own or owner/manager reef-photos" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'reef-photos' AND (auth.uid() = owner OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('owner','manager'))));

REVOKE ALL ON FUNCTION public.is_manager(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon, authenticated;