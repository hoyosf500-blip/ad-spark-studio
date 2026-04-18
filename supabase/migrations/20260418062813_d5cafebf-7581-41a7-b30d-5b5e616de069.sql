-- 1) Trigger: sum api_usage.cost_usd into profiles.total_cost_usd
CREATE OR REPLACE FUNCTION public.tg_apply_api_cost()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.cost_usd IS NOT NULL AND NEW.cost_usd > 0 THEN
    UPDATE public.profiles
       SET total_cost_usd = COALESCE(total_cost_usd, 0) + NEW.cost_usd,
           updated_at = now()
     WHERE id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS api_usage_apply_cost ON public.api_usage;
CREATE TRIGGER api_usage_apply_cost
AFTER INSERT ON public.api_usage
FOR EACH ROW EXECUTE FUNCTION public.tg_apply_api_cost();

-- 2) Variations & scenes: extra fields needed by Fase 1
ALTER TABLE public.variations
  ADD COLUMN IF NOT EXISTS is_truncated boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS elapsed_seconds numeric,
  ADD COLUMN IF NOT EXISTS full_text text,
  ADD COLUMN IF NOT EXISTS model text,
  ADD COLUMN IF NOT EXISTS input_tokens integer,
  ADD COLUMN IF NOT EXISTS output_tokens integer;

ALTER TABLE public.variation_scenes
  ADD COLUMN IF NOT EXISTS order_idx integer,
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS script_es text,
  ADD COLUMN IF NOT EXISTS image_prompt_en text,
  ADD COLUMN IF NOT EXISTS animation_prompt_en text,
  ADD COLUMN IF NOT EXISTS reference_frame_time_sec numeric,
  ADD COLUMN IF NOT EXISTS tool_recommended text,
  ADD COLUMN IF NOT EXISTS attach_note text,
  ADD COLUMN IF NOT EXISTS screen_text text;

-- 3) Projects: transcription + analysis fields
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS transcription text,
  ADD COLUMN IF NOT EXISTS analysis_text text,
  ADD COLUMN IF NOT EXISTS frames_metadata jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 4) Source videos: store transcription/analysis at video level too
ALTER TABLE public.source_videos
  ADD COLUMN IF NOT EXISTS transcription text,
  ADD COLUMN IF NOT EXISTS analysis_text text;

-- 5) Storage bucket for uploaded source videos
INSERT INTO storage.buckets (id, name, public)
VALUES ('source-videos', 'source-videos', false)
ON CONFLICT (id) DO NOTHING;

-- RLS: each user can read/write only their own folder; admins can read all
DROP POLICY IF EXISTS "sv_storage_select_own" ON storage.objects;
CREATE POLICY "sv_storage_select_own"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'source-videos'
  AND (
    public.is_admin(auth.uid())
    OR (auth.uid()::text = (storage.foldername(name))[1])
  )
);

DROP POLICY IF EXISTS "sv_storage_insert_own" ON storage.objects;
CREATE POLICY "sv_storage_insert_own"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'source-videos'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

DROP POLICY IF EXISTS "sv_storage_update_own" ON storage.objects;
CREATE POLICY "sv_storage_update_own"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'source-videos'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

DROP POLICY IF EXISTS "sv_storage_delete_own" ON storage.objects;
CREATE POLICY "sv_storage_delete_own"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'source-videos'
  AND (
    public.is_admin(auth.uid())
    OR auth.uid()::text = (storage.foldername(name))[1]
  )
);

-- 6) Enable realtime on profiles so the header cost pill refreshes live
ALTER TABLE public.profiles REPLICA IDENTITY FULL;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'profiles'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles';
  END IF;
END $$;