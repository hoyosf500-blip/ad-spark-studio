ALTER TABLE public.variations ADD COLUMN IF NOT EXISTS validation jsonb;
ALTER TABLE public.ugc_generations ADD COLUMN IF NOT EXISTS validation jsonb;