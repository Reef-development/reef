CREATE TABLE public.reefie_threads (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  title TEXT NOT NULL DEFAULT 'New conversation',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reefie_threads TO authenticated;
GRANT ALL ON public.reefie_threads TO service_role;
ALTER TABLE public.reefie_threads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own threads" ON public.reefie_threads FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE TRIGGER reefie_threads_updated_at BEFORE UPDATE ON public.reefie_threads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.reefie_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  thread_id UUID NOT NULL REFERENCES public.reefie_threads(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role TEXT NOT NULL,
  message JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX reefie_messages_thread_idx ON public.reefie_messages (thread_id, created_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reefie_messages TO authenticated;
GRANT ALL ON public.reefie_messages TO service_role;
ALTER TABLE public.reefie_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own messages" ON public.reefie_messages FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());