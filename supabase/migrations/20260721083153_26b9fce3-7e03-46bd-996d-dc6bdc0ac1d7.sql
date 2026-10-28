
CREATE POLICY "Authenticated read reef-photos" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'reef-photos');
CREATE POLICY "Authenticated upload reef-photos" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'reef-photos' AND auth.uid() = owner);
CREATE POLICY "Authenticated update own reef-photos" ON storage.objects
  FOR UPDATE TO authenticated USING (bucket_id = 'reef-photos' AND auth.uid() = owner);
CREATE POLICY "Delete own or owner/manager reef-photos" ON storage.objects
  FOR DELETE TO authenticated USING (
    bucket_id = 'reef-photos' AND (
      auth.uid() = owner
      OR public.has_role(auth.uid(), 'owner')
      OR public.has_role(auth.uid(), 'manager')
    )
  );
