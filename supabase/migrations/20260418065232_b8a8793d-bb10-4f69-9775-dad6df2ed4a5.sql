
-- Bucket privado para videos generados
INSERT INTO storage.buckets (id, name, public)
VALUES ('generated-videos', 'generated-videos', false)
ON CONFLICT (id) DO NOTHING;

-- RLS storage.objects para generated-videos
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='gen_videos_select') THEN
    CREATE POLICY gen_videos_select ON storage.objects FOR SELECT
      USING (bucket_id = 'generated-videos' AND (public.is_admin(auth.uid()) OR (storage.foldername(name))[1] = auth.uid()::text));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='gen_videos_insert') THEN
    CREATE POLICY gen_videos_insert ON storage.objects FOR INSERT
      WITH CHECK (bucket_id = 'generated-videos' AND (storage.foldername(name))[1] = auth.uid()::text);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='gen_videos_update') THEN
    CREATE POLICY gen_videos_update ON storage.objects FOR UPDATE
      USING (bucket_id = 'generated-videos' AND (public.is_admin(auth.uid()) OR (storage.foldername(name))[1] = auth.uid()::text));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='gen_videos_delete') THEN
    CREATE POLICY gen_videos_delete ON storage.objects FOR DELETE
      USING (bucket_id = 'generated-videos' AND (public.is_admin(auth.uid()) OR (storage.foldername(name))[1] = auth.uid()::text));
  END IF;
END $$;

-- async_tasks: nuevas columnas
ALTER TABLE public.async_tasks
  ADD COLUMN IF NOT EXISTS related_scene_id uuid REFERENCES public.variation_scenes(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_async_tasks_related_scene ON public.async_tasks(related_scene_id);
CREATE INDEX IF NOT EXISTS idx_async_tasks_user_status ON public.async_tasks(user_id, status);

-- video_generations: nuevas columnas
ALTER TABLE public.video_generations
  ADD COLUMN IF NOT EXISTS public_url text,
  ADD COLUMN IF NOT EXISTS duration_seconds integer;

-- Realtime para async_tasks
ALTER TABLE public.async_tasks REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'async_tasks'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.async_tasks';
  END IF;
END $$;
