import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

// ─── pricing tables (USD per 1M tokens) ───────────────────────────────
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-sonnet-4-5": { input: 3, output: 15 },
  "claude-sonnet-4-5-20250929": { input: 3, output: 15 },
  "claude-opus-4-6": { input: 5, output: 25 },
  "claude-opus-4-5": { input: 5, output: 25 },
  "claude-3-5-sonnet-20241022": { input: 3, output: 15 },
};

export function priceFor(model: string) {
  return PRICING[model] ?? PRICING["claude-sonnet-4-6"];
}

export function calcCost(model: string, input: number, output: number) {
  const p = priceFor(model);
  return (input * p.input + output * p.output) / 1_000_000;
}

function adminClient() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient<Database>(url, key, { auth: { persistSession: false } });
}

export async function logUsage(opts: {
  userId: string;
  workspaceId?: string | null;
  model: string;
  operation: string;
  inputTokens: number;
  outputTokens: number;
  metadata?: Record<string, unknown>;
}) {
  const cost = calcCost(opts.model, opts.inputTokens, opts.outputTokens);
  const sb = adminClient();
  const row = {
    user_id: opts.userId,
    workspace_id: opts.workspaceId ?? null,
    provider: "anthropic",
    model: opts.model,
    operation: opts.operation,
    input_tokens: opts.inputTokens,
    output_tokens: opts.outputTokens,
    cost_usd: cost,
    metadata: opts.metadata ?? {},
  };
  await sb.from("api_usage").insert(row as never);
  return cost;
}

export function dataUrlToBase64(dataUrl: string): { mediaType: string; b64: string } {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
  if (!m) return { mediaType: "image/jpeg", b64: dataUrl };
  return { mediaType: m[1], b64: m[2] };
}
