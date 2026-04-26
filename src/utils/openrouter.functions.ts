import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

// OpenRouter pricing tables (USD per 1M tokens, approximate provider rates)
// OpenRouter adds ~5% markup, but these are close enough for cost tracking
const PRICING: Record<string, { input: number; output: number }> = {
  // Anthropic via OpenRouter
  "anthropic/claude-sonnet-4": { input: 3.0, output: 15.0 },
  "anthropic/claude-sonnet-4.5": { input: 3.0, output: 15.0 },
  "anthropic/claude-opus-4.5": { input: 5.0, output: 25.0 },
  "anthropic/claude-haiku-4.5": { input: 1.0, output: 5.0 },
  // Google Gemini via OpenRouter
  "google/gemini-2.5-pro": { input: 1.25, output: 10.0 },
  "google/gemini-2.5-flash": { input: 0.30, output: 2.50 },
  "google/gemini-2.5-flash-lite": { input: 0.10, output: 0.40 },
  "google/gemini-3.1-pro": { input: 2.0, output: 12.0 },
  "google/gemini-3.1-flash": { input: 0.50, output: 3.0 },
  // OpenAI via OpenRouter (if ever used)
  "openai/gpt-4o": { input: 2.5, output: 10.0 },
  "openai/gpt-4o-mini": { input: 0.15, output: 0.6 },
};

export function priceFor(model: string) {
  return PRICING[model] ?? PRICING["anthropic/claude-sonnet-4.5"];
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
  reservedUsd?: number;
}) {
  const cost = calcCost(opts.model, opts.inputTokens, opts.outputTokens);
  const sb = adminClient();
  const row = {
    user_id: opts.userId,
    workspace_id: opts.workspaceId ?? null,
    provider: "openrouter",
    model: opts.model,
    operation: opts.operation,
    input_tokens: opts.inputTokens,
    output_tokens: opts.outputTokens,
    cost_usd: cost,
    metadata: opts.metadata ?? {},
  };
  await sb.from("api_usage").insert(row as never);

  // Reconcile the reservation diff (actual - reserved)
  if (typeof opts.reservedUsd === "number") {
    const diff = cost - opts.reservedUsd;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (sb.rpc as any)("reconcile_daily_spend", {
      p_user_id: opts.userId,
      p_diff_usd: diff,
    });
    if (error) {
      const code = (error as { code?: string }).code;
      if (code !== "42883" && code !== "PGRST202") {
        console.error("[logUsage] reconcile_daily_spend failed:", error);
      }
    }
  }
  return cost;
}

export function dataUrlToBase64(dataUrl: string): { mediaType: string; b64: string } {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
  if (!m) return { mediaType: "image/jpeg", b64: dataUrl };
  return { mediaType: m[1], b64: m[2] };
}

// Convert a data URL to OpenAI's image_url format
export function dataUrlToOpenAIImage(dataUrl: string): {
  type: "image_url";
  image_url: { url: string; detail?: "low" | "high" | "auto" };
} {
  // OpenAI accepts the full data: URL directly
  return { type: "image_url", image_url: { url: dataUrl, detail: "high" } };
}
