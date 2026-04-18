import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type CapCheck =
  | { ok: true; spentToday: number; cap: number }
  | { ok: false; spentToday: number; cap: number; error: string };

// Revisa si el usuario ya superó su tope diario.
// Usa la función SECURITY DEFINER get_day_cost_usd para que la cuenta sea consistente
// independiente del cliente (anon, service_role) y respete la zona horaria de Bogotá.
export async function checkSpendingCap(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<CapCheck> {
  // daily_cap_usd y get_day_cost_usd aún no están en types.ts generado;
  // se castean puntualmente hasta el próximo regen.
  const sb = supabase as unknown as {
    from: (t: string) => {
      select: (c: string) => {
        eq: (k: string, v: string) => {
          single: () => Promise<{ data: { daily_cap_usd: number | string | null } | null }>;
        };
      };
    };
    rpc: (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: number | string | null }>;
  };

  const [{ data: prof }, { data: dayCost }] = await Promise.all([
    sb.from("profiles").select("daily_cap_usd").eq("id", userId).single(),
    sb.rpc("get_day_cost_usd", { p_user_id: userId }),
  ]);

  const cap = Number(prof?.daily_cap_usd ?? 20);
  const spent = Number(dayCost ?? 0);
  if (spent >= cap) {
    return {
      ok: false,
      spentToday: spent,
      cap,
      error: `Tope diario alcanzado ($${spent.toFixed(2)} / $${cap.toFixed(2)}). Contactá al admin o esperá a mañana.`,
    };
  }
  return { ok: true, spentToday: spent, cap };
}

export function capExceededResponse(
  check: Extract<CapCheck, { ok: false }>,
): Response {
  return new Response(
    JSON.stringify({
      error: check.error,
      spentToday: check.spentToday,
      cap: check.cap,
    }),
    { status: 429, headers: { "content-type": "application/json" } },
  );
}
