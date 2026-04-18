-- Drop existing ugc_generations (it had different shape from earlier scaffolding)
DROP TABLE IF EXISTS public.ugc_generations CASCADE;

CREATE TABLE public.ugc_generations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  source_project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  source_video_id uuid REFERENCES public.source_videos(id) ON DELETE SET NULL,
  style text NOT NULL CHECK (style IN ('iphone_selfie','kitchen_chat','walk_talk','couch_testimonial')),
  script_text text,
  image_prompt_en text,
  animation_prompt_en text,
  image_generation_id uuid REFERENCES public.image_generations(id) ON DELETE SET NULL,
  video_generation_id uuid REFERENCES public.video_generations(id) ON DELETE SET NULL,
  video_model text,
  cost_usd numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ugc_generations ENABLE ROW LEVEL SECURITY;

CREATE POLICY ug_sel ON public.ugc_generations FOR SELECT
  USING (is_admin(auth.uid()) OR is_ws_member(auth.uid(), workspace_id));
CREATE POLICY ug_ins ON public.ugc_generations FOR INSERT
  WITH CHECK ((user_id = auth.uid()) AND is_ws_member(auth.uid(), workspace_id));
CREATE POLICY ug_upd ON public.ugc_generations FOR UPDATE
  USING (is_admin(auth.uid()) OR (user_id = auth.uid()));
CREATE POLICY ug_del ON public.ugc_generations FOR DELETE
  USING (is_admin(auth.uid()) OR (user_id = auth.uid()));

CREATE TRIGGER tg_ugc_updated_at
  BEFORE UPDATE ON public.ugc_generations
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE public.ugc_generations REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.ugc_generations;

CREATE INDEX idx_ugc_workspace ON public.ugc_generations(workspace_id);
CREATE INDEX idx_ugc_user ON public.ugc_generations(user_id);
CREATE INDEX idx_ugc_project ON public.ugc_generations(source_project_id);