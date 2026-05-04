import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

// Anthropic API direct pricing (USD per 1M tokens, official rates).
//
// Prompt caching (Anthropic native, requires `cache_control: { type: "ephemeral" }`
// on a content block):
//   - cache_creation_input_tokens: 1.25x base input price (one-time write)
//   - cache_read_input_tokens:    0.10x base input price (subsequent reads)
//   - regular input_tokens:       1.00x base input price
const PRICING: Record<string, { input: number; output: number }> = {
  // Sonnet family
  "claude-sonnet-4": { input: 3.0, output: 15.0 },
  "claude-sonnet-4-5": { input: 3.0, output: 15.0 },
  // Opus family
  "claude-opus-4-5": { input: 5.0, output: 25.0 },
  "claude-opus-4-7": { input: 15.0, output: 75.0 },
  // Haiku family
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
};

// Anthropic returns model IDs with date suffixes (e.g.
// "claude-sonnet-4-5-20250929", "claude-haiku-4-5-20251001"). Strip the
// trailing -YYYYMMDD before lookup so we don't fall back blindly to Sonnet
// pricing — that would 3x-overcharge Haiku.
function stripDateSuffix(model: string): string {
  return model
    .replace(/-\d{4}-\d{2}-\d{2}$/, "")
    .replace(/-\d{8}$/, "");
}

export function priceFor(model: string) {
  return (
    PRICING[model] ??
    PRICING[stripDateSuffix(model)] ??
    PRICING["claude-sonnet-4-5"]
  );
}

// `input` is the count of NON-cached input tokens (regular billing).
// cacheCreate = tokens written to the ephemeral cache (1.25x).
// cacheRead   = tokens read from the cache on subsequent calls (0.10x).
// Anthropic's `usage.input_tokens` already EXCLUDES cache buckets — they come
// as separate fields. So we sum the three buckets at their multipliers.
export function calcCost(
  model: string,
  input: number,
  output: number,
  cacheCreate: number = 0,
  cacheRead: number = 0,
) {
  const p = priceFor(model);
  const inputCost =
    input * p.input +
    cacheCreate * p.input * 1.25 +
    cacheRead * p.input * 0.10;
  return (inputCost + output * p.output) / 1_000_000;
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
  cacheCreateTokens?: number;
  cacheReadTokens?: number;
  metadata?: Record<string, unknown>;
  reservedUsd?: number;
}) {
  const cacheCreate = opts.cacheCreateTokens ?? 0;
  const cacheRead = opts.cacheReadTokens ?? 0;
  const cost = calcCost(
    opts.model,
    opts.inputTokens,
    opts.outputTokens,
    cacheCreate,
    cacheRead,
  );
  const sb = adminClient();
  const cacheMeta =
    cacheCreate || cacheRead
      ? { cache_create_tokens: cacheCreate, cache_read_tokens: cacheRead }
      : {};
  const row = {
    user_id: opts.userId,
    workspace_id: opts.workspaceId ?? null,
    provider: "anthropic",
    model: opts.model,
    operation: opts.operation,
    input_tokens: opts.inputTokens,
    output_tokens: opts.outputTokens,
    cost_usd: cost,
    metadata: { ...(opts.metadata ?? {}), ...cacheMeta },
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

// Convert a data URL to Anthropic's native image content block format.
// Anthropic uses `{type:"image", source:{type:"base64", media_type, data}}`,
// distinct from OpenAI/OpenRouter's `{type:"image_url", image_url:{url}}`.
export function dataUrlToAnthropicImage(dataUrl: string): {
  type: "image";
  source: { type: "base64"; media_type: string; data: string };
} {
  const { mediaType, b64 } = dataUrlToBase64(dataUrl);
  return { type: "image", source: { type: "base64", media_type: mediaType, data: b64 } };
}
