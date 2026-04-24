import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

// Conservative per-endpoint upfront reservation. Each endpoint reserves this
// amount BEFORE calling Anthropic so two concurrent requests can't both pass
// the cap check on the same dollar (race fix — see Tanda B.2).
//
// Sized at ~p95 of historical costs per operation so legitimate runs are
// rarely over-reserved, while keeping the worst-case outlier bounded:
//  - api.anthropic-analyze: multimodal Sonnet 4.6 with up to 60 frames + 8k
//    output tokens → up to ~$5 in pathological runs (60 frames × ~1500 in
//    tokens + 8k out at $3/$15 per M).
//  - api.anthropic-generate: text-only Sonnet 4.6, ~25k in + ~12k out cap.
//  - api.ugc-generate: text-only Sonnet 4.6, smaller scripts.
//  - api.generate-higgsfield-prompts: single-frame Haiku 4.5, tiny.
export const MAX_ESTIMATED_COST_USD: Record<string, number> = {
  "api.anthropic-analyze": 5.0,
  "api.anthropic-generate": 1.5,
  "api.ugc-generate": 0.8,
  "api.generate-higgsfield-prompts": 0.1,
};

export type CapCheck =
  | { ok: true; reservedUsd: number; newTotal: number }
  | { ok: false; reason: string; cap?: number; spent?: number };

// Atomic reservation against today's spend.
//
// Implementation status (2026-04-24): the atomic RPCs `reserve_daily_spend`
// and `reconcile_daily_spend` are defined in
//   supabase/migrations/20260424051651_atomic_spending_cap.sql
// but that migration is PENDING APPLY (Cloud balance paused until 2026-05-01).
// Until applied, we transparently fall back to the legacy read-only check
// using `get_day_cost_usd` so the endpoints keep working — the only loss is
// the race protection, which already existed before this tanda.
//
// Once the migration ships, the RPC path takes over with no code change.
export async function checkSpendingCap(
  supabase: SupabaseClient<Database>,
  userId: string,
  endpoint: string,
): Promise<CapCheck> {
  const estimated =
    MAX_ESTIMATED_COST_USD[endpoint] ?? MAX_ESTIMATED_COST_USD["api.anthropic-generate"];

  // Try the atomic RPC first. If the function doesn't exist yet (migration
  // pending) Postgres returns code 42883 — fall through to the legacy path.
  // Cast to `any` because the RPC name isn't in the auto-generated types
  // until the migration is applied and types.ts regenerated.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rpcRes = await (supabase.rpc as any)("reserve_daily_spend", {
    p_user_id: userId,
    p_estimated_usd: estimated,
  });

  if (!rpcRes.error) {
    const newTotal = Number(rpcRes.data ?? NaN);
    if (Number.isFinite(newTotal)) {
      return { ok: true, reservedUsd: estimated, newTotal };
    }
    // RPC returned NULL → cap would be exceeded.
    const { data: prof } = await supabase
      .from("profiles")
      .select("daily_cap_usd")
      .eq("id", userId)
      .single();
    const cap = Number(prof?.daily_cap_usd ?? 20);
    return {
      ok: false,
      reason: `Tope diario alcanzado (reserva de $${estimated.toFixed(2)} excede el cap de $${cap.toFixed(2)}). Esperá a mañana o subí el cap.`,
      cap,
    };
  }

  // RPC missing (migration not applied) → legacy read-only check.
  // Postgrest error code "42883" = function does not exist; "PGRST202" = no
  // matching function in schema cache. Anything else we surface as fail-open
  // to avoid blocking the user on a transient DB blip (matches prior behaviour).
  const code = (rpcRes.error as { code?: string } | null)?.code;
  if (code !== "42883" && code !== "PGRST202") {
    console.error("[spending-cap] reserve_daily_spend RPC error:", rpcRes.error);
  }

  const [{ data: prof }, { data: dayCost }] = await Promise.all([
    supabase.from("profiles").select("daily_cap_usd").eq("id", userId).single(),
    supabase.rpc("get_day_cost_usd", { p_user_id: userId }),
  ]);
  const cap = Number(prof?.daily_cap_usd ?? 20);
  const spent = Number(dayCost ?? 0);
  if (spent + estimated > cap) {
    return {
      ok: false,
      reason: `Tope diario alcanzado ($${spent.toFixed(2)} / $${cap.toFixed(2)}). Esperá a mañana o subí el cap.`,
      cap,
      spent,
    };
  }
  // Legacy path: no atomic reservation actually happened, but we return a
  // synthetic reservedUsd so call-sites can keep their reconcile path
  // uniform (the no-op RPC will ignore it post-migration via NULL return).
  return { ok: true, reservedUsd: estimated, newTotal: spent + estimated };
}

export function capExceededResponse(
  check: Extract<CapCheck, { ok: false }>,
): Response {
  return new Response(
    JSON.stringify({
      error: check.reason,
      cap: check.cap,
      spent: check.spent,
    }),
    { status: 402, headers: { "content-type": "application/json" } },
  );
}
