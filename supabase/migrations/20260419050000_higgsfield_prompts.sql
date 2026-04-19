-- Higgsfield per-scene prompts (Nano Banana Pro, Seedream 4, Kling 2.5 Turbo, Seedance 2.0)
ALTER TABLE public.variation_scenes
  ADD COLUMN IF NOT EXISTS prompt_nano_banana text,
  ADD COLUMN IF NOT EXISTS prompt_seedream    text,
  ADD COLUMN IF NOT EXISTS prompt_kling       text,
  ADD COLUMN IF NOT EXISTS prompt_seedance    text;
