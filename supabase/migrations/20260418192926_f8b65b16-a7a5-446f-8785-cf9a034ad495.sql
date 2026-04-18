-- Tope de gasto diario por usuario (USD). Default $20.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS daily_cap_usd numeric(10,4) NOT NULL DEFAULT 20.0000;

-- Función que suma el gasto del día actual en hora de Bogotá
CREATE OR REPLACE FUNCTION public.get_day_cost_usd(p_user_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(cost_usd), 0)::numeric
  FROM public.api_usage
  WHERE user_id = p_user_id
    AND created_at >= date_trunc('day', (now() AT TIME ZONE 'America/Bogota'))
                         AT TIME ZONE 'America/Bogota';
$$;

REVOKE ALL ON FUNCTION public.get_day_cost_usd(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_day_cost_usd(uuid) TO authenticated, service_role;