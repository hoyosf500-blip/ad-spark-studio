-- ============================================================
-- AD FACTORY STUDIO — FASE 0 SCHEMA
-- ============================================================

-- ---------- PROFILES ----------
CREATE TABLE public.profiles (
  id UUID NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  is_admin BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  total_cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ---------- updated_at helper ----------
CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ---------- has_role / is_admin helpers (SECURITY DEFINER, no recursion) ----------
CREATE OR REPLACE FUNCTION public.is_admin(_uid UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE((SELECT is_admin FROM public.profiles WHERE id = _uid), false);
$$;

CREATE OR REPLACE FUNCTION public.is_active(_uid UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE((SELECT is_active FROM public.profiles WHERE id = _uid), false);
$$;

-- ---------- handle_new_user trigger: first row → admin ----------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  is_first BOOLEAN;
BEGIN
  SELECT NOT EXISTS(SELECT 1 FROM public.profiles) INTO is_first;
  INSERT INTO public.profiles (id, email, full_name, is_admin, is_active)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    is_first,
    true
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ---------- Profiles RLS ----------
CREATE POLICY "self_or_admin_select" ON public.profiles FOR SELECT
USING (auth.uid() = id OR public.is_admin(auth.uid()));

CREATE POLICY "self_update_safe" ON public.profiles FOR UPDATE
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id AND is_admin = (SELECT is_admin FROM public.profiles WHERE id = auth.uid()) AND is_active = true);

CREATE POLICY "admin_update_others" ON public.profiles FOR UPDATE
USING (public.is_admin(auth.uid()) AND id <> auth.uid())
WITH CHECK (public.is_admin(auth.uid()) AND id <> auth.uid());

-- ============================================================
-- WORKSPACES
-- ============================================================
CREATE TABLE public.workspaces (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_workspaces_updated BEFORE UPDATE ON public.workspaces
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.workspace_members (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id)
);
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_wm_user ON public.workspace_members(user_id);
CREATE INDEX idx_wm_ws ON public.workspace_members(workspace_id);

-- helper: is current user a member of workspace?
CREATE OR REPLACE FUNCTION public.is_ws_member(_uid UUID, _ws UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS(SELECT 1 FROM public.workspace_members WHERE user_id = _uid AND workspace_id = _ws);
$$;

CREATE POLICY "ws_select" ON public.workspaces FOR SELECT
USING (public.is_admin(auth.uid()) OR public.is_ws_member(auth.uid(), id));
CREATE POLICY "ws_insert" ON public.workspaces FOR INSERT
WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "ws_update" ON public.workspaces FOR UPDATE
USING (public.is_admin(auth.uid()) OR auth.uid() = owner_id);
CREATE POLICY "ws_delete" ON public.workspaces FOR DELETE
USING (public.is_admin(auth.uid()) OR auth.uid() = owner_id);

CREATE POLICY "wm_select" ON public.workspace_members FOR SELECT
USING (public.is_admin(auth.uid()) OR user_id = auth.uid() OR public.is_ws_member(auth.uid(), workspace_id));
CREATE POLICY "wm_insert" ON public.workspace_members FOR INSERT
WITH CHECK (public.is_admin(auth.uid()) OR EXISTS(SELECT 1 FROM public.workspaces w WHERE w.id = workspace_id AND w.owner_id = auth.uid()));
CREATE POLICY "wm_delete" ON public.workspace_members FOR DELETE
USING (public.is_admin(auth.uid()) OR EXISTS(SELECT 1 FROM public.workspaces w WHERE w.id = workspace_id AND w.owner_id = auth.uid()));

-- ============================================================
-- Generic ws-scoped policy template applied to all data tables
-- ============================================================

-- ---------- PRODUCTS ----------
CREATE TABLE public.products (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_products_ws ON public.products(workspace_id);
CREATE TRIGGER trg_products_updated BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ---------- AVATARS ----------
CREATE TABLE public.avatars (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.avatars ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_avatars_ws ON public.avatars(workspace_id);
CREATE TRIGGER trg_avatars_updated BEFORE UPDATE ON public.avatars FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ---------- TRANSCRIPTIONS LIBRARY ----------
CREATE TABLE public.transcriptions_library (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  title TEXT,
  content TEXT NOT NULL,
  language TEXT DEFAULT 'es',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.transcriptions_library ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_tl_ws ON public.transcriptions_library(workspace_id);
CREATE TRIGGER trg_tl_updated BEFORE UPDATE ON public.transcriptions_library FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ---------- PROJECTS ----------
CREATE TABLE public.projects (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_projects_ws ON public.projects(workspace_id);
CREATE TRIGGER trg_projects_updated BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ---------- SOURCE VIDEOS ----------
CREATE TABLE public.source_videos (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  storage_path TEXT,
  filename TEXT,
  duration_seconds NUMERIC,
  analysis_text TEXT,
  frames JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.source_videos ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_sv_ws ON public.source_videos(workspace_id);
CREATE INDEX idx_sv_project ON public.source_videos(project_id);
CREATE TRIGGER trg_sv_updated BEFORE UPDATE ON public.source_videos FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ---------- VARIATIONS ----------
CREATE TABLE public.variations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  source_video_id UUID REFERENCES public.source_videos(id) ON DELETE SET NULL,
  variation_type TEXT NOT NULL,
  title TEXT,
  script TEXT,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.variations ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_var_ws ON public.variations(workspace_id);
CREATE INDEX idx_var_project ON public.variations(project_id);
CREATE TRIGGER trg_var_updated BEFORE UPDATE ON public.variations FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ---------- VARIATION SCENES ----------
CREATE TABLE public.variation_scenes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  variation_id UUID NOT NULL REFERENCES public.variations(id) ON DELETE CASCADE,
  scene_index INT NOT NULL,
  scene_text TEXT,
  image_prompt TEXT,
  animation_prompt TEXT,
  reference_frame_url TEXT,
  use_i2i BOOLEAN NOT NULL DEFAULT false,
  generated_image_id UUID,
  generated_video_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.variation_scenes ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_vs_ws ON public.variation_scenes(workspace_id);
CREATE INDEX idx_vs_var ON public.variation_scenes(variation_id);
CREATE TRIGGER trg_vs_updated BEFORE UPDATE ON public.variation_scenes FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ---------- UGC GENERATIONS ----------
CREATE TABLE public.ugc_generations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  style TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt TEXT,
  language TEXT DEFAULT 'es',
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.ugc_generations ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_ugc_ws ON public.ugc_generations(workspace_id);
CREATE TRIGGER trg_ugc_updated BEFORE UPDATE ON public.ugc_generations FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ---------- IMAGE GENERATIONS ----------
CREATE TABLE public.image_generations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scene_id UUID REFERENCES public.variation_scenes(id) ON DELETE SET NULL,
  provider TEXT NOT NULL DEFAULT 'qwen',
  prompt TEXT,
  size TEXT,
  used_i2i BOOLEAN NOT NULL DEFAULT false,
  reference_url TEXT,
  storage_path TEXT,
  external_url TEXT,
  cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.image_generations ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_ig_ws ON public.image_generations(workspace_id);
CREATE INDEX idx_ig_user ON public.image_generations(user_id);
CREATE INDEX idx_ig_created ON public.image_generations(created_at);
CREATE TRIGGER trg_ig_updated BEFORE UPDATE ON public.image_generations FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ---------- VIDEO GENERATIONS ----------
CREATE TABLE public.video_generations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scene_id UUID REFERENCES public.variation_scenes(id) ON DELETE SET NULL,
  provider TEXT NOT NULL DEFAULT 'wan',
  prompt TEXT,
  size TEXT,
  source_image_id UUID REFERENCES public.image_generations(id) ON DELETE SET NULL,
  storage_path TEXT,
  external_url TEXT,
  cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  task_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.video_generations ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_vg_ws ON public.video_generations(workspace_id);
CREATE INDEX idx_vg_user ON public.video_generations(user_id);
CREATE INDEX idx_vg_created ON public.video_generations(created_at);
CREATE TRIGGER trg_vg_updated BEFORE UPDATE ON public.video_generations FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ---------- ASYNC TASKS ----------
CREATE TABLE public.async_tasks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  task_type TEXT NOT NULL,
  external_task_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  related_video_id UUID REFERENCES public.video_generations(id) ON DELETE CASCADE,
  related_image_id UUID REFERENCES public.image_generations(id) ON DELETE CASCADE,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB,
  error TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.async_tasks ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_at_user_status ON public.async_tasks(user_id, status);
CREATE INDEX idx_at_ws ON public.async_tasks(workspace_id);
CREATE TRIGGER trg_at_updated BEFORE UPDATE ON public.async_tasks FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ---------- API USAGE ----------
CREATE TABLE public.api_usage (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  model TEXT,
  operation TEXT,
  input_tokens INT,
  output_tokens INT,
  units NUMERIC,
  cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.api_usage ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_au_user ON public.api_usage(user_id);
CREATE INDEX idx_au_created ON public.api_usage(created_at);

-- ---------- AD METRICS ----------
CREATE TABLE public.ad_metrics (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  variation_id UUID REFERENCES public.variations(id) ON DELETE CASCADE,
  platform TEXT,
  impressions INT,
  clicks INT,
  spend_usd NUMERIC(12,2),
  conversions INT,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.ad_metrics ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_am_ws ON public.ad_metrics(workspace_id);

-- ============================================================
-- RLS policies (workspace-scoped + admin override)
-- Generic pattern: select if admin OR member; write if member.
-- ============================================================

-- products
CREATE POLICY "p_sel" ON public.products FOR SELECT USING (public.is_admin(auth.uid()) OR public.is_ws_member(auth.uid(), workspace_id));
CREATE POLICY "p_ins" ON public.products FOR INSERT WITH CHECK (public.is_ws_member(auth.uid(), workspace_id));
CREATE POLICY "p_upd" ON public.products FOR UPDATE USING (public.is_admin(auth.uid()) OR public.is_ws_member(auth.uid(), workspace_id));
CREATE POLICY "p_del" ON public.products FOR DELETE USING (public.is_admin(auth.uid()) OR public.is_ws_member(auth.uid(), workspace_id));

-- avatars
CREATE POLICY "av_sel" ON public.avatars FOR SELECT USING (public.is_admin(auth.uid()) OR public.is_ws_member(auth.uid(), workspace_id));
CREATE POLICY "av_ins" ON public.avatars FOR INSERT WITH CHECK (public.is_ws_member(auth.uid(), workspace_id));
CREATE POLICY "av_upd" ON public.avatars FOR UPDATE USING (public.is_admin(auth.uid()) OR public.is_ws_member(auth.uid(), workspace_id));
CREATE POLICY "av_del" ON public.avatars FOR DELETE USING (public.is_admin(auth.uid()) OR public.is_ws_member(auth.uid(), workspace_id));

-- transcriptions_library
CREATE POLICY "tl_sel" ON public.transcriptions_library FOR SELECT USING (public.is_admin(auth.uid()) OR public.is_ws_member(auth.uid(), workspace_id));
CREATE POLICY "tl_ins" ON public.transcriptions_library FOR INSERT WITH CHECK (public.is_ws_member(auth.uid(), workspace_id));
CREATE POLICY "tl_upd" ON public.transcriptions_library FOR UPDATE USING (public.is_admin(auth.uid()) OR public.is_ws_member(auth.uid(), workspace_id));
CREATE POLICY "tl_del" ON public.transcriptions_library FOR DELETE USING (public.is_admin(auth.uid()) OR public.is_ws_member(auth.uid(), workspace_id));

-- projects
CREATE POLICY "pr_sel" ON public.projects FOR SELECT USING (public.is_admin(auth.uid()) OR public.is_ws_member(auth.uid(), workspace_id));
CREATE POLICY "pr_ins" ON public.projects FOR INSERT WITH CHECK (public.is_ws_member(auth.uid(), workspace_id));
CREATE POLICY "pr_upd" ON public.projects FOR UPDATE USING (public.is_admin(auth.uid()) OR public.is_ws_member(auth.uid(), workspace_id));
CREATE POLICY "pr_del" ON public.projects FOR DELETE USING (public.is_admin(auth.uid()) OR public.is_ws_member(auth.uid(), workspace_id));

-- source_videos
CREATE POLICY "sv_sel" ON public.source_videos FOR SELECT USING (public.is_admin(auth.uid()) OR public.is_ws_member(auth.uid(), workspace_id));
CREATE POLICY "sv_ins" ON public.source_videos FOR INSERT WITH CHECK (public.is_ws_member(auth.uid(), workspace_id));
CREATE POLICY "sv_upd" ON public.source_videos FOR UPDATE USING (public.is_admin(auth.uid()) OR public.is_ws_member(auth.uid(), workspace_id));
CREATE POLICY "sv_del" ON public.source_videos FOR DELETE USING (public.is_admin(auth.uid()) OR public.is_ws_member(auth.uid(), workspace_id));

-- variations
CREATE POLICY "v_sel" ON public.variations FOR SELECT USING (public.is_admin(auth.uid()) OR public.is_ws_member(auth.uid(), workspace_id));
CREATE POLICY "v_ins" ON public.variations FOR INSERT WITH CHECK (public.is_ws_member(auth.uid(), workspace_id));
CREATE POLICY "v_upd" ON public.variations FOR UPDATE USING (public.is_admin(auth.uid()) OR public.is_ws_member(auth.uid(), workspace_id));
CREATE POLICY "v_del" ON public.variations FOR DELETE USING (public.is_admin(auth.uid()) OR public.is_ws_member(auth.uid(), workspace_id));

-- variation_scenes
CREATE POLICY "vs_sel" ON public.variation_scenes FOR SELECT USING (public.is_admin(auth.uid()) OR public.is_ws_member(auth.uid(), workspace_id));
CREATE POLICY "vs_ins" ON public.variation_scenes FOR INSERT WITH CHECK (public.is_ws_member(auth.uid(), workspace_id));
CREATE POLICY "vs_upd" ON public.variation_scenes FOR UPDATE USING (public.is_admin(auth.uid()) OR public.is_ws_member(auth.uid(), workspace_id));
CREATE POLICY "vs_del" ON public.variation_scenes FOR DELETE USING (public.is_admin(auth.uid()) OR public.is_ws_member(auth.uid(), workspace_id));

-- ugc_generations
CREATE POLICY "ug_sel" ON public.ugc_generations FOR SELECT USING (public.is_admin(auth.uid()) OR public.is_ws_member(auth.uid(), workspace_id));
CREATE POLICY "ug_ins" ON public.ugc_generations FOR INSERT WITH CHECK (public.is_ws_member(auth.uid(), workspace_id));
CREATE POLICY "ug_upd" ON public.ugc_generations FOR UPDATE USING (public.is_admin(auth.uid()) OR public.is_ws_member(auth.uid(), workspace_id));
CREATE POLICY "ug_del" ON public.ugc_generations FOR DELETE USING (public.is_admin(auth.uid()) OR public.is_ws_member(auth.uid(), workspace_id));

-- image_generations
CREATE POLICY "ig_sel" ON public.image_generations FOR SELECT USING (public.is_admin(auth.uid()) OR public.is_ws_member(auth.uid(), workspace_id) OR user_id = auth.uid());
CREATE POLICY "ig_ins" ON public.image_generations FOR INSERT WITH CHECK (user_id = auth.uid() AND public.is_ws_member(auth.uid(), workspace_id));
CREATE POLICY "ig_upd" ON public.image_generations FOR UPDATE USING (public.is_admin(auth.uid()) OR user_id = auth.uid());
CREATE POLICY "ig_del" ON public.image_generations FOR DELETE USING (public.is_admin(auth.uid()) OR user_id = auth.uid());

-- video_generations
CREATE POLICY "vg_sel" ON public.video_generations FOR SELECT USING (public.is_admin(auth.uid()) OR public.is_ws_member(auth.uid(), workspace_id) OR user_id = auth.uid());
CREATE POLICY "vg_ins" ON public.video_generations FOR INSERT WITH CHECK (user_id = auth.uid() AND public.is_ws_member(auth.uid(), workspace_id));
CREATE POLICY "vg_upd" ON public.video_generations FOR UPDATE USING (public.is_admin(auth.uid()) OR user_id = auth.uid());
CREATE POLICY "vg_del" ON public.video_generations FOR DELETE USING (public.is_admin(auth.uid()) OR user_id = auth.uid());

-- async_tasks
CREATE POLICY "at_sel" ON public.async_tasks FOR SELECT USING (public.is_admin(auth.uid()) OR user_id = auth.uid());
CREATE POLICY "at_ins" ON public.async_tasks FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "at_upd" ON public.async_tasks FOR UPDATE USING (public.is_admin(auth.uid()) OR user_id = auth.uid());
CREATE POLICY "at_del" ON public.async_tasks FOR DELETE USING (public.is_admin(auth.uid()) OR user_id = auth.uid());

-- api_usage (insert by self/server, read by self+admin)
CREATE POLICY "au_sel" ON public.api_usage FOR SELECT USING (public.is_admin(auth.uid()) OR user_id = auth.uid());
CREATE POLICY "au_ins" ON public.api_usage FOR INSERT WITH CHECK (user_id = auth.uid());

-- ad_metrics
CREATE POLICY "am_sel" ON public.ad_metrics FOR SELECT USING (public.is_admin(auth.uid()) OR public.is_ws_member(auth.uid(), workspace_id));
CREATE POLICY "am_ins" ON public.ad_metrics FOR INSERT WITH CHECK (public.is_ws_member(auth.uid(), workspace_id));
CREATE POLICY "am_upd" ON public.ad_metrics FOR UPDATE USING (public.is_admin(auth.uid()) OR public.is_ws_member(auth.uid(), workspace_id));
CREATE POLICY "am_del" ON public.ad_metrics FOR DELETE USING (public.is_admin(auth.uid()) OR public.is_ws_member(auth.uid(), workspace_id));
