-- PENDING APPLY — do not apply until Cloud balance reset 2026-05-01.
--
-- This file is intentionally NOT inside supabase/migrations/ because the
-- migration tooling auto-applies anything dropped there, and Cloud balance
-- is paused. Move/rename to
--   supabase/migrations/20260501000000_atomic_spending_cap.sql
-- (or apply via the supabase--migration tool) once the balance resets.
--
-- Atomic spending cap (Tanda B.2, Opción A) — replaces the read-then-write
-- race in checkSpendingCap with a single guarded INSERT..ON CONFLICT..WHERE
-- so two concurrent requests can't both pass the cap check on the same dollar.
--
-- Flow:
--   1. Endpoint calls reserve_daily_spend(p_user_id, p_estimated_usd).
--      The function atomically reserves $estimated against today's row,
--      bounded by profiles.daily_cap_usd. If it would exceed the cap it
--      returns NULL (caller should respond 402).
--   2. Endpoint runs the operation (Anthropic call + logUsage).
--   3. Endpoint calls reconcile_daily_spend(p_user_id, p_diff_usd) with
--      diff = actualCost - estimatedCost. Diff can be negative (refund) —
--      GREATEST(0, total + diff) clamps to non-negative for safety.
--
-- Day boundary follows America/Bogota (matches existing get_day_cost_usd).
-- get_day_cost_usd() is intentionally NOT dropped here so the legacy fallback
-- in spending-cap.ts keeps working until this migration is applied.

CREATE TABLE IF NOT EXISTS public.daily_spend (
  user_id uuid NOT NULL,
  day date NOT NULL,
  total_usd numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day)
);

ALTER TABLE public.daily_spend ENABLE ROW LEVEL SECURITY;

-- Users may read their own row; admins may read all. No client write policy —
-- mutations only happen via SECURITY DEFINER RPCs below.
CREATE POLICY ds_sel ON public.daily_spend FOR SELECT
  USING (is_admin(auth.uid()) OR user_id = auth.uid());

-- ─── reserve_daily_spend ────────────────────────────────────────────────
-- Atomically reserves p_estimated_usd against today's row. Returns the new
-- total on success, NULL when the reservation would exceed the user's cap.
CREATE OR REPLACE FUNCTION public.reserve_daily_spend(
  p_user_id uuid,
  p_estimated_usd numeric
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'America/Bogota')::date;
  v_cap numeric;
  v_new_total numeric;
BEGIN
  SELECT COALESCE(daily_cap_usd, 20)
    INTO v_cap
    FROM public.profiles
   WHERE id = p_user_id;

  IF v_cap IS NULL THEN
    -- Unknown user — fail closed.
    RETURN NULL;
  END IF;

  IF p_estimated_usd > v_cap THEN
    RETURN NULL;
  END IF;

  -- Atomic upsert with cap guard. The WHERE on DO UPDATE only fires when
  -- (existing total + estimated) <= cap. INSERT on a new row is always OK
  -- because we already checked p_estimated_usd <= v_cap above.
  INSERT INTO public.daily_spend (user_id, day, total_usd)
  VALUES (p_user_id, v_today, p_estimated_usd)
  ON CONFLICT (user_id, day) DO UPDATE
    SET total_usd = public.daily_spend.total_usd + p_estimated_usd,
        updated_at = now()
    WHERE public.daily_spend.total_usd + p_estimated_usd <= v_cap
  RETURNING total_usd INTO v_new_total;

  -- v_new_total is NULL when the WHERE filtered out the UPDATE → cap exceeded.
  RETURN v_new_total;
END;
$$;

-- ─── reconcile_daily_spend ──────────────────────────────────────────────
-- Adjusts today's row by p_diff_usd (actual_cost - estimated_cost). Diff may
-- be negative when the actual run cost less than the reservation — we refund
-- the slack. GREATEST(0, ...) clamps to non-negative as a safety net so a
-- buggy logger can never push the row negative.
CREATE OR REPLACE FUNCTION public.reconcile_daily_spend(
  p_user_id uuid,
  p_diff_usd numeric
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'America/Bogota')::date;
  v_new_total numeric;
BEGIN
  UPDATE public.daily_spend
     SET total_usd = GREATEST(0, total_usd + p_diff_usd),
         updated_at = now()
   WHERE user_id = p_user_id
     AND day = v_today
  RETURNING total_usd INTO v_new_total;

  RETURN v_new_total;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reserve_daily_spend(uuid, numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_daily_spend(uuid, numeric) TO authenticated, service_role;
