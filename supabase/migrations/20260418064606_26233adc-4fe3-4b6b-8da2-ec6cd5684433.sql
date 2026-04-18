-- Storage bucket for Qwen-generated images
INSERT INTO storage.buckets (id, name, public)
VALUES ('generated-images', 'generated-images', false)
ON CONFLICT (id) DO NOTHING;

-- RLS on storage.objects for generated-images bucket
CREATE POLICY "gi_select" ON storage.objects FOR SELECT
  USING (bucket_id = 'generated-images' AND (public.is_admin(auth.uid()) OR (storage.foldername(name))[1] = auth.uid()::text));

CREATE POLICY "gi_insert" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'generated-images' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "gi_update" ON storage.objects FOR UPDATE
  USING (bucket_id = 'generated-images' AND (public.is_admin(auth.uid()) OR (storage.foldername(name))[1] = auth.uid()::text));

CREATE POLICY "gi_delete" ON storage.objects FOR DELETE
  USING (bucket_id = 'generated-images' AND (public.is_admin(auth.uid()) OR (storage.foldername(name))[1] = auth.uid()::text));

-- Add public_url column to image_generations (other columns already exist per types)
ALTER TABLE public.image_generations
  ADD COLUMN IF NOT EXISTS public_url text;